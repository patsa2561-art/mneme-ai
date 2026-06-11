/**
 * AGENT REPUTATION FROM CHANGE OUTCOMES — the ACCOUNT layer: who ships code that LASTS?
 *
 * In an agent-native world, apps are cheap but TRUST is not — and there is no track-record for the
 * agents (or people) shipping code. This computes one, from the only ground truth that can't be gamed:
 * did a change SURVIVE, or was it REVERTED? An author who ships changes that stick earns reputation; one
 * whose changes keep getting reverted loses it.
 *
 * The honest, deterministic part — and the thing that solves the proto's "who is the oracle?" problem —
 * is that outcomes are DERIVED FROM GIT, not entered by hand: `git revert` writes a standard
 * "This reverts commit <sha>" trailer, so a reverted change is a fact in the history; a change old enough
 * and not reverted is "survived"; a change too recent to judge is "pending" (excluded from the score).
 * Reputation is the Wilson 95% LOWER bound on survival rate — a small or unproven author scores LOW by
 * construction, so the score can't be inflated by a handful of lucky commits.
 *
 * This module owns the pure parts: derive outcomes from commit metadata, and score reputation. The
 * CLI/MCP gather git history and attribute by author; the result is signed by the caller's notary.
 *
 * Distinct from `creditscore` (which scores HONESTY — does the agent tell the truth?). This scores
 * DURABILITY — does the agent's code last? Both are needed; neither implies the other.
 *
 * ★HONEST (DIAKRISIS): "author" from git is a proxy (it may be a human or an AI agent or a squashed
 * mix); "survived" means only NOT-YET-REVERTED past a maturity window, not "proven good"; revert
 * detection is the deterministic `This reverts commit` trailer (reliable) plus an explicit Revert-message
 * fallback. It is a track-record signal, not a verdict on any single change.
 */
export type Outcome = "survived" | "reverted" | "incident" | "pending";
export interface ChangeRecord { agent: string; outcome: Outcome; sha?: string }
export interface OutcomeCommit { sha: string; author: string; message: string; ageDays: number }
export interface AgentRep { agent: string; actions: number; survived: number; reverted: number; incident: number; decided: number; survivalRateLB: number; score: number; band: "TRUSTED" | "SOLID" | "WATCH" | "RISKY" | "UNPROVEN" }

const RE_REVERTS = /This reverts commit ([0-9a-f]{7,40})/gi;

/** Derive each commit's outcome from git facts: reverted (a later commit reverts it) / survived (aged, not reverted) / pending (too recent). Pure. */
export function deriveOutcomes(commits: ReadonlyArray<OutcomeCommit>, opts?: { matureDays?: number }): ChangeRecord[] {
  const cs = (commits ?? []).filter((c) => c && c.sha);
  const matureDays = opts?.matureDays ?? 30;
  const revertedShas = new Set<string>();
  for (const c of cs) { let m: RegExpExecArray | null; RE_REVERTS.lastIndex = 0; while ((m = RE_REVERTS.exec(c.message || "")) !== null) revertedShas.add(m[1].toLowerCase()); }
  const isReverted = (sha: string) => { const lc = sha.toLowerCase(); for (const r of revertedShas) if (lc.startsWith(r) || r.startsWith(lc)) return true; return false; };
  const out: ChangeRecord[] = [];
  for (const c of cs) {
    if (/^revert\b/i.test(c.message || "")) continue;                 // the revert commit itself isn't a tracked change
    const outcome: Outcome = isReverted(c.sha) ? "reverted" : (c.ageDays >= matureDays ? "survived" : "pending");
    out.push({ agent: c.author || "unknown", outcome, sha: c.sha.slice(0, 10) });
  }
  return out;
}

function wilsonLB(succ: number, n: number): number {
  if (n <= 0) return 0;
  const z = 1.96, p = succ / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return Math.max(0, (centre - margin) / denom);
}

