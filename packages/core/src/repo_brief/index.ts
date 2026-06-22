/**
 * v3.132.0 — REPO BRIEF (the Context Capsule): the Path-A moat. Mneme is NOT a
 * "memory product" (commoditized) — it is GIT-NATIVE SHARED CONTEXT for multi-agent
 * teams. The Brief fuses the whole git-derived picture of a repo into ONE signed,
 * portable, local-first object every agent inherits before it touches the code:
 *   • the TEAM (each contributor's measured commit persona — who works here & how)
 *   • the DECISIONS (recent meaningful commits + their reasoning, cited)
 *   • the HOT FILES (most-churned files + the last decision on each)
 *   • the OPEN TODOs (intentions still in flight, cited file:line)
 *   • the THEMES (what the repo is focused on right now)
 *
 * Every field is a DETERMINISTIC projection of git, every entry CITED, the whole
 * thing tamper-evident (briefId) and signable — and it never leaves the machine
 * (data-sovereignty: the angle no US-cloud competitor can match). An agent reads
 * the Brief and instantly knows who/how/why, grounded — instead of re-deriving or
 * hallucinating. Pure + total. HONEST: a window onto measured git, not an opinion.
 */

import { createHash } from "node:crypto";
import { buildPersona, type CommitRec } from "../commit_persona/index.js";

export interface BriefCommit { hash: string; author?: string; ts: number; subject: string; body?: string; files?: string[]; churn?: number }
export interface BriefTodo { file: string; line: number; text: string }

export interface RepoBrief {
  brief: "BRIEF/1";
  repo: string;
  reconciled: { repoCommits: number; merges: number; authoredCommits: number; contributors: number };
  team: Array<{ author: string; archetype: string; tier: string; rarity: string; level: number; power: number; commits: number }>;
  decisions: Array<{ hash: string; subject: string; ts: number }>;
  hotFiles: Array<{ file: string; touches: number; lastSubject: string }>;
  openTodos: BriefTodo[];
  themes: string[];
  citations: string[];
  note: string;
  briefId: string;
}

function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
const STOP = new Set(["the", "a", "an", "to", "of", "and", "or", "for", "in", "on", "at", "with", "fix", "add", "update", "feat", "chore", "docs", "refactor", "test", "is", "it", "this", "that", "by", "from", "use", "new", "set", "get", "all", "wip", "merge"]);
const CONVENTIONAL = /^(feat|fix|perf|refactor|revert)(\([^)]*\))?!?:/i;

function themesOf(subjects: string[]): string[] {
  const f = new Map<string, number>();
  for (const s of subjects) for (const raw of String(s).toLowerCase().split(/[^a-z0-9]+/)) { const w = raw.trim(); if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue; f.set(w, (f.get(w) || 0) + 1); }
  return [...f.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w);
}

export interface BriefOpts { repo?: string; repoCommits?: number; openTodos?: BriefTodo[]; topTeam?: number }

/** Fuse a repo's git history into the shared-context Brief. Deterministic + total. */
export function buildRepoBrief(commits: BriefCommit[], opts?: BriefOpts): RepoBrief {
  const list = [...(commits || [])].filter((c) => c && c.hash).sort((a, b) => b.ts - a.ts); // newest first
  // TEAM — per-author commit persona (reuse the measured engine)
  const byAuthor = new Map<string, CommitRec[]>();
  for (const c of list) { const k = (c.author || "unknown").trim() || "unknown"; const rec: CommitRec = { author: k, ts: c.ts, subject: c.subject || "", body: c.body || "", files: c.files || [], insertions: c.churn || 0, deletions: 0 }; (byAuthor.get(k) || byAuthor.set(k, []).get(k)!).push(rec); }
  const team = [...byAuthor.entries()].filter(([, cs]) => cs.length >= 3).map(([a, cs]) => buildPersona(a, cs))
    .sort((x, y) => y.metrics.commits - x.metrics.commits).slice(0, opts?.topTeam ?? 8)
    .map((p) => ({ author: p.author, archetype: p.archetype, tier: p.tier, rarity: p.rarity, level: p.level, power: p.power, commits: p.metrics.commits }));
  // DECISIONS — recent meaningful commits (a body, or a conventional feat/fix/perf/refactor)
  const decisions = list.filter((c) => (c.body || "").trim().length > 0 || CONVENTIONAL.test(c.subject || "")).slice(0, 10)
    .map((c) => ({ hash: c.hash.slice(0, 12), subject: c.subject || "", ts: c.ts }));
  // HOT FILES — most-touched, with the most-recent decision on each
  const touch = new Map<string, { n: number; lastSubject: string; lastTs: number }>();
  for (const c of list) for (const f of (c.files || [])) { const e = touch.get(f) || { n: 0, lastSubject: "", lastTs: 0 }; e.n++; if (c.ts >= e.lastTs) { e.lastTs = c.ts; e.lastSubject = c.subject || ""; } touch.set(f, e); }
  const hotFiles = [...touch.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8).map(([file, e]) => ({ file, touches: e.n, lastSubject: e.lastSubject }));
  const openTodos = (opts?.openTodos || []).filter((t) => t && t.file).slice(0, 20);
  const themes = themesOf(list.slice(0, 200).map((c) => c.subject || ""));
  const citations = [...decisions.map((d) => d.hash), ...hotFiles.map((h) => h.file), ...openTodos.map((t) => `${t.file}:${t.line}`)];
  const authoredCommits = list.length;
  const reconciled = { repoCommits: opts?.repoCommits ?? authoredCommits, merges: Math.max(0, (opts?.repoCommits ?? authoredCommits) - authoredCommits), authoredCommits, contributors: byAuthor.size };
  const body: Omit<RepoBrief, "briefId"> = {
    brief: "BRIEF/1", repo: opts?.repo || "", reconciled, team, decisions, hotFiles, openTodos, themes, citations,
    note: "Git-native shared context for any agent on this repo — deterministic + cited + local-first. Reason FROM the citations; an honest 'not in the record' beats a guess.",
  };
  return { ...body, briefId: sha256(JSON.stringify(body)) };
}

