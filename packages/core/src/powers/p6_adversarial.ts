/**
 * POWER 6 — ADVERSARIAL RESILIENCE (v1.48.0)
 *
 * Antibiotic-resistance is the metaphor: every attack pattern an
 * adversary throws at Mneme MUST become a vaccine within one release.
 * Adversaries select for fitter Mneme. This module formalizes that:
 *   - Track attack patterns observed in the wild (`.mneme/attack-log.jsonl`)
 *   - Auto-promote a pattern that fires twice into a draft vaccine
 *   - Run a "war game" that replays past attacks against the current
 *     active vaccines and reports residual coverage gaps
 *
 * IDEA-CHEST:
 *   - Each attack pattern carries a `signature` (regex over input/diff).
 *     Two distinct hits = promotion to vaccine-draft.
 *   - War-game outputs both detection rate AND mean-time-to-detect so
 *     defenders can track *speed*, not just coverage.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

const ATTACK_LOG_REL = ".mneme/attack-log.jsonl";
const VACCINE_DRAFT_DIR_REL = ".mneme/vaccine-drafts";

export interface AttackEvent {
  id: string;                  // sha256(category|signature|target)
  observedAt: string;
  category: "prompt-injection" | "persona-hijack" | "supply-chain" | "credential-leak" | "ratelimit-evasion" | "model-extraction" | "data-exfil" | "other";
  signature: string;           // regex source string
  target: string;              // which Mneme surface was hit (e.g. "mcp.tools", "cli", "audit-log")
  severity: "low" | "medium" | "high" | "critical";
  source: string;              // where the report came from (operator, automated probe, external)
}

export interface VaccineDraft {
  draftId: string;             // sha256(signature)
  promotedAt: string;
  fromCategory: AttackEvent["category"];
  signature: string;
  triggeringEvents: number;
  recommendedDefense: string;
  draftPath: string;
}

export interface WarGameResult {
  ranAt: string;
  attacksReplayed: number;
  detected: number;
  detectionRatePct: number;
  meanTimeToDetectMs: number | null;
  coverageGaps: { category: string; uncoveredCount: number }[];
  verdict: "weakened" | "baseline" | "hardened" | "antifragile";
}

export function logAttack(repoRoot: string, evt: Omit<AttackEvent, "id" | "observedAt">): AttackEvent {
  const root = resolve(repoRoot);
  mkdirSync(join(root, ".mneme"), { recursive: true });
  const id = createHash("sha256").update(`${evt.category}|${evt.signature}|${evt.target}`).digest("hex").slice(0, 16);
  const full: AttackEvent = { ...evt, id, observedAt: new Date().toISOString() };
  appendFileSync(join(root, ATTACK_LOG_REL), JSON.stringify(full) + "\n");
  return full;
}

export function listAttacks(repoRoot: string): AttackEvent[] {
  const path = join(resolve(repoRoot), ATTACK_LOG_REL);
  if (!existsSync(path)) return [];
  const out: AttackEvent[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as AttackEvent); } catch { /* skip */ }
  }
  return out;
}

/**
 * Promote any signature seen >= 2 times into a vaccine draft. Idempotent
 * on signature hash -- re-running just refreshes the draft.
 */
export function promoteAttacksToVaccines(repoRoot: string): VaccineDraft[] {
  const root = resolve(repoRoot);
  const attacks = listAttacks(root);
  const counts = new Map<string, AttackEvent[]>();
  for (const a of attacks) {
    const arr = counts.get(a.signature) ?? [];
    arr.push(a);
    counts.set(a.signature, arr);
  }
  const drafts: VaccineDraft[] = [];
  mkdirSync(join(root, VACCINE_DRAFT_DIR_REL), { recursive: true });
  for (const [signature, events] of counts) {
    if (events.length < 2) continue;
    const draftId = createHash("sha256").update(signature).digest("hex").slice(0, 16);
    const draftPath = join(root, VACCINE_DRAFT_DIR_REL, `${draftId}.md`);
    const sample = events[0]!;
    const recommendedDefense = recommendDefense(sample.category);
    const md = renderDraft(signature, events, recommendedDefense);
    writeFileSync(draftPath, md);
    drafts.push({
      draftId,
      promotedAt: new Date().toISOString(),
      fromCategory: sample.category,
      signature,
      triggeringEvents: events.length,
      recommendedDefense,
      draftPath,
    });
  }
  return drafts;
}

