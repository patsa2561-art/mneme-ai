/**
 * ARCHITECTURAL REGRESSION FIREWALL — the gate for AI-generated change.
 *
 * The thesis: when producing code costs nothing, the expensive thing is PROVING that the code an AI just
 * generated didn't silently break an architectural contract the system has stood on for years. Everyone
 * ships a code GENERATOR; nobody ships the GATE that remembers what contracts hold and blocks the moment
 * one is about to be violated. This is that gate.
 *
 * It composes three Mneme primitives that already exist into one verdict:
 *   • mineInvariants / analyzeRegressions — the contracts the repo upheld at a baseline, and which are
 *     now VIOLATED (with the offending counterexample, pointing at the real symbol).
 *   • arch_lineage — how long each contract has stood (its load-bearing strength) + whether it flickered.
 *   • a POLICY layer (this module) — a severity ladder weighted by contract age, architect-DECLARED rules
 *     + overrides, and time-boxed WAIVERS, fused into PASS / WARN / BLOCK with an enforcement-ready exit.
 *
 * Severity model (5-rung ladder info<low<medium<high<critical):
 *   final = base(kind/override)  + age-tier bump  − (UNKNOWN ? 1 : 0)
 *   • base — a single-writer/private/guarded contract starts at `high`, an existence contract at `medium`;
 *     an architect can pin any rule's base via the policy.
 *   • age bump — breaking a contract that has stood for years escalates it (e.g. +2 ≥730d, +1 ≥180d); a
 *     contract that FLICKERED (held, broke, re-held) is less load-bearing, so its bump is capped at +1.
 *   • UNKNOWN penalty — a contract that became UNKNOWN (its table moved/renamed) is a weaker signal, −1.
 * A WAIVER (rule + reason + optional `until` date) suppresses blocking — the architect's "ratified, I
 * know" — but an EXPIRED waiver is NOT honoured and is surfaced loudly. blockOn (default `critical`) is
 * the threshold a non-waived finding must reach to BLOCK.
 *
 * ★HONEST (DIAKRISIS): every finding is a contract PROVEN to hold at the baseline and PROVEN VIOLATED /
 * WEAKENED now (re-checkable, with the counterexample) — not a guess; age is measured from git, not
 * predicted; the severity math is shown in `rationale` so the verdict is auditable, not magic. A BLOCK is
 * a strong signal but a violation can still be an intended evolution — which is exactly why the policy
 * has overrides and time-boxed waivers, and why the baseline can be moved to ratify a change.
 */
import { analyzeRegressions } from "../arch_regressions/index.js";
import { checkInvariants, parseInvariants } from "../invariants/index.js";
import { type SourceFile } from "../cross_layer_graph/index.js";

export type Severity = "info" | "low" | "medium" | "high" | "critical";
const LADDER: Severity[] = ["info", "low", "medium", "high", "critical"];
const ord = (s: Severity): number => { const i = LADDER.indexOf(s); return i < 0 ? 2 : i; };
const fromOrd = (n: number): Severity => LADDER[Math.max(0, Math.min(LADDER.length - 1, n))];
const atLeast = (a: Severity, b: Severity) => ord(a) >= ord(b);
const norm = (s: string) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
/** Default base severity by invariant kind (an architect can override per rule in the policy). */
const BUILTIN_BASE: Record<string, Severity> = { "single-writer": "high", "private": "high", "guarded": "high", "exists": "medium" };

export interface AgeTier { minDays: number; bump: number }
export interface Waiver { rule: string; reason: string; until?: string }   // until = ISO YYYY-MM-DD; expired if until < today
export interface FirewallPolicy {
  name: string;
  defaults: Record<string, Severity>;       // base severity by invariant kind
  enforce: Array<{ rule: string; severity: Severity }>;  // exact-rule base overrides
  declared: string[];                        // rules to check even if not mined (architect's required set)
  waivers: Waiver[];
  ageWeight: boolean;
  ageTiers: AgeTier[];                       // first matching (by descending minDays) tier's bump applies
  blockOn: Severity;                         // a non-waived finding at/above this blocks
}
export const DEFAULT_POLICY: FirewallPolicy = {
  name: "default", defaults: {}, enforce: [], declared: [], waivers: [], ageWeight: true,
  ageTiers: [{ minDays: 730, bump: 2 }, { minDays: 180, bump: 1 }, { minDays: 14, bump: 0 }], blockOn: "critical",
};

