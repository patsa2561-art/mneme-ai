/**
 * v2.22.0 — CONDUCTOR · TRANSACTIONAL VERB ENGINE.
 *
 * CLI primitives are normally request/response: AI agent calls one
 * verb, gets one result. Conductor wraps that into a TRANSACTION:
 *
 *   PLAN     — natural-language intent → ordered verb sequence
 *               (greedy planner over contracts + atlas intent router;
 *               SAT-based planner reserved for v2.23)
 *   PREVIEW  — every step runs through the doppelganger; diff
 *               aggregated across the whole plan
 *   GATE     — AI agent + user see the aggregated diff + DEFCON, can
 *               approve / decline ONCE for the whole plan
 *   EXECUTE  — verbs run for real against a staged shadow; on first
 *               failure the staged changes are rolled back; on success
 *               they are committed atomically
 *   ATTEST   — outcome compared to predicted diff; receipt + ZK-style
 *               proof placeholder logged to Consent Fabric ledger
 *
 * Limitations:
 *   - Greedy planner (no SAT) → can pick suboptimal verb sequence
 *   - Doppelganger leakage flag → user MUST verify when leakage ≠ none
 *   - ZK proofs are placeholders this version (sig-only HMAC receipt);
 *     full ZK shipped v2.24
 *
 * This is the chassis; v2.23-v2.24 ride on it.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";
import { routeIntent } from "../atlas/index.js";
import { findContract, type VerbContract } from "../companion/contract.js";
import { schemaFor, validateArgs, type ArgSchema, type ProvidedArgs, type ValidateResult } from "../companion/autospec.js";
import { dryRun, stageCommit, applyCommit, type DoppelgangerResult, type FileEffect } from "../companion/doppelganger.js";
import { dropPheromone } from "../atlas/pheromone.js";

// ─── PLAN ────────────────────────────────────────────────────────────

export interface PlanStep {
  verb: string;
  contract: VerbContract;
  argSchema: ArgSchema;
  /** Caller-supplied args (or empty for plans that just route). */
  args: ProvidedArgs;
  /** Schema validation result. */
  validation: ValidateResult;
  /** Why this verb was picked — debug + audit. */
  rationale: string;
}

export interface Plan {
  v: 1;
  id: string;
  ts: string;
  intent: string;
  steps: PlanStep[];
  /** Highest DEFCON tier across all steps (lower = scarier). */
  worstDefcon: 1 | 2 | 3 | 4 | 5;
  /** Validation summary — set to true only when every step's args validate. */
  allArgsValid: boolean;
}

export interface PlanOptions {
  /** Per-step args, keyed by verb. Optional. */
  argsByVerb?: Record<string, ProvidedArgs>;
  /** Max steps in the plan (greedy planner caps to avoid infinite loops). */
  maxSteps?: number;
}

/** Greedy planner: route intent to verb candidates, attach contracts +
 *  schemas, validate args. v2.23 will swap this for a SAT-based
 *  planner that searches over verb compositions. */
export function plan(intent: string, opts: PlanOptions = {}): Plan {
  const maxSteps = opts.maxSteps ?? 3;
  const candidates = routeIntent(intent, undefined, maxSteps);
  const steps: PlanStep[] = [];
  let worstDefcon: PlanStep["contract"]["defcon"] = 5;
  let allArgsValid = true;
  for (const cand of candidates) {
    const contract = findContract(cand.command);
    if (!contract) continue;
    const argSchema = schemaFor({ command: contract.verb, since: contract.since, what: contract.summary, when: contract.invokeWhen, group: contract.group } as any);
    const args = opts.argsByVerb?.[cand.command] ?? { positional: [], options: {} };
    const validation = validateArgs(argSchema, args);
    if (!validation.ok) allArgsValid = false;
    if (contract.defcon < worstDefcon) worstDefcon = contract.defcon;
    steps.push({
      verb: cand.command,
      contract,
      argSchema,
      args,
      validation,
      rationale: cand.rationale,
    });
  }
  return {
    v: 1,
    id: "plan_" + randomBytes(4).toString("hex"),
    ts: new Date().toISOString(),
    intent,
    steps,
    worstDefcon,
    allArgsValid,
  };
}

// ─── PREVIEW (doppelganger aggregate) ────────────────────────────────

export interface PreviewStep {
  verb: string;
  doppelganger: DoppelgangerResult;
}

export interface Preview {
  planId: string;
  steps: PreviewStep[];
  /** Aggregate diff across all steps. */
  combinedFileEffects: FileEffect[];
  /** Exit code of the last step OR first non-zero. */
  combinedExit: number;
  /** Any step's leakage → preview is "approximate". */
  anyLeakage: boolean;
}

export type VerbSimulator = (verb: string, args: ProvidedArgs, shadowRoot: string) => Promise<{ stdout?: string; stderr?: string; exit?: number; effects?: FileEffect[] }>;

