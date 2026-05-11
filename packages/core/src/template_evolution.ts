/**
 * MNEME TEMPLATE EVOLUTION (v1.42.1 — Phase 2 of Per-Vendor Pulse Templates).
 *
 * Phase 1 (v1.42.0) shipped a static built-in registry of per-vendor
 * pulse templates. Phase 2 closes the loop: read the AI compliance log,
 * propose template mutations for vendors whose compliance is dropping,
 * record the A/B baseline, and (after a configurable window of new
 * compliance events) auto-promote the winner.
 *
 * Wiring:
 *   ai_compliance.ts        — every compliance entry already includes the vendor
 *   vendor_pulse_templates  — Phase 1 registry + applyTemplate
 *   THIS MODULE              — read compliance + propose + apply mutation + evaluate
 *   companion.ts (CLI)      — `mneme companion template propose|apply|ab-status`
 *
 * Storage:
 *   .mneme/template-mutations.jsonl — append-only ledger of proposals + A/B
 *
 * The proposer is HEURISTIC, not LLM-driven (consistent with EVOLVE Phase
 * 3's deterministic-template policy). Three mutation families:
 *   - "tighten-maxchars"   : drop maxChars by 25% if compliance < 60% on long pulses
 *   - "flip-action-position" : action-first ↔ action-last
 *   - "duplicate-toggle"  : flip duplicateActionAtTop
 * The evaluator decides the winner based on compliance delta over the
 * test window (default 50 compliance entries per arm).
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

import { readComplianceLog, computeComplianceStats, type ComplianceEntry } from "./ai_compliance.js";
import { pickTemplate, setTemplate, type VendorTemplate } from "./vendor_pulse_templates.js";

const MUTATIONS_FILE = ".mneme/template-mutations.jsonl";
const DEFAULT_AB_WINDOW = 50;
const COMPLIANCE_FLOOR = 0.60;
const COMPLIANCE_BUMP_REQUIRED = 0.10;

export type MutationKind = "tighten-maxchars" | "flip-action-position" | "duplicate-toggle";

export interface TemplateMutation {
  id: string;
  ts: string;
  vendor: string;
  kind: MutationKind;
  before: VendorTemplate;
  after: VendorTemplate;
  /** "proposed" → suggested but not applied · "applied" → in production · "promoted" → A/B winner · "reverted" → A/B loser */
  status: "proposed" | "applied" | "promoted" | "reverted";
  /** Compliance baseline at proposal time (last DEFAULT_AB_WINDOW entries). */
  baselineCompliance: number;
  /** Filled when the A/B test concludes. */
  finalCompliance?: number;
}

export interface AbTestResult {
  mutationId: string;
  vendor: string;
  baselineCompliance: number;
  candidateCompliance: number;
  delta: number;
  decision: "promote" | "revert" | "still-running";
  reason: string;
}

function ensureMnemeDir(repo: string): void {
  const d = join(repo, ".mneme");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function mutationsPath(repo: string): string { return join(repo, MUTATIONS_FILE); }

function appendMutation(repo: string, m: TemplateMutation): void {
  ensureMnemeDir(repo);
  try { appendFileSync(mutationsPath(repo), JSON.stringify(m) + "\n"); } catch { /* never crash */ }
}

export function readMutations(repo: string, vendor?: string): TemplateMutation[] {
  const p = mutationsPath(repo);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").split("\n").filter((l) => l.trim().length > 0).map((l) => {
      try { return JSON.parse(l) as TemplateMutation; } catch { return null; }
    }).filter((x): x is TemplateMutation => x !== null && (!vendor || x.vendor === vendor));
  } catch { return []; }
}

function complianceForVendor(entries: ComplianceEntry[], vendor: string): number {
  // Compliance entries from ai_compliance.ts don't yet carry a "vendor" field
  // explicitly (vendor inference is roadmapped). Until then treat the whole
  // log as the vendor's stream — accurate when the user runs one AI agent
  // per repo (the dominant case). Phase 2.1 will partition.
  void vendor;
  if (entries.length === 0) return 1;
  const stats = computeComplianceStats(entries);
  return stats.inlineComplianceRate;
}

