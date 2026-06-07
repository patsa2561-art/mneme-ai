/**
 * LIVE PROOF LOOP — a measurable, per-agent record of what Mneme actually DID for each action, so its
 * value is visible LIVE (not a slogan). Every time an organ helps — caught a hallucination, blocked a
 * leak, surfaced a contradicting memory, neutralized an injection, saved tokens, confirmed a fact,
 * or flagged an UNKNOWN instead of letting the agent guess — that "assist" is recorded against the
 * AGENT that benefited. A scorecard then answers, for a CEO / owner / dev / user: "today, across the
 * AI agents I run, Mneme caught N hallucinations, blocked M leaks, saved X tokens" — measured, not claimed.
 *
 * ★HONEST (DIAKRISIS): this MEASURES + PROVES the value of assists Mneme genuinely provided through
 * its own tools — it does NOT generate the agent's answer, and it counts only real events (each assist
 * is logged by the organ that produced it). The "win" is not "always right"; it is that every assist
 * is a real, counted, attributable fact — and the prove-or-unknown discipline means a flagged UNKNOWN
 * is itself a logged win (the agent did not assert a falsehood).
 */

export type AssistKind =
  | "hallucination_caught"   // a claim was REFUTED before it reached the user
  | "leak_blocked"           // a secret/PII was stopped on egress
  | "injection_neutralized"  // untrusted content's prompt-insertion was defused
  | "contradiction_surfaced" // a memory conflict was raised before re-deriving
  | "token_saved"            // context routed through outline/distill (count = tokens)
  | "command_gated"          // a destructive command was held for approval
  | "confirmed"              // a checkable claim was verified TRUE
  | "unknown_flagged";       // prove-or-unknown: abstained instead of guessing

export const ASSIST_KINDS: readonly AssistKind[] = ["hallucination_caught", "leak_blocked", "injection_neutralized", "contradiction_surfaced", "token_saved", "command_gated", "confirmed", "unknown_flagged"];
/** Assists that prevented a concrete harm (used for the headline "harms prevented" figure). */
const HARM_PREVENTED: ReadonlySet<AssistKind> = new Set(["hallucination_caught", "leak_blocked", "injection_neutralized", "command_gated"]);

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";

export interface Assist { agent: string; kind: AssistKind; count: number; detail?: string; at: number }
export interface ChainedAssist extends Assist { prevHash: string; chainHash: string }
const GENESIS = "mneme-proof-genesis";
function entryHash(prevHash: string, a: Assist): string {
  return createHash("sha256").update(`${prevHash}|${a.agent}|${a.kind}|${a.count}|${a.at}|${a.detail ?? ""}`).digest("hex");
}
/** Chain one assist onto the previous hash (tamper-evident — editing any past row breaks the chain). */
export function chainEntry(prevHash: string, a: Partial<Assist>): ChainedAssist {
  const norm = normalizeAssist(a); const prev = prevHash || GENESIS;
  return { ...norm, prevHash: prev, chainHash: entryHash(prev, norm) };
}
export interface ProofChainVerdict { ok: boolean; length: number; firstBrokenIndex: number | null }
/** Verify the proof ledger is an intact hash chain (no row edited/inserted/removed). */
export function verifyProofChain(records: ReadonlyArray<ChainedAssist>): ProofChainVerdict {
  let prev = GENESIS;
  for (let i = 0; i < (records?.length ?? 0); i++) {
    const r = records[i]; if (!r || r.prevHash !== prev || r.chainHash !== entryHash(prev, r)) return { ok: false, length: records.length, firstBrokenIndex: i };
    prev = r.chainHash;
  }
  return { ok: true, length: records?.length ?? 0, firstBrokenIndex: null };
}
/** Append an assist to a chained, bounded jsonl ledger (read last hash → chain → append; cap rotates). */
export function appendAssistChained(path: string, a: Partial<Assist>, opts?: { cap?: number }): ChainedAssist {
  const cap = Number(opts?.cap) || 50000;
  let lines: string[] = [];
  try { if (existsSync(path)) lines = readFileSync(path, "utf8").split("\n").filter(Boolean); } catch { /* */ }
  let prev = GENESIS; if (lines.length) { try { prev = (JSON.parse(lines[lines.length - 1]) as ChainedAssist).chainHash || GENESIS; } catch { /* */ } }
  const entry = chainEntry(prev, a);
  lines.push(JSON.stringify(entry));
  if (lines.length > cap) {
    // bounded: keep the recent half, then RE-ROOT the window from GENESIS so it stays a valid chain
    const kept = lines.slice(-Math.floor(cap / 2)).map((l) => { try { return JSON.parse(l) as Assist; } catch { return null; } }).filter(Boolean) as Assist[];
    let p = GENESIS; lines = kept.map((k) => { const e = chainEntry(p, k); p = e.chainHash; return JSON.stringify(e); });
  }
  try { mkdirSync(dirname(path), { recursive: true }); const tmp = path + "." + process.pid + ".tmp"; writeFileSync(tmp, lines.join("\n") + "\n", "utf8"); renameSync(tmp, path); } catch { try { writeFileSync(path, lines.join("\n") + "\n", "utf8"); } catch { /* */ } }
  return entry;
}