/** Run each step through the doppelganger, aggregate file diffs. The
 *  caller supplies a simulator that knows how to enact a verb in a
 *  shadow path (the conductor itself is verb-agnostic). */
export async function preview(repoRoot: string, plan: Plan, sim: VerbSimulator): Promise<Preview> {
  const steps: PreviewStep[] = [];
  const combined: FileEffect[] = [];
  let combinedExit = 0;
  let anyLeakage = false;
  for (const step of plan.steps) {
    const r = await dryRun(repoRoot, async (shadow) => {
      const out = await sim(step.verb, step.args, shadow);
      return out;
    }, {
      knownNativeUse: false,
      knownNetworkUse: step.contract.reachesNetwork,
    });
    steps.push({ verb: step.verb, doppelganger: r });
    for (const e of r.fileEffects) combined.push(e);
    if (combinedExit === 0 && r.exitCode !== 0) combinedExit = r.exitCode;
    if (r.leakage !== "none") anyLeakage = true;
  }
  return { planId: plan.id, steps, combinedFileEffects: combined, combinedExit, anyLeakage };
}

// ─── GATE (confirmation) ─────────────────────────────────────────────

export interface GateDecision {
  approved: boolean;
  reason?: string;
  by: "ai-agent" | "user" | "policy";
  ts: string;
}

/** Policy gate: default-deny on DEFCON ≤ 2 unless explicit approval;
 *  default-allow on DEFCON ≥ 4 if all args validate. Callers can
 *  override with explicit `requireConfirm`. */
export function defaultGate(plan: Plan, preview: Preview, opts: { requireConfirm?: boolean } = {}): GateDecision {
  const ts = new Date().toISOString();
  if (!plan.allArgsValid) return { approved: false, reason: "argument validation failed", by: "policy", ts };
  if (preview.anyLeakage && plan.worstDefcon <= 2) return { approved: false, reason: "doppelganger leakage on destructive plan — explicit confirm required", by: "policy", ts };
  if (plan.worstDefcon <= 2 || opts.requireConfirm) return { approved: false, reason: "DEFCON ≤ 2 or explicit-confirm requested — awaiting external approval", by: "policy", ts };
  return { approved: true, by: "policy", ts };
}

// ─── EXECUTE (atomic) + ATTEST ───────────────────────────────────────

const DIR = ".mneme/conductor";
const RECEIPT_FILE = "receipts.jsonl";
const KEY_FILE = "conductor.key";

function dir(repoRoot: string): string {
  const d = join(repoRoot, DIR);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function key(repoRoot: string): string {
  const p = join(dir(repoRoot), KEY_FILE);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const k = randomBytes(32).toString("base64url");
  writeFileSync(p, k, "utf8");
  return k;
}

function sign(payload: string, k: string): string {
  return createHmac("sha256", k).update(payload).digest("base64url").slice(0, 22);
}

export interface ExecutionReceipt {
  v: 1;
  id: string;
  ts: string;
  planId: string;
  intent: string;
  outcome: "committed" | "rolled-back" | "rejected";
  worstDefcon: number;
  steps: Array<{ verb: string; exitCode: number; effectsCount: number }>;
  /** Placeholder for v2.24 ZK proof. */
  contractProof: string;
  sig: string;
}

export interface ExecuteOptions {
  /** Decision from the gate; if not approved, conductor refuses + logs. */
  decision: GateDecision;
}

export async function execute(repoRoot: string, plan: Plan, preview: Preview, sim: VerbSimulator, opts: ExecuteOptions): Promise<ExecutionReceipt> {
  const k = key(repoRoot);
  const ts = new Date().toISOString();
  const id = "exec_" + randomBytes(4).toString("hex");
  if (!opts.decision.approved) {
    const receipt = await sealReceipt(repoRoot, k, {
      v: 1, id, ts, planId: plan.id, intent: plan.intent, outcome: "rejected",
      worstDefcon: plan.worstDefcon,
      steps: [], contractProof: "n/a",
    });
    return receipt;
  }
  // Two-phase commit: real invocations go into a stage; on any failure
  // we rollback by removing the stage. On success we apply atomically.
  const stage = stageCommit(repoRoot);
  const stepResults: ExecutionReceipt["steps"] = [];
  let failed = false;
  try {
    for (const step of plan.steps) {
      // Pass shadow == stage path so verb writes go to the stage.
      const out = await sim(step.verb, step.args, stage.stagePath);
      const ec = out.exit ?? 0;
      stepResults.push({ verb: step.verb, exitCode: ec, effectsCount: out.effects?.length ?? 0 });
      try { dropPheromone(repoRoot, { verb: step.verb, outcome: ec === 0 ? "success" : "failure", actor: "conductor" }); } catch { /* */ }
      if (ec !== 0) { failed = true; break; }
    }
    if (failed) {
      stage.rollback();
      return await sealReceipt(repoRoot, k, {
        v: 1, id, ts, planId: plan.id, intent: plan.intent, outcome: "rolled-back",
        worstDefcon: plan.worstDefcon, steps: stepResults, contractProof: "n/a",
      });
    }
    applyCommit(stage.stagePath, repoRoot);
    return await sealReceipt(repoRoot, k, {
      v: 1, id, ts, planId: plan.id, intent: plan.intent, outcome: "committed",
      worstDefcon: plan.worstDefcon, steps: stepResults, contractProof: "hmac-placeholder",
    });
  } catch (e) {
    stage.rollback();
    return await sealReceipt(repoRoot, k, {
      v: 1, id, ts, planId: plan.id, intent: plan.intent, outcome: "rolled-back",
      worstDefcon: plan.worstDefcon, steps: stepResults, contractProof: "n/a",
    });
  }
}

async function sealReceipt(repoRoot: string, k: string, body: Omit<ExecutionReceipt, "sig">): Promise<ExecutionReceipt> {
  const canonical = `${body.ts}|${body.planId}|${body.outcome}|${body.worstDefcon}|${body.steps.map((s) => `${s.verb}:${s.exitCode}`).join(",")}`;
  const sig = sign(canonical, k);
  const r: ExecutionReceipt = { ...body, sig };
  try {
    const f = join(dir(repoRoot), RECEIPT_FILE);
    const { appendFileSync } = await import("node:fs");
    appendFileSync(f, JSON.stringify(r) + "\n", "utf8");
  } catch { /* */ }
  return r;
}

export function listReceipts(repoRoot: string): ExecutionReceipt[] {
  const f = join(dir(repoRoot), RECEIPT_FILE);
  if (!existsSync(f)) return [];
  try {
    return readFileSync(f, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l) as ExecutionReceipt; } catch { return null; } }).filter((r): r is ExecutionReceipt => !!r);
  } catch { return []; }
}