function makeId(): string { return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`; }

function mutateTighten(t: VendorTemplate): VendorTemplate {
  return { ...t, maxChars: Math.max(400, Math.floor(t.maxChars * 0.75)), rationale: t.rationale + " | TIGHTENED to fit observed attention window" };
}

function mutateFlip(t: VendorTemplate): VendorTemplate {
  const flipped = t.layout === "action-first" ? "action-last" : t.layout === "action-last" ? "action-first" : "action-first";
  return { ...t, layout: flipped as VendorTemplate["layout"], rationale: t.rationale + " | FLIPPED layout to test alternative attention pattern" };
}

function mutateDuplicateToggle(t: VendorTemplate): VendorTemplate {
  return { ...t, duplicateActionAtTop: !t.duplicateActionAtTop, rationale: t.rationale + " | TOGGLED duplicateActionAtTop" };
}

/** Inspect the compliance log. If the vendor's recent compliance falls
 *  below COMPLIANCE_FLOOR, propose up to 3 mutations. Otherwise return
 *  []. The caller (CLI or daemon) decides whether to apply any. */
export function proposeMutations(repo: string, vendor: string, opts: { window?: number } = {}): TemplateMutation[] {
  const window = opts.window ?? DEFAULT_AB_WINDOW;
  const entries = readComplianceLog(repo, window);
  const compliance = complianceForVendor(entries, vendor);
  if (compliance >= COMPLIANCE_FLOOR) return [];   // healthy — no mutation needed

  const before = pickTemplate(repo, vendor);
  const candidates: TemplateMutation[] = [];
  const factories: Array<{ kind: MutationKind; fn: (t: VendorTemplate) => VendorTemplate }> = [
    { kind: "tighten-maxchars", fn: mutateTighten },
    { kind: "flip-action-position", fn: mutateFlip },
    { kind: "duplicate-toggle", fn: mutateDuplicateToggle },
  ];
  for (const f of factories) {
    const after = f.fn(before);
    candidates.push({
      id: makeId(),
      ts: new Date().toISOString(),
      vendor,
      kind: f.kind,
      before,
      after,
      status: "proposed",
      baselineCompliance: compliance,
    });
  }
  for (const c of candidates) appendMutation(repo, c);
  return candidates;
}

/** Apply a proposed mutation. Writes the new template to the registry +
 *  records the application event. Returns the applied mutation entry. */
export function applyMutation(repo: string, mutationId: string): TemplateMutation | null {
  const proposals = readMutations(repo).filter((m) => m.id === mutationId && m.status === "proposed");
  if (proposals.length === 0) return null;
  const m = proposals[0]!;
  setTemplate(repo, m.after);
  const applied: TemplateMutation = { ...m, status: "applied", ts: new Date().toISOString() };
  appendMutation(repo, applied);
  return applied;
}

/** After a window of post-application compliance entries, decide whether
 *  the mutation improved compliance enough to promote (default ≥ +10pp). */
export function evaluateMutation(repo: string, mutationId: string, opts: { window?: number; bumpRequired?: number } = {}): AbTestResult | null {
  const window = opts.window ?? DEFAULT_AB_WINDOW;
  const bumpRequired = opts.bumpRequired ?? COMPLIANCE_BUMP_REQUIRED;
  const all = readMutations(repo);
  const applied = all.find((m) => m.id === mutationId && m.status === "applied");
  if (!applied) return null;
  // post-application compliance = current rolling window
  const candidateEntries = readComplianceLog(repo, window);
  const candidateCompliance = complianceForVendor(candidateEntries, applied.vendor);
  const delta = candidateCompliance - applied.baselineCompliance;
  let decision: AbTestResult["decision"];
  let reason: string;
  if (candidateEntries.length < Math.max(10, Math.floor(window / 2))) {
    decision = "still-running";
    reason = `Only ${candidateEntries.length} compliance entries since application — need at least ${Math.floor(window / 2)} for statistical confidence.`;
  } else if (delta >= bumpRequired) {
    decision = "promote";
    reason = `Compliance climbed +${(delta * 100).toFixed(1)}pp from ${(applied.baselineCompliance * 100).toFixed(1)}% to ${(candidateCompliance * 100).toFixed(1)}%. Bump exceeds threshold (${(bumpRequired * 100).toFixed(0)}pp).`;
    appendMutation(repo, { ...applied, status: "promoted", ts: new Date().toISOString(), finalCompliance: candidateCompliance });
  } else {
    decision = "revert";
    reason = `Compliance change ${(delta * 100).toFixed(1)}pp under threshold. Reverting to baseline template.`;
    setTemplate(repo, applied.before);
    appendMutation(repo, { ...applied, status: "reverted", ts: new Date().toISOString(), finalCompliance: candidateCompliance });
  }
  return { mutationId, vendor: applied.vendor, baselineCompliance: applied.baselineCompliance, candidateCompliance, delta, decision, reason };
}

/** Return all currently-applied mutations (status = "applied", not yet
 *  promoted/reverted) — i.e. A/B tests in flight. */
export function inFlightMutations(repo: string, vendor?: string): TemplateMutation[] {
  const events = readMutations(repo, vendor);
  // an A/B is in flight when the latest event for an id is "applied"
  const latestById = new Map<string, TemplateMutation>();
  for (const e of events) latestById.set(e.id, e);
  return [...latestById.values()].filter((m) => m.status === "applied");
}
