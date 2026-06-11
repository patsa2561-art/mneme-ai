/**
 * ARCHITECTURAL REGRESSION FIREWALL — the gatekeeper for AI-generated change.
 *
 * The thesis: when producing code costs nothing, the expensive thing is PROVING that the code an AI just
 * generated didn't silently break an architectural contract the system has stood on for years. Everyone
 * ships a code GENERATOR (Copilot, Cursor); nobody ships the GATE that remembers what contracts hold and
 * blocks the moment an AI is about to violate one. This is that gate.
 *
 * It composes three Mneme primitives that already exist into one verdict:
 *   • mineInvariants / analyzeRegressions — the contracts the repo upheld at a baseline, and which are
 *     now VIOLATED (with the offending counterexample, pointing at the real symbol).
 *   • arch_lineage — how long each contract has stood (its load-bearing strength).
 *   • a POLICY layer (this module) — architect-DECLARED rules + severities, and severity-by-age, fused
 *     into PASS / WARN / BLOCK with an enforcement-ready exit.
 *
 * The verdict an AI agent or a CI gate reads: breaking a contract that has held for two years is a crime
 * (BLOCK); breaking one that is three days old is normal evolution (INFO). The age does the weighting.
 *
 * ★HONEST (DIAKRISIS): every violation here is a contract PROVEN to hold at the baseline and PROVEN
 * VIOLATED now (re-checkable, with the counterexample) — not a guess. Age is measured from git, not
 * predicted. A BLOCK is a strong signal a human/agent should heed, but a violation can still be an
 * intended evolution — which is exactly why an architect can DECLARE a rule's severity (or ratify the
 * change by moving the baseline). The firewall decides + surfaces; it does not pretend the change is
 * malicious.
 */
import { analyzeRegressions } from "../arch_regressions/index.js";
import { checkInvariants, parseInvariants } from "../invariants/index.js";
import { type SourceFile } from "../cross_layer_graph/index.js";

export type Severity = "critical" | "warn" | "info";
const SEV_RANK: Record<Severity, number> = { critical: 3, warn: 2, info: 1 };
export interface Policy { rule: string; severity: Severity; raw: string }

/**
 * Parse a policy file. Each non-comment line is `[critical|warn|info] <invariant-rule>`; the severity
 * prefix is optional (defaults to `warn`). e.g. `critical table wallet single-writer`.
 */
export function parsePolicy(text: string): Policy[] {
  const out: Policy[] = [];
  for (const line0 of String(text ?? "").split("\n")) {
    const line = line0.replace(/#.*$/, "").trim(); if (!line) continue;
    const m = /^(critical|warn|info)\s+(.*)$/i.exec(line);
    const severity = (m ? m[1].toLowerCase() : "warn") as Severity;
    const rule = (m ? m[2] : line).trim();
    if (rule) out.push({ rule, severity, raw: line });
  }
  return out;
}

/** Severity weighted by how long a contract has stood. Old contract broken = crime; young = evolution. */
export function severityFromAge(ageDays: number | null | undefined): Severity {
  if (ageDays == null) return "warn";          // unknown age → cautious default
  if (ageDays >= 365) return "critical";        // foundational — breaking it is high-risk
  if (ageDays >= 90) return "warn";             // established — flag loudly
  return "info";                                // young — normal evolution
}

export interface AgeInfo { ageDays: number; establishedAt?: string; heldThroughCommits?: number }
export interface FirewallViolation {
  rule: string; severity: Severity; reason: string; counterexample?: string;
  source: "mined" | "declared"; ageDays?: number | null; establishedAt?: string; heldThroughCommits?: number;
}
export interface FirewallVerdict { verdict: "PASS" | "WARN" | "BLOCK"; violations: FirewallViolation[]; critical: number; warn: number; info: number; checkedContracts: number; declaredChecked: number }

function declaredSeverity(policies: ReadonlyArray<Policy>, rule: string): Severity | null {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const hit = (policies ?? []).find((p) => norm(p.rule) === norm(rule));
  return hit ? hit.severity : null;
}

/**
 * Run the firewall: which baseline contracts (and which architect-declared policies) does the current
 * code violate, weighted into PASS / WARN / BLOCK. `ageResolver` (optional, git-backed in the caller)
 * supplies how long each violated contract has stood; in tests pass a stub.
 */
export function firewall(
  baselineFiles: ReadonlyArray<SourceFile>,
  currentFiles: ReadonlyArray<SourceFile>,
  opts?: { policies?: ReadonlyArray<Policy>; ageResolver?: (rule: string) => AgeInfo | null },
): FirewallVerdict {
  const policies = opts?.policies ?? [];
  const violations: FirewallViolation[] = [];
  const seen = new Set<string>();

  // 1. mined-baseline regressions — contracts the repo upheld at baseline, now violated.
  const reg = analyzeRegressions(baselineFiles, currentFiles);
  for (const r of reg.regressed) {
    const age = opts?.ageResolver ? opts.ageResolver(r.rule) : null;
    const severity = declaredSeverity(policies, r.rule) ?? severityFromAge(age?.ageDays ?? null);
    violations.push({ rule: r.rule, severity, reason: r.reason, counterexample: r.counterexample, source: "mined", ageDays: age?.ageDays ?? null, establishedAt: age?.establishedAt, heldThroughCommits: age?.heldThroughCommits });
    seen.add(r.rule.toLowerCase().replace(/\s+/g, " ").trim());
  }

  // 2. architect-DECLARED policies the current code does not satisfy (even if never mined as a contract).
  if (policies.length) {
    const parsed = parseInvariants(policies.map((p) => p.rule).join("\n"));
    const res = checkInvariants(currentFiles, parsed);
    for (const c of res.results) {
      if (c.status !== "VIOLATED") continue;
      const key = c.invariant.raw.toLowerCase().replace(/\s+/g, " ").trim();
      if (seen.has(key)) continue;                       // already reported as a regression
      const sev = declaredSeverity(policies, c.invariant.raw) ?? "warn";
      violations.push({ rule: c.invariant.raw, severity: sev, reason: c.reason, counterexample: c.counterexample, source: "declared" });
      seen.add(key);
    }
  }

  violations.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || a.rule.localeCompare(b.rule));
  const critical = violations.filter((v) => v.severity === "critical").length;
  const warn = violations.filter((v) => v.severity === "warn").length;
  const info = violations.filter((v) => v.severity === "info").length;
  const verdict: FirewallVerdict["verdict"] = critical > 0 ? "BLOCK" : warn > 0 ? "WARN" : "PASS";
  return { verdict, violations, critical, warn, info, checkedContracts: reg.baselineContracts, declaredChecked: policies.length };
}