/** Parse the line-DSL policy. Directives: `blockon <sev>`, `default <kind> <sev>`, `agetier <days> <bump>`,
 *  `waive [until=YYYY-MM-DD] <rule> :: <reason>`. Rule lines: `[<sev>] <invariant-rule>`. `#` comments. */
export function parsePolicy(text: string): FirewallPolicy {
  const p: FirewallPolicy = { ...DEFAULT_POLICY, defaults: {}, enforce: [], declared: [], waivers: [], ageTiers: [...DEFAULT_POLICY.ageTiers] };
  let nameSet = false;
  for (const line0 of String(text ?? "").split("\n")) {
    const line = line0.replace(/#.*$/, "").trim(); if (!line) continue;
    const lc = line.toLowerCase();
    if (lc.startsWith("name ")) { p.name = line.slice(5).trim(); nameSet = true; continue; }
    if (lc.startsWith("blockon ")) { const s = lc.slice(8).trim() as Severity; if (LADDER.includes(s)) p.blockOn = s; continue; }
    if (lc.startsWith("default ")) { const m = /^default\s+(\S+)\s+(info|low|medium|high|critical)\s*$/i.exec(line); if (m) p.defaults[m[1].toLowerCase()] = m[2].toLowerCase() as Severity; continue; }
    if (lc.startsWith("agetier ")) { const m = /^agetier\s+(\d+)\s+\+?(\d+)\s*$/i.exec(line); if (m) p.ageTiers.push({ minDays: parseInt(m[1], 10), bump: parseInt(m[2], 10) }); continue; }
    if (lc.startsWith("waive ")) {
      const rest = line.slice(6).trim();
      const um = /until=(\d{4}-\d{2}-\d{2})\s+/i.exec(rest);
      const after = um ? rest.slice(um.index + um[0].length) : rest;
      const [rulePart, ...reasonParts] = after.split("::");
      const rule = rulePart.trim(); const reason = reasonParts.join("::").trim() || "(no reason given)";
      if (rule) p.waivers.push({ rule, reason, ...(um ? { until: um[1] } : {}) });
      continue;
    }
    const sm = /^(critical|high|medium|low|info)\s+(.*)$/i.exec(line);
    if (sm) { const rule = sm[2].trim(); p.enforce.push({ rule, severity: sm[1].toLowerCase() as Severity }); p.declared.push(rule); }
    else p.declared.push(line);
  }
  // de-dupe agetiers (keep the user's; DEFAULT already seeded) — sort handled at scoring time.
  if (!nameSet && !p.name) p.name = "default";
  return p;
}

/** Load a policy from JSON (full structured) or the line DSL, merged onto DEFAULT_POLICY. */
export function loadPolicy(raw: string): FirewallPolicy {
  const t = String(raw ?? "").trim();
  if (t.startsWith("{")) { try { const j = JSON.parse(t); return { ...DEFAULT_POLICY, ...j, defaults: { ...j.defaults }, enforce: [...(j.enforce ?? [])], declared: [...(j.declared ?? [])], waivers: [...(j.waivers ?? [])], ageTiers: [...(j.ageTiers ?? DEFAULT_POLICY.ageTiers)] }; } catch { /* fall through */ } }
  return parsePolicy(t);
}

function baseSeverityFor(policy: FirewallPolicy, rule: string, kind: string): Severity {
  const pin = (policy.enforce ?? []).find((e) => norm(e.rule) === norm(rule));
  if (pin) return pin.severity;
  return policy.defaults?.[kind] ?? BUILTIN_BASE[kind] ?? "medium";
}

export interface ScoreInput { base: Severity; status: "VIOLATED" | "UNKNOWN"; ageDays: number | null; flickered?: boolean; ageWeight: boolean; ageTiers: ReadonlyArray<AgeTier> }
/** final = base + age-tier bump − UNKNOWN penalty, with a flicker cap and a transparent rationale. */
export function scoreSeverity(s: ScoreInput): { final: Severity; rationale: string } {
  let bump = 0, tier: number | null = null;
  if (s.ageWeight && s.ageDays != null) {
    for (const t of [...(s.ageTiers ?? [])].sort((a, b) => b.minDays - a.minDays)) if (s.ageDays >= t.minDays) { bump = t.bump; tier = t.minDays; break; }
    if (s.flickered) bump = Math.min(bump, 1);
  }
  const penalty = s.status === "UNKNOWN" ? 1 : 0;
  const final = fromOrd(ord(s.base) + bump - penalty);
  const why = [`base=${s.base}`];
  if (bump) why.push(`age≥${tier}d ⇒ +${bump}${s.flickered ? " (flicker-capped)" : ""}`);
  else if (s.ageWeight && s.ageDays != null) why.push(`age=${s.ageDays}d ⇒ +0`);
  if (penalty) why.push("UNKNOWN ⇒ −1");
  return { final, rationale: `${why.join(", ")} ⇒ ${final}` };
}

export interface AgeInfo { ageDays: number; establishedAt?: string; heldThroughCommits?: number; flickered?: boolean }
export interface FirewallFinding {
  rule: string; kind: string; status: "VIOLATED" | "UNKNOWN"; reason: string; counterexample?: string; source: "mined" | "declared";
  baseSeverity: Severity; finalSeverity: Severity; rationale: string; ageDays: number | null; establishedAt?: string; heldThroughCommits?: number;
  waived: boolean; waiverReason?: string; waiverExpired: boolean; blocking: boolean;
}
export interface FirewallVerdict {
  verdict: "PASS" | "WARN" | "BLOCK"; policyName: string; baselineContracts: number; findings: FirewallFinding[];
  blocked: boolean; blockedBy: FirewallFinding[]; expiredWaivers: FirewallFinding[]; waivedCount: number; clean: boolean;
  critical: number; high: number; blockOn: Severity;
}

export function firewall(
  baselineFiles: ReadonlyArray<SourceFile>,
  currentFiles: ReadonlyArray<SourceFile>,
  policy: FirewallPolicy = DEFAULT_POLICY,
  opts?: { ageResolver?: (rule: string) => AgeInfo | null; today?: string },
): FirewallVerdict {
  const pol = policy ?? DEFAULT_POLICY;
  const a = analyzeRegressions(baselineFiles, currentFiles);
  const findings: FirewallFinding[] = [];
  const seen = new Set<string>();
  const mk = (r: { rule: string; kind: string; status: "VIOLATED" | "UNKNOWN"; reason: string; counterexample?: string }, source: "mined" | "declared") => {
    const base = baseSeverityFor(pol, r.rule, r.kind);
    const age = opts?.ageResolver ? opts.ageResolver(r.rule) : null;
    const { final, rationale } = scoreSeverity({ base, status: r.status, ageDays: age?.ageDays ?? null, flickered: age?.flickered ?? false, ageWeight: pol.ageWeight, ageTiers: pol.ageTiers });
    const waiver = (pol.waivers ?? []).find((w) => norm(w.rule) === norm(r.rule));
    const waiverExpired = !!(waiver?.until && opts?.today && waiver.until < opts.today);
    const waived = !!waiver && !waiverExpired;
    const blocking = !waived && atLeast(final, pol.blockOn);
    findings.push({ rule: r.rule, kind: r.kind, status: r.status, reason: r.reason, counterexample: r.counterexample, source, baseSeverity: base, finalSeverity: final, rationale, ageDays: age?.ageDays ?? null, establishedAt: age?.establishedAt, heldThroughCommits: age?.heldThroughCommits, waived, waiverReason: waiver?.reason, waiverExpired, blocking });
    seen.add(norm(r.rule));
  };
  for (const r of a.regressed) mk({ rule: r.rule, kind: r.kind as string, status: "VIOLATED", reason: r.reason, counterexample: r.counterexample }, "mined");
  for (const r of a.weakened) mk({ rule: r.rule, kind: r.kind as string, status: "UNKNOWN", reason: r.reason, counterexample: r.counterexample }, "mined");

  // architect-DECLARED rules the current code does not satisfy (even if never mined as a contract).
  if (pol.declared?.length) {
    const parsed = parseInvariants(pol.declared.join("\n"));
    const res = checkInvariants(currentFiles, parsed);
    for (const c of res.results) {
      if (c.status === "HOLDS" || seen.has(norm(c.invariant.raw))) continue;
      mk({ rule: c.invariant.raw, kind: c.invariant.kind as string, status: c.status, reason: c.reason, counterexample: c.counterexample }, "declared");
    }
  }

  findings.sort((x, y) => ord(y.finalSeverity) - ord(x.finalSeverity) || (Number(y.blocking) - Number(x.blocking)) || x.rule.localeCompare(y.rule));
  const blockedBy = findings.filter((f) => f.blocking);
  const verdict: FirewallVerdict["verdict"] = blockedBy.length ? "BLOCK" : findings.some((f) => !f.waived) ? "WARN" : "PASS";
  return {
    verdict, policyName: pol.name, baselineContracts: a.baselineContracts, findings,
    blocked: blockedBy.length > 0, blockedBy, expiredWaivers: findings.filter((f) => f.waiverExpired), waivedCount: findings.filter((f) => f.waived).length,
    clean: a.clean && !a.weakened.length && findings.length === 0,
    critical: findings.filter((f) => f.finalSeverity === "critical").length, high: findings.filter((f) => f.finalSeverity === "high").length, blockOn: pol.blockOn,
  };
}

const ICON: Record<Severity, string> = { critical: "⛔", high: "🔴", medium: "🟠", low: "🟡", info: "⚪" };
const agePhrase = (d: number | null | undefined) => d == null ? "age unknown" : d >= 365 ? `held ${(d / 365).toFixed(1)} years` : `held ${d} days`;
/** Plain-text verdict, ready for a terminal or a PR comment. */
export function firewallReport(v: FirewallVerdict): string {
  const head = v.verdict === "BLOCK" ? "🛑 ARCHITECTURAL FIREWALL — BLOCKED" : v.verdict === "WARN" ? "🟠 ARCHITECTURAL FIREWALL — WARN" : "✅ ARCHITECTURAL FIREWALL — PASS";
  const o = [head, `policy "${v.policyName}" · ${v.baselineContracts} contracts checked · ${v.findings.length} finding(s) · ${v.blockedBy.length} blocking · ${v.waivedCount} waived (block threshold: ${v.blockOn})`, ""];
  if (v.clean) return [head, `policy "${v.policyName}" · ${v.baselineContracts} contracts checked`, "", "✅ no architectural regressions — every baseline contract still holds."].join("\n");
  for (const f of v.findings) {
    const tag = f.waived ? "  (WAIVED)" : f.waiverExpired ? "  (WAIVER EXPIRED — not honoured)" : f.blocking ? "  (BLOCKING)" : "";
    o.push(`${ICON[f.finalSeverity]} [${f.finalSeverity.toUpperCase()}] ${f.rule}${tag}`);
    o.push(`    ${f.reason}`);
    if (f.counterexample) o.push(`    ↳ ${f.counterexample}`);
    o.push(`    contract ${agePhrase(f.ageDays)}${f.heldThroughCommits ? `, through ${f.heldThroughCommits} commits` : ""}${f.establishedAt ? `, set at ${f.establishedAt}` : ""} · ${f.rationale}`);
    if (f.waived) o.push(`    waived: ${f.waiverReason}`);
  }
  if (v.expiredWaivers.length) o.push(`\n⚠ ${v.expiredWaivers.length} waiver(s) expired — review or renew.`);
  o.push("");
  o.push(v.blocked ? `❌ BLOCKED: ${v.blockedBy.length} finding(s) ≥ ${v.blockOn}. Merge refused (exit 2).` : v.verdict === "WARN" ? "🟠 WARN: regressions found but none reached the block threshold (exit 0)." : "✅ PASS (exit 0).");
  return o.join("\n");
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface ArchFirewallGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function archFirewallGauntlet(): ArchFirewallGauntlet {
  const baseline: SourceFile[] = [
    { path: "schema.prisma", content: "model Wallet { id Int @id }\nmodel Note { id Int @id }" },
    { path: "a.ts", content: "export function charge(){ return prisma.wallet.create({data:{}}); }\nexport function readNote(){ return prisma.note.findMany(); }" },
  ];
  const broke: SourceFile[] = [...baseline, { path: "refund.ts", content: "export function refundHandler(){ return prisma.wallet.update({where:{}}); }" }];
  const oldAge = (): AgeInfo => ({ ageDays: 875, establishedAt: "a1b2c3", heldThroughCommits: 312 });
  const youngAge = (): AgeInfo => ({ ageDays: 3 });

  // (a) old contract (base high +2 ≥730d ⇒ critical) → BLOCK, names refundHandler, heldThrough kept.
  const a = firewall(baseline, broke, DEFAULT_POLICY, { ageResolver: oldAge });
  const blocksOld = a.verdict === "BLOCK" && a.findings[0].finalSeverity === "critical" && /refundHandler/.test(a.findings[0].counterexample || "") && a.findings[0].heldThroughCommits === 312;

  // (b) young (base high +0 ⇒ high; blockOn critical) → WARN not BLOCK.
  const b = firewall(baseline, broke, DEFAULT_POLICY, { ageResolver: youngAge });
  const youngIsWarn = b.verdict === "WARN" && b.findings[0].finalSeverity === "high";

  // (c) waiver suppresses the block.
  const wpol = parsePolicy("waive table wallet single-writer :: dual-writer approved in RFC-42");
  const c = firewall(baseline, broke, wpol, { ageResolver: oldAge, today: "2026-06-11" });
  const waiverSuppresses = c.verdict !== "BLOCK" && c.findings[0].waived === true;

  // (d) EXPIRED waiver is NOT honoured → block stands + flagged.
  const epol = parsePolicy("waive until=2025-01-01 table wallet single-writer :: temporary");
  const d = firewall(baseline, broke, epol, { ageResolver: oldAge, today: "2026-06-11" });
  const expiredBlocks = d.verdict === "BLOCK" && d.findings[0].waiverExpired === true && d.expiredWaivers.length === 1;

  // (e) clean → PASS.
  const e = firewall(baseline, baseline, DEFAULT_POLICY, { ageResolver: oldAge });

  // (f) severity math + policy parse.
  const sc = scoreSeverity({ base: "high", status: "VIOLATED", ageDays: 800, flickered: false, ageWeight: true, ageTiers: DEFAULT_POLICY.ageTiers });
  const flickNo = scoreSeverity({ base: "medium", status: "VIOLATED", ageDays: 800, flickered: false, ageWeight: true, ageTiers: DEFAULT_POLICY.ageTiers }); // medium +2 ⇒ critical
  const flick = scoreSeverity({ base: "medium", status: "VIOLATED", ageDays: 800, flickered: true, ageWeight: true, ageTiers: DEFAULT_POLICY.ageTiers });   // flicker caps +2→+1 ⇒ high
  const unk = scoreSeverity({ base: "high", status: "UNKNOWN", ageDays: 3, flickered: false, ageWeight: true, ageTiers: DEFAULT_POLICY.ageTiers });
  const scoreOK = sc.final === "critical" && flickNo.final === "critical" && flick.final === "high" && unk.final === "medium";
  const pp = parsePolicy("# p\nname payments\nblockon high\ndefault single-writer critical\ncritical table x single-writer\nwaive until=2030-01-01 table y private :: ok");
  const parseOK = pp.name === "payments" && pp.blockOn === "high" && pp.defaults["single-writer"] === "critical" && pp.enforce.length === 1 && pp.waivers[0]?.until === "2030-01-01";

  const total = (() => { try { firewall(null as never, null as never); parsePolicy(null as never); loadPolicy("{bad json"); scoreSeverity({ base: "info", status: "VIOLATED", ageDays: null, ageWeight: true, ageTiers: [] }); firewallReport(firewall([], [])); return true; } catch { return false; } })();

  const checks = [
    { name: "BLOCK-OLD(+2⇒critical)", pass: blocksOld, detail: "base high + age≥730d (+2) ⇒ critical ⇒ BLOCK; counterexample names the 2nd writer; heldThrough kept" },
    { name: "YOUNG-IS-WARN", pass: youngIsWarn, detail: "base high + 3d (+0) ⇒ high; below critical block threshold ⇒ WARN, not BLOCK" },
    { name: "WAIVER-SUPPRESSES", pass: waiverSuppresses, detail: "an approved waiver suppresses the block" },
    { name: "EXPIRED-WAIVER-FAILS-LOUD", pass: expiredBlocks, detail: "an expired waiver is NOT honoured — block stands + surfaced" },
    { name: "CLEAN-PASSES", pass: e.verdict === "PASS" && e.clean, detail: "no regression → PASS" },
    { name: "SEVERITY-MATH+PARSE", pass: scoreOK && parseOK, detail: "age bump / flicker cap / UNKNOWN penalty correct; DSL parses name/blockon/default/enforce/waiver+until" },
    { name: "TOTAL", pass: total, detail: "null/garbage/bad-json never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
