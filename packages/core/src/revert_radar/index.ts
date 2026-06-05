/**
 * REVERT RADAR — the regret flywheel (Accountability Layer · Diamond 3 of 5).
 *
 * Everyone measures "did the test pass NOW". Nobody measures "did the work SURVIVE".
 * This is the tail: detect when a commit was later REVERTED or HOTFIXED, join it with
 * the signed attestation ledger (which agent made each commit), and compute a per-agent
 * SURVIVAL rate — so the mesh learns which agents leave work that lasts.
 *
 * Pure + total (the caller gathers git facts). Two signals, honestly graded:
 *   • explicit revert  — a `git revert` / "This reverts commit <sha>"  → confidence 1.0
 *   • hotfix window    — a later fix/revert commit touching the SAME files within N days
 *                        → confidence 0.5 (a SIGNAL, not proof; labelled as such)
 */

export interface CommitLite {
  sha: string;
  subject: string;
  /** full message body (for "This reverts commit <sha>" detection). */
  body?: string;
  /** the AI vendor that made it (from the attestation ledger), or "unknown". */
  agent: string;
  files: string[];
  ts: number;
}

export interface RevertSignal {
  sha: string;          // the commit that was undone
  agent: string;
  revertedBy: string;   // the sha that undid it
  kind: "explicit-revert" | "hotfix-window";
  confidence: number;   // 1.0 explicit · 0.5 hotfix-window
  ageDays: number;      // how long it survived before being undone
}

const DAY = 86_400_000;
// STRONG regression words only — NOT generic "fix"/"undo" (which match most commits
// and would drown the signal in noise). A hotfix-window match must look like a real
// regression repair, not routine maintenance.
const FIX_RX = /\b(?:revert|rollback|backout|regression|hotfix|emergency fix)\b/i;