/** Coerce arbitrary input into a valid Assist (total — never throws). */
export function normalizeAssist(a: Partial<Assist>): Assist {
  const kind = (ASSIST_KINDS as readonly string[]).includes(a?.kind as string) ? (a!.kind as AssistKind) : "confirmed";
  return { agent: String(a?.agent ?? "unknown").slice(0, 80) || "unknown", kind, count: Math.max(0, Math.floor(Number(a?.count) || 1)), detail: a?.detail ? String(a.detail).slice(0, 200) : undefined, at: Number(a?.at) || 0 };
}
export function recordAssist(ledger: ReadonlyArray<Assist>, a: Partial<Assist>): Assist[] { return [...(ledger ?? []), normalizeAssist(a)]; }

export interface AgentScore { agent: string; total: number; harmsPrevented: number; tokensSaved: number; byKind: Record<string, number> }
export interface Scorecard {
  windowMs: number | null; total: number; harmsPrevented: number; tokensSaved: number;
  byKind: Record<string, number>; agents: AgentScore[]; topAgent: string | null;
}
/** Aggregate the ledger into a measured scorecard, optionally per-agent + within a time window. */
export function scorecard(ledger: ReadonlyArray<Assist>, opts?: { agent?: string; sinceMs?: number; now?: number }): Scorecard {
  const now = Number(opts?.now) || 0; const since = opts?.sinceMs != null ? now - Number(opts.sinceMs) : null;
  const rows = (ledger ?? []).map(normalizeAssist).filter((a) => (!opts?.agent || a.agent === opts.agent) && (since == null || a.at >= since));
  const byKind: Record<string, number> = {}; const perAgent = new Map<string, AgentScore>();
  let total = 0, harms = 0, tokens = 0;
  for (const a of rows) {
    byKind[a.kind] = (byKind[a.kind] ?? 0) + a.count;
    if (a.kind === "token_saved") tokens += a.count; else { total += a.count; if (HARM_PREVENTED.has(a.kind)) harms += a.count; }
    const g = perAgent.get(a.agent) ?? { agent: a.agent, total: 0, harmsPrevented: 0, tokensSaved: 0, byKind: {} };
    g.byKind[a.kind] = (g.byKind[a.kind] ?? 0) + a.count;
    if (a.kind === "token_saved") g.tokensSaved += a.count; else { g.total += a.count; if (HARM_PREVENTED.has(a.kind)) g.harmsPrevented += a.count; }
    perAgent.set(a.agent, g);
  }
  const agents = [...perAgent.values()].sort((x, y) => (y.harmsPrevented - x.harmsPrevented) || (y.total - x.total));
  return { windowMs: opts?.sinceMs ?? null, total, harmsPrevented: harms, tokensSaved: tokens, byKind, agents, topAgent: agents[0]?.agent ?? null };
}

/** Map an MCP tool call (name + its result) → the assist it represents, or null. Heuristic +
 *  conservative: only returns an assist when the result clearly shows one (a REFUTED verdict, a
 *  redaction, an injection finding, a quarantine, a gated command, measured tokens saved). Wired at
 *  the single MCP dispatch point so EVERY tool call is measured live, with zero per-organ plumbing. */