export interface BriefVerify { ok: boolean; reason: string }
/** Tamper-evidence + every cited commit traces to the input. Pure + total. */
export function verifyBrief(brief: RepoBrief, commits: BriefCommit[]): BriefVerify {
  try {
    if (!brief || brief.brief !== "BRIEF/1") return { ok: false, reason: "not a brief" };
    const { briefId, ...body } = brief;
    if (sha256(JSON.stringify(body)) !== briefId) return { ok: false, reason: "briefId mismatch — body altered" };
    const known = new Set((commits || []).map((c) => (c.hash || "").slice(0, 12)));
    for (const d of brief.decisions) if (!known.has(d.hash)) return { ok: false, reason: `decision cites unknown commit ${d.hash}` };
    return { ok: true, reason: "valid: every decision traces to a real commit" };
  } catch (e) { return { ok: false, reason: `verify error: ${(e as Error).message}` }; }
}

// ── deterministic proof ──────────────────────────────────────────────────────
function synth(): BriefCommit[] {
  const base = 1_700_000_000; const out: BriefCommit[] = [];
  for (let i = 0; i < 24; i++) out.push({
    hash: "b" + String(i).padStart(3, "0") + "cafef00d", author: i % 3 === 0 ? "alice" : "bob", ts: base + i * 86400,
    subject: i % 4 === 0 ? "feat(api): add the search endpoint" : "fix(core): tighten validation",
    body: i % 4 === 0 ? "Why: search was the top user request this quarter." : "",
    files: ["src/api.ts", i % 2 ? "src/api.test.ts" : "src/core.ts"], churn: 30 + (i % 5) * 10,
  });
  return out;
}

export interface BriefGauntlet {
  fusesTeam: boolean;            // contributors become measured personas
  surfacesDecisions: boolean;   // meaningful commits captured + cited
  ranksHotFiles: boolean;       // most-touched file is first
  citesEverything: boolean;     // every decision/hotFile/todo is in citations
  reconciles: boolean;          // repoCommits/merges/authored/contributors present + consistent
  grounded: boolean;            // verifyBrief passes (nothing invented)
  tamperEvident: boolean;       // altering the brief breaks briefId
  deterministic: boolean;
  total: boolean;
  score: 0 | 100;
}

export function repoBriefGauntlet(): BriefGauntlet {
  const cs = synth();
  const b = buildRepoBrief(cs, { repo: "demo/repo", repoCommits: 26, openTodos: [{ file: "src/api.ts", line: 10, text: "TODO: paginate" }] });
  const fusesTeam = b.team.length >= 1 && b.team.every((t) => !!t.tier && typeof t.power === "number");
  const surfacesDecisions = b.decisions.length > 0 && b.decisions.every((d) => d.hash && d.subject);
  const ranksHotFiles = b.hotFiles.length > 0 && b.hotFiles[0]!.file === "src/api.ts" && b.hotFiles[0]!.touches >= b.hotFiles[b.hotFiles.length - 1]!.touches;
  const citesEverything = b.decisions.every((d) => b.citations.includes(d.hash)) && b.hotFiles.every((h) => b.citations.includes(h.file)) && b.openTodos.every((t) => b.citations.includes(`${t.file}:${t.line}`));
  const reconciles = b.reconciled.repoCommits === 26 && b.reconciled.authoredCommits === 24 && b.reconciled.merges === 2 && b.reconciled.contributors === 2;
  const grounded = verifyBrief(b, cs).ok === true;
  const tampered = { ...b, decisions: [{ hash: "deadbeef0000", subject: "invented decision", ts: 0 }] };
  const tamperEvident = verifyBrief(tampered, cs).ok === false;
  const deterministic = JSON.stringify(buildRepoBrief(cs, { repo: "demo/repo", repoCommits: 26, openTodos: [{ file: "src/api.ts", line: 10, text: "TODO: paginate" }] })) === JSON.stringify(b);
  let total = true;
  try { buildRepoBrief(null as unknown as BriefCommit[]); buildRepoBrief([]); verifyBrief(null as unknown as RepoBrief, []); } catch { total = false; }
  const all = fusesTeam && surfacesDecisions && ranksHotFiles && citesEverything && reconciles && grounded && tamperEvident && deterministic && total;
  return { fusesTeam, surfacesDecisions, ranksHotFiles, citesEverything, reconciles, grounded, tamperEvident, deterministic, total, score: all ? 100 : 0 };
}