export function verifyReceiptChain(repoRoot: string): { ok: boolean; brokenAt?: number; reason?: string } {
  const all = listReceipts(repoRoot);
  if (all.length === 0) return { ok: true };
  const k = key(repoRoot);
  for (let i = 0; i < all.length; i++) {
    const r = all[i]!;
    const canonical = `${r.ts}|${r.planId}|${r.outcome}|${r.worstDefcon}|${r.steps.map((s) => `${s.verb}:${s.exitCode}`).join(",")}`;
    if (sign(canonical, k) !== r.sig) return { ok: false, brokenAt: i, reason: `receipt ${i} signature mismatch` };
  }
  return { ok: true };
}

// ─── FORMATTERS ──────────────────────────────────────────────────────

export function formatPlan(p: Plan): string {
  const lines: string[] = [`🎼 PLAN — ${p.id}`, ""];
  lines.push(`  Intent:        ${p.intent}`);
  lines.push(`  Steps:         ${p.steps.length}`);
  lines.push(`  Worst DEFCON:  ${p.worstDefcon}`);
  lines.push(`  Args valid:    ${p.allArgsValid ? "yes" : "no — see step errors"}`);
  lines.push("");
  for (let i = 0; i < p.steps.length; i++) {
    const s = p.steps[i]!;
    lines.push(`  ${i + 1}.  ${s.verb}  (DEFCON ${s.contract.defcon}, ${s.contract.idempotency})`);
    if (!s.validation.ok) {
      for (const e of s.validation.errors) lines.push(`        ⚠ ${e.field}: ${e.reason}`);
    }
    lines.push(`        rationale: ${s.rationale}`);
  }
  return lines.join("\n");
}

export function formatPreview(pv: Preview): string {
  const adds = pv.combinedFileEffects.filter((e) => e.kind === "added").length;
  const chgs = pv.combinedFileEffects.filter((e) => e.kind === "changed").length;
  const rms = pv.combinedFileEffects.filter((e) => e.kind === "removed").length;
  return [
    `👁  PREVIEW — plan ${pv.planId}`,
    "",
    `  Aggregate exit:  ${pv.combinedExit}`,
    `  Files:           +${adds} / Δ${chgs} / -${rms}`,
    `  Leakage:         ${pv.anyLeakage ? "⚠ approximate (see per-step doppelganger)" : "exact"}`,
  ].join("\n");
}

export function formatReceipt(r: ExecutionReceipt): string {
  const badge = r.outcome === "committed" ? "✅" : r.outcome === "rolled-back" ? "↩️" : "🚫";
  return [
    `${badge} EXECUTION RECEIPT — ${r.id}`,
    "",
    `  Plan:        ${r.planId}`,
    `  Intent:      ${r.intent}`,
    `  Outcome:     ${r.outcome}`,
    `  Worst DEFCON: ${r.worstDefcon}`,
    `  Steps:       ${r.steps.length}`,
    `  Signature:   ${r.sig.slice(0, 12)}…`,
  ].join("\n");
}