export function assistFromResult(toolName: string, result: unknown): { kind: AssistKind; count: number } | null {
  const t = String(toolName || "").toLowerCase();
  let blob = ""; try { blob = JSON.stringify(result ?? {}).toLowerCase(); } catch { blob = ""; }
  if (/truth\.check|savant\.verify|gephyra\.cross|retirement\.detect|truth\.gate/.test(t)) {
    if (/refuted|"false"|impossible|necrotic|apoptotic/.test(blob)) return { kind: "hallucination_caught", count: 1 };
    if (/unknown|unverified|inconclusive/.test(blob)) return { kind: "unknown_flagged", count: 1 };
    if (/trustworthy|"true"|confirmed|healthy/.test(blob)) return { kind: "confirmed", count: 1 };
  }
  if (/egress|rail\.traverse|blind/.test(t) && /redact|leak|blocked|"block"/.test(blob)) return { kind: "leak_blocked", count: 1 };
  if (/firewall/.test(t) && /neutraliz|injection|"flagged"|"blocked"/.test(blob)) return { kind: "injection_neutralized", count: 1 };
  if (/cortex\.contribute/.test(t) && /quarantin/.test(blob)) return { kind: "contradiction_surfaced", count: 1 };
  if (/heph\.cross|heph\.preflight|swarm/.test(t) && /needs_cosign|needs-cosign|"block"/.test(blob)) return { kind: "command_gated", count: 1 };
  const m = blob.match(/"tokenssaved":(\d+)|"tokens_saved":(\d+)|"estsaved(?:tokens)?":(\d+)|"reductiontokens":(\d+)/);
  if (m) { const n = Number(m[1] || m[2] || m[3] || m[4]); if (n > 0) return { kind: "token_saved", count: n }; }
  return null;
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface ProofLoopGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function proofLoopGauntlet(): ProofLoopGauntlet {
  let L: Assist[] = [];
  L = recordAssist(L, { agent: "claude-code", kind: "hallucination_caught", at: 1000 });
  L = recordAssist(L, { agent: "claude-code", kind: "leak_blocked", at: 1100 });
  L = recordAssist(L, { agent: "claude-code", kind: "token_saved", count: 5000, at: 1200 });
  L = recordAssist(L, { agent: "cursor", kind: "injection_neutralized", at: 1300 });
  L = recordAssist(L, { agent: "cursor", kind: "unknown_flagged", at: 1400 });
  const sc = scorecard(L, { now: 2000 });
  const totalsOK = sc.harmsPrevented === 3 && sc.tokensSaved === 5000 && sc.byKind["hallucination_caught"] === 1 && sc.total === 4;   // 4 non-token assists
  const perAgentOK = sc.agents.length === 2 && sc.topAgent === "claude-code" && (sc.agents.find((a) => a.agent === "claude-code")?.harmsPrevented === 2);
  const filterAgentOK = scorecard(L, { agent: "cursor", now: 2000 }).harmsPrevented === 1;
  const windowOK = scorecard(L, { sinceMs: 100, now: 1450 }).total === 1;   // only the 1400 unknown_flagged is within [1350,1450]
  const tokenNotHarm = !HARM_PREVENTED.has("token_saved") && !HARM_PREVENTED.has("unknown_flagged");   // honest: a saved token / an abstention isn't a "harm prevented"
  const normalizeOK = normalizeAssist({ kind: "bogus" as never, count: -5 }).kind === "confirmed" && normalizeAssist({}).count === 1;
  // assistFromResult mapping (the live MCP wiring)
  const mapOK = assistFromResult("mneme.truth.check", { data: { verdict: "REFUTED" } })?.kind === "hallucination_caught"
    && assistFromResult("mneme.savant.verify", { data: { verdict: "UNKNOWN" } })?.kind === "unknown_flagged"
    && assistFromResult("mneme.egress.guard", { data: { verdict: "BLOCK", redacted: true } })?.kind === "leak_blocked"
    && assistFromResult("mneme.firewall.fortify", { data: { findings: ["injection"] } })?.kind === "injection_neutralized"
    && assistFromResult("mneme.heph.cross", { data: { decision: "NEEDS_COSIGN" } })?.kind === "command_gated"
    && assistFromResult("mneme.outline.file", { data: { tokensSaved: 4000 } })?.kind === "token_saved"
    && assistFromResult("mneme.cortex.recall", { data: { facts: [] } }) === null;   // a neutral read → no assist
  // chain: build a 3-entry chain, verify intact, tamper a row → detected
  let p = GENESIS; const chain: ChainedAssist[] = [];
  for (const k of [{ agent: "a", kind: "confirmed" as AssistKind }, { agent: "a", kind: "leak_blocked" as AssistKind }, { agent: "b", kind: "command_gated" as AssistKind }]) { const e = chainEntry(p, k); chain.push(e); p = e.chainHash; }
  const chainOK = verifyProofChain(chain).ok;
  const tampered = chain.map((c, i) => (i === 1 ? { ...c, count: 999 } : c));   // edit a past row
  const tamperCaught = verifyProofChain(tampered).ok === false && verifyProofChain(tampered).firstBrokenIndex === 1;
  const total = (() => { try { scorecard(null as never); recordAssist(null as never, null as never); normalizeAssist(null as never); verifyProofChain(null as never); chainEntry("", null as never); return true; } catch { return false; } })();

  const checks = [
    { name: "TOTALS-MEASURED", pass: totalsOK, detail: "harmsPrevented + tokensSaved + per-kind counts are exact" },
    { name: "PER-AGENT", pass: perAgentOK, detail: "each agent gets its own score; topAgent = most harms prevented" },
    { name: "FILTER-BY-AGENT", pass: filterAgentOK, detail: "scorecard can be scoped to one agent" },
    { name: "TIME-WINDOW", pass: windowOK, detail: "a sinceMs window counts only assists inside it (today / this hour)" },
    { name: "HONEST-CATEGORIES", pass: tokenNotHarm, detail: "token-saved + unknown-flagged are NOT counted as harms-prevented (no inflation)" },
    { name: "NORMALIZE-TOTAL", pass: normalizeOK, detail: "garbage kind → safe default; missing count → 1" },
    { name: "MAP-TOOL-RESULT", pass: mapOK, detail: "assistFromResult maps each organ's result → the right assist (REFUTED→caught, UNKNOWN→flagged, BLOCK→leak, injection, gated, tokens) + a neutral read → null" },
    { name: "CHAIN-INTACT", pass: chainOK, detail: "the proof ledger is a hash chain — verifyProofChain confirms an unedited ledger" },
    { name: "CHAIN-TAMPER-CAUGHT", pass: tamperCaught, detail: "editing any past assist breaks the chain (signed CEO-grade scorecard, not an editable text file)" },
    { name: "TOTAL", pass: total, detail: "null/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