/** Reputation per agent from change outcomes. Wilson-LB on survival; incidents weigh heaviest; pending excluded. */
export function scoreReputation(records: ReadonlyArray<ChangeRecord>): AgentRep[] {
  const by = new Map<string, AgentRep>();
  for (const r of records ?? []) {
    if (!r || !r.agent) continue;
    const a = by.get(r.agent) ?? { agent: r.agent, actions: 0, survived: 0, reverted: 0, incident: 0, decided: 0, survivalRateLB: 0, score: 0, band: "UNPROVEN" as const };
    a.actions++;
    if (r.outcome === "survived") a.survived++;
    else if (r.outcome === "reverted") a.reverted++;
    else if (r.outcome === "incident") a.incident++;
    by.set(r.agent, a);
  }
  const out = [...by.values()];
  for (const a of out) {
    a.decided = a.survived + a.reverted + a.incident;
    // incidents count as failures and are penalised an extra notch via an effective-failure weight
    const effFail = a.reverted + a.incident * 2;
    const effDecided = a.survived + effFail;
    a.survivalRateLB = effDecided > 0 ? wilsonLB(a.survived, effDecided) : 0;
    a.score = Math.round(a.survivalRateLB * 1000) / 10;
    a.band = a.decided < 5 ? "UNPROVEN" : a.score >= 80 ? "TRUSTED" : a.score >= 60 ? "SOLID" : a.score >= 35 ? "WATCH" : "RISKY";
  }
  return out.sort((x, y) => y.score - x.score || y.decided - x.decided || x.agent.localeCompare(y.agent));
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface AgentLedgerGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function agentLedgerGauntlet(): AgentLedgerGauntlet {
  // derive: a commit reverted by a "This reverts commit" trailer; an aged commit survives; a recent one pends.
  const commits: OutcomeCommit[] = [
    { sha: "aaaaaaa1", author: "alice", message: "feat: x", ageDays: 200 },
    { sha: "bbbbbbb2", author: "bob", message: "feat: risky", ageDays: 200 },
    { sha: "ccccccc3", author: "carol", message: "Revert \"feat: risky\"\n\nThis reverts commit bbbbbbb2.", ageDays: 199 },
    { sha: "ddddddd4", author: "alice", message: "feat: y", ageDays: 2 },   // too recent → pending
  ];
  const recs = deriveOutcomes(commits, { matureDays: 30 });
  const bobReverted = recs.some((r) => r.agent === "bob" && r.outcome === "reverted");
  const aliceSurvived = recs.some((r) => r.agent === "alice" && r.outcome === "survived");
  const recentPending = recs.some((r) => r.agent === "alice" && r.outcome === "pending");
  const revertCommitSkipped = !recs.some((r) => r.agent === "carol");      // the revert commit itself isn't a tracked change
  // score: many survived → high+TRUSTED; many reverted → low+RISKY; few → UNPROVEN
  const rep = scoreReputation([
    ...Array.from({ length: 25 }, () => ({ agent: "good", outcome: "survived" as const })),
    ...Array.from({ length: 8 }, () => ({ agent: "bad", outcome: "reverted" as const })), { agent: "bad", outcome: "survived" as const },
    { agent: "newbie", outcome: "survived" as const },
  ]);
  const good = rep.find((r) => r.agent === "good"); const bad = rep.find((r) => r.agent === "bad"); const newbie = rep.find((r) => r.agent === "newbie");
  const scoreOK = !!good && good.band === "TRUSTED" && good.score > 60 && !!bad && bad.band === "RISKY" && bad.score < 40 && good.score > bad.score;
  const unproven = !!newbie && newbie.band === "UNPROVEN";   // <5 decided → can't be inflated
  const total = (() => { try { deriveOutcomes(null as never); scoreReputation(null as never); scoreReputation([{ agent: "", outcome: "survived" }]); return true; } catch { return false; } })();
  const checks = [
    { name: "DERIVE-REVERT", pass: bobReverted, detail: "a commit named by a 'This reverts commit <sha>' trailer is marked reverted" },
    { name: "DERIVE-SURVIVED+PENDING", pass: aliceSurvived && recentPending && revertCommitSkipped, detail: "aged & unreverted → survived; too-recent → pending; the revert commit itself isn't tracked" },
    { name: "WILSON-RANKS", pass: scoreOK, detail: "an author of surviving changes is TRUSTED and outranks one whose changes keep getting reverted (RISKY)" },
    { name: "UNPROVEN-FLOOR", pass: unproven, detail: "<5 decided outcomes → UNPROVEN (a lucky few can't inflate the score)" },
    { name: "TOTAL", pass: total, detail: "null/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