/** A human/PR-comment rendering of the verdict, with the killer line per violation. */
export function firewallReport(v: FirewallVerdict): string {
  const ic = (s: Severity) => s === "critical" ? "🔴" : s === "warn" ? "🟠" : "🔵";
  const head = v.verdict === "BLOCK" ? "🛑 ARCHITECTURAL FIREWALL — BLOCKED" : v.verdict === "WARN" ? "🟠 ARCHITECTURAL FIREWALL — WARN" : "✅ ARCHITECTURAL FIREWALL — PASS";
  const lines = [head, `${v.violations.length} violation(s) · ${v.critical} critical · ${v.warn} warn · ${v.info} info · ${v.checkedContracts} contract(s) checked`];
  for (const x of v.violations) {
    const age = x.ageDays != null ? ` (held ${x.ageDays}d${x.heldThroughCommits ? `, through ${x.heldThroughCommits} commits` : ""}${x.establishedAt ? `, set at ${x.establishedAt}` : ""})` : "";
    lines.push(`${ic(x.severity)} ${x.severity.toUpperCase()} — violated invariant "${x.rule}"${age}`);
    if (x.counterexample) lines.push(`     ↳ ${x.counterexample}`);
  }
  return lines.join("\n");
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface ArchFirewallGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function archFirewallGauntlet(): ArchFirewallGauntlet {
  const baseline: SourceFile[] = [
    { path: "schema.prisma", content: "model Wallet { id Int @id }\nmodel Note { id Int @id }" },
    { path: "a.ts", content: "export function charge(){ return prisma.wallet.create({data:{}}); }\nexport function readNote(){ return prisma.note.findMany(); }" },
  ];
  const broke: SourceFile[] = [...baseline, { path: "refund.ts", content: "export function refundHandler(){ return prisma.wallet.update({where:{}}); }" }];

  // (a) old contract broken with no policy → severity from age → critical → BLOCK + counterexample names refundHandler.
  const oldAge = firewall(baseline, broke, { ageResolver: () => ({ ageDays: 426, establishedAt: "a1b2c3", heldThroughCommits: 312 }) });
  const blocksOld = oldAge.verdict === "BLOCK" && oldAge.critical === 1 && oldAge.violations[0].severity === "critical"
    && /refundHandler/.test(oldAge.violations[0].counterexample || "") && oldAge.violations[0].heldThroughCommits === 312;

  // (b) same break but YOUNG contract → info → not blocked (normal evolution).
  const youngAge = firewall(baseline, broke, { ageResolver: () => ({ ageDays: 3 }) });
  const youngIsEvolution = youngAge.verdict !== "BLOCK" && youngAge.violations[0].severity === "info";

  // (c) declared-critical policy forces BLOCK regardless of (here, young) age.
  const declared = firewall(baseline, broke, { policies: parsePolicy("critical table wallet single-writer"), ageResolver: () => ({ ageDays: 3 }) });
  const declaredWins = declared.verdict === "BLOCK" && declared.violations[0].severity === "critical";

  // (d) no regression → PASS.
  const clean = firewall(baseline, baseline, { ageResolver: () => ({ ageDays: 999 }) });

  // (e) parsing + age mapping.
  const p = parsePolicy("# comment\ncritical table wallet single-writer\nwarn endpoint POST /x exists\ntable note private");
  const parseOK = p.length === 3 && p[0].severity === "critical" && p[1].severity === "warn" && p[2].severity === "warn";
  const ageOK = severityFromAge(400) === "critical" && severityFromAge(120) === "warn" && severityFromAge(5) === "info" && severityFromAge(null) === "warn";

  const total = (() => { try { firewall(null as never, null as never); parsePolicy(null as never); severityFromAge(undefined); firewallReport({ verdict: "PASS", violations: [], critical: 0, warn: 0, info: 0, checkedContracts: 0, declaredChecked: 0 }); return true; } catch { return false; } })();

  const checks = [
    { name: "BLOCK-OLD-CONTRACT", pass: blocksOld, detail: "breaking a 426-day contract → critical → BLOCK; counterexample names the 2nd writer (refundHandler); heldThrough=312" },
    { name: "YOUNG-IS-EVOLUTION", pass: youngIsEvolution, detail: "breaking a 3-day contract → info → not blocked (normal evolution)" },
    { name: "DECLARED-OVERRIDES-AGE", pass: declaredWins, detail: "an architect-declared critical policy forces BLOCK regardless of age" },
    { name: "CLEAN-PASSES", pass: clean.verdict === "PASS" && !clean.violations.length, detail: "no regression → PASS" },
    { name: "POLICY-PARSE+AGE", pass: parseOK && ageOK, detail: "policy DSL parses severity prefix (default warn); severity-by-age thresholds correct" },
    { name: "TOTAL", pass: total, detail: "null/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