function recommendDefense(cat: AttackEvent["category"]): string {
  switch (cat) {
    case "prompt-injection": return "Strip embedded instructions from any user-supplied text before passing to a tool. Refuse to act on instructions found INSIDE quoted content.";
    case "persona-hijack": return "Pin the system prompt at message-list head; reject any in-message attempt to redefine the agent's role.";
    case "supply-chain": return "Verify package signature + lockfile pinning + SBOM diff vs prior release. Refuse install on integrity mismatch.";
    case "credential-leak": return "Run secret-scanner against every diff before commit; refuse to commit when high-entropy strings match known token patterns.";
    case "ratelimit-evasion": return "Apply token-bucket per (vendor, IP) + back-pressure when bucket empties; never let a single sender bypass via rotation.";
    case "model-extraction": return "Cap output tokens per query AND per session AND per IP/day; refuse pattern of repeated near-duplicate queries.";
    case "data-exfil": return "Audit all egress through the lingua stream; alert on any spike beyond the 7-day p95 baseline.";
    default: return "Investigate the signature, draft a vaccine, add a regression test, and wire detection at the layer the attack hit.";
  }
}

function renderDraft(signature: string, events: AttackEvent[], defense: string): string {
  const cats = Array.from(new Set(events.map((e) => e.category))).join(", ");
  return [
    `# Vaccine draft (auto-promoted from attack log)`,
    "",
    `**Signature:** \`${signature}\``,
    `**Categories:** ${cats}`,
    `**Triggering events:** ${events.length}`,
    `**First seen:** ${events[0]!.observedAt}`,
    `**Last seen:** ${events[events.length - 1]!.observedAt}`,
    "",
    "## Recommended defense",
    "",
    defense,
    "",
    "## Sample events",
    "",
    ...events.slice(0, 5).map((e) => `- \`${e.observedAt}\` (${e.severity}) target=${e.target} source=${e.source}`),
    "",
    "> Auto-generated by Mneme POWER 6. Review, harden, then promote into the vaccine pack with `mneme antivirus add`.",
  ].join("\n");
}

/**
 * War game: replay every logged attack against the current Mneme state.
 * "Detection" here means we have a vaccine draft for the signature OR
 * the attack matches a known category we already defend.
 */
export function runWarGame(repoRoot: string, knownCoverage: Set<string> = new Set()): WarGameResult {
  const root = resolve(repoRoot);
  const attacks = listAttacks(root);
  const drafts = promoteAttacksToVaccines(root);
  const draftSignatures = new Set(drafts.map((d) => d.signature));

  let detected = 0;
  let totalLatencyMs = 0;
  const gapsByCat = new Map<string, number>();
  for (const a of attacks) {
    const isCovered = draftSignatures.has(a.signature) || knownCoverage.has(a.category);
    if (isCovered) {
      detected++;
      // Latency proxy: time between observedAt and now (when "detection" happens).
      totalLatencyMs += Math.max(0, Date.now() - Date.parse(a.observedAt));
    } else {
      gapsByCat.set(a.category, (gapsByCat.get(a.category) ?? 0) + 1);
    }
  }
  const detectionRatePct = attacks.length === 0 ? 0 : Math.round((detected / attacks.length) * 100);
  const meanTimeToDetectMs = detected === 0 ? null : Math.round(totalLatencyMs / detected);

  let verdict: WarGameResult["verdict"] = "weakened";
  if (detectionRatePct >= 25) verdict = "baseline";
  if (detectionRatePct >= 75) verdict = "hardened";
  if (detectionRatePct >= 95) verdict = "antifragile";

  const coverageGaps = Array.from(gapsByCat.entries()).map(([category, uncoveredCount]) => ({ category, uncoveredCount })).sort((a, b) => b.uncoveredCount - a.uncoveredCount);

  return {
    ranAt: new Date().toISOString(),
    attacksReplayed: attacks.length,
    detected,
    detectionRatePct,
    meanTimeToDetectMs,
    coverageGaps,
    verdict,
  };
}