/** Detect reverts/hotfixes across an ordered (oldest→newest) commit list. */
export function detectReverts(commits: CommitLite[], opts: { windowDays?: number; minOverlap?: number } = {}): RevertSignal[] {
  const windowMs = (opts.windowDays ?? 14) * DAY;
  const minOverlap = opts.minOverlap ?? 1;
  const list = [...(Array.isArray(commits) ? commits : [])].filter((c) => c && typeof c.sha === "string").map((c) => ({ ...c, files: Array.isArray(c.files) ? c.files : [], ts: Number(c.ts) || 0 })).sort((a, b) => a.ts - b.ts);
  const bySha = new Map(list.map((c) => [c.sha, c]));
  const out: RevertSignal[] = [];
  const seen = new Set<string>();
  const mark = (target: CommitLite, by: CommitLite, kind: RevertSignal["kind"], conf: number) => {
    const key = target.sha + "<" + by.sha;
    if (seen.has(key)) return; seen.add(key);
    out.push({ sha: target.sha, agent: target.agent, revertedBy: by.sha, kind, confidence: conf, ageDays: Math.max(0, Math.round((by.ts - target.ts) / DAY)) });
  };
  for (const c of list) {
    // 1) explicit: "This reverts commit <sha>" in the body, or subject "Revert \"...\""
    const m = String(c.body ?? "").match(/This reverts commit ([0-9a-f]{7,40})/i);
    if (m) { const t = [...bySha.values()].find((x) => x.sha.startsWith(m[1]) || m[1].startsWith(x.sha)); if (t && t.sha !== c.sha) { mark(t, c, "explicit-revert", 1.0); continue; } }
    if (/^Revert ["']/i.test(c.subject)) {
      const orig = c.subject.replace(/^Revert ["']/i, "").replace(/["']\s*$/, "");
      const t = list.find((x) => x.ts < c.ts && x.subject === orig);
      if (t) { mark(t, c, "explicit-revert", 1.0); continue; }
    }
    // 2) hotfix window: a regression-repair commit undoes AT MOST ONE prior commit —
    // the nearest prior in-window commit with the MOST file overlap. (Linking to every
    // file-overlapping ancestor would N²-explode into noise — that's self-deception.)
    if (!FIX_RX.test(c.subject) && !FIX_RX.test(String(c.body ?? ""))) continue;
    let best: CommitLite | null = null, bestOverlap = 0;
    for (const t of list) {
      if (t.sha === c.sha || t.ts >= c.ts || (c.ts - t.ts) > windowMs) continue;
      const overlap = t.files.filter((f) => c.files.includes(f)).length;
      // prefer more overlap; tiebreak the NEAREST (most recent) prior commit
      if (overlap >= minOverlap && (overlap > bestOverlap || (overlap === bestOverlap && best && t.ts > best.ts))) { best = t; bestOverlap = overlap; }
    }
    if (best && bestOverlap > 0) mark(best, c, "hotfix-window", 0.5);
  }
  return out;
}

export interface AgentSurvival {
  agent: string;
  commits: number;
  regretted: number;       // distinct commits undone (weighted-meaningful)
  survivalRate: number;    // 1 - regrettedWeight/commits, clamped [0,1]
  explicit: number;
  hotfix: number;
}

/** Per-agent survival from the commit list + detected reverts. */
export function survivalByAgent(commits: CommitLite[], reverts: RevertSignal[]): AgentSurvival[] {
  const total = new Map<string, number>();
  for (const c of commits) total.set(c.agent, (total.get(c.agent) ?? 0) + 1);
  // weight a commit's regret by its strongest signal (explicit beats hotfix)
  const worst = new Map<string, RevertSignal>();
  for (const r of reverts) { const cur = worst.get(r.sha); if (!cur || r.confidence > cur.confidence) worst.set(r.sha, r); }
  const reg = new Map<string, { w: number; ex: number; hf: number }>();
  for (const r of worst.values()) { const cur = reg.get(r.agent) ?? { w: 0, ex: 0, hf: 0 }; cur.w += r.confidence; if (r.kind === "explicit-revert") cur.ex++; else cur.hf++; reg.set(r.agent, cur); }
  const out: AgentSurvival[] = [];
  for (const [agent, n] of total) {
    const g = reg.get(agent) ?? { w: 0, ex: 0, hf: 0 };
    out.push({ agent, commits: n, regretted: g.ex + g.hf, survivalRate: Math.max(0, Math.min(1, 1 - g.w / Math.max(1, n))), explicit: g.ex, hotfix: g.hf });
  }
  out.sort((a, b) => b.survivalRate - a.survivalRate || b.commits - a.commits || a.agent.localeCompare(b.agent));
  return out;
}

// ─── gauntlet ─────────────────────────────────────────────────────────────────
export interface RevertGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }

export function revertGauntlet(): RevertGauntlet {
  const t0 = 1_700_000_000_000;
  const commits: CommitLite[] = [
    { sha: "aaa1111", subject: "feat: add login", agent: "claude-code", files: ["auth.ts"], ts: t0 },
    { sha: "bbb2222", subject: "feat: add cache", agent: "cursor", files: ["cache.ts"], ts: t0 + DAY },
    { sha: "ccc3333", subject: 'Revert "feat: add login"', agent: "human", files: ["auth.ts"], ts: t0 + 2 * DAY },          // explicit revert of aaa
    { sha: "ddd4444", subject: "fix: hotfix cache regression", agent: "human", files: ["cache.ts"], ts: t0 + 3 * DAY },     // hotfix window for bbb
    { sha: "eee5555", subject: "feat: solid feature", agent: "claude-code", files: ["solid.ts"], ts: t0 + 4 * DAY, body: "" },
    { sha: "fff6666", subject: "chore: unrelated", agent: "human", files: ["z.ts"], ts: t0 + 40 * DAY },                    // too late / unrelated
  ];
  const reverts = detectReverts(commits, { windowDays: 14, minOverlap: 1 });
  const explicit = reverts.find((r) => r.sha === "aaa1111");
  const hotfix = reverts.find((r) => r.sha === "bbb2222");
  const surv = survivalByAgent(commits, reverts);
  const claude = surv.find((s) => s.agent === "claude-code");
  const det = JSON.stringify(detectReverts(commits)) === JSON.stringify(detectReverts(commits));
  // a clean commit (eee) is NOT flagged; the too-late one (fff) is not a hotfix target
  const noFalse = !reverts.some((r) => r.sha === "eee5555" || r.sha === "solid.ts");
  const checks = [
    { name: "EXPLICIT-REVERT", pass: explicit?.kind === "explicit-revert" && explicit?.confidence === 1.0, detail: "a `git revert` is detected at confidence 1.0" },
    { name: "HOTFIX-WINDOW", pass: hotfix?.kind === "hotfix-window" && hotfix?.confidence === 0.5, detail: "a same-file hotfix within the window is a 0.5 signal (not proof)" },
    { name: "SURVIVAL-PER-AGENT", pass: !!claude && claude.commits === 2 && claude.regretted === 1 && claude.survivalRate < 1, detail: "per-agent survival reflects which work lasted" },
    { name: "NO-FALSE-POSITIVE", pass: noFalse, detail: "a clean, un-reverted commit is never flagged" },
    { name: "DETERMINISTIC", pass: det, detail: "same git history → byte-identical signals" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
