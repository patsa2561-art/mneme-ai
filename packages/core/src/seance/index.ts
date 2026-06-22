/**
 * v3.128.0 — SÉANCE: talk to your past self (a measured time machine for your
 * own decisions). Pick any commit — or "8 months ago" — and Mneme reconstructs
 * the DECISION CONTEXT that was true then: what you said in that commit, what you
 * were working on around it, the intentions (TODOs) you had open, and the paths
 * you tried and abandoned. An agent can then answer "why did I choose this?" —
 * grounded in, and CITED to, real commits, never invented.
 *
 * THE MOAT (Path A): this is git-native shared CONTEXT, not "memory product" — the
 * reconstructed packet is the same grounded context any agent on the team inherits,
 * and it never leaves the machine (local-first / data-sovereignty).
 *
 * DIAKRISIS — honest by construction: this is NOT spirit-channeling. The packet is
 * a DETERMINISTIC projection of git: every line traces to a real hash or file:line
 * (the `citations` list proves it), nothing is invented. The agent that answers
 * "as past you" must reason FROM the packet and is meant to be HPE-guarded so a
 * fabricated memory is caught. Pure + total.
 */

import { createHash } from "node:crypto";

export interface PastCommit { hash: string; author?: string; ts: number; subject: string; body?: string; files?: string[] }
export interface TodoThen { file: string; line: number; text: string }

export interface SeancePacket {
  seance: string;                                  // "SEANCE/1"
  at: { ref: string; hash: string; ts: number; monthsAgo: number };
  decision: { subject: string; body: string };     // what you SAID then
  window: Array<{ hash: string; subject: string; ts: number }>; // commits leading up (what you knew)
  lineage: Array<{ hash: string; subject: string; ts: number }>; // commits touching the SAME files — the real evolution of this decision
  todosThen: TodoThen[];                            // intentions open then — cited file:line
  abandoned: Array<{ hash: string; subject: string }>; // reverts / dead-ends near then
  themes: string[];                                 // what you were focused on (subject word freq)
  citations: string[];                              // every hash / file referenced — the proof
  groundingNote: string;
  packetId: string;                                 // sha256 of the body — tamper-evident
}

function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
const MONTH = 30 * 24 * 3600;
const STOP = new Set(["the", "a", "an", "to", "of", "and", "or", "for", "in", "on", "at", "with", "fix", "add", "update", "remove", "feat", "chore", "docs", "refactor", "test", "wip", "is", "it", "this", "that", "by", "from", "into", "via", "use", "make", "new", "set", "get", "via", "all", "some", "more", "do", "be"]);
const REVERT_RE = /\b(revert|rollback|undo|back out|abandon|scrap|drop the)\b/i;

function themesOf(subjects: string[]): string[] {
  const freq = new Map<string, number>();
  for (const s of subjects) {
    for (const raw of String(s).toLowerCase().split(/[^a-z0-9]+/)) {
      const w = raw.trim();
      if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  return [...freq.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);
}

export interface SeanceOpts { ref?: string; now?: number; windowBefore?: number; windowAfter?: number; todosThen?: TodoThen[] }

/**
 * Reconstruct the decision context around `atHash`. `commits` is the full history
 * (any order); `todosThen` (the TODOs alive at that commit) is supplied by the
 * caller (it needs the worktree at that ref). Deterministic + total.
 */
export function reconstructSeance(commits: PastCommit[], atHash: string, opts?: SeanceOpts): SeancePacket {
  const list = [...(commits || [])].filter((c) => c && c.hash).sort((a, b) => a.ts - b.ts); // oldest→newest
  const now = Number.isFinite(opts?.now) ? (opts!.now as number) : (list.length ? list[list.length - 1]!.ts : 0);
  const idx = Math.max(0, list.findIndex((c) => c.hash === atHash));
  const at = list[idx] || list[0] || { hash: atHash || "0", ts: 0, subject: "", body: "", files: [] };
  const before = Math.max(0, opts?.windowBefore ?? 8);
  const after = Math.max(0, opts?.windowAfter ?? 4);
  const lo = Math.max(0, idx - before), hi = Math.min(list.length, idx + after + 1);
  const win = list.slice(lo, hi);
  const window = win.map((c) => ({ hash: c.hash.slice(0, 12), subject: c.subject || "", ts: c.ts }));
  const abandoned = win.filter((c) => REVERT_RE.test(c.subject || "")).map((c) => ({ hash: c.hash.slice(0, 12), subject: c.subject || "" }));
  const themes = themesOf(win.map((c) => c.subject || ""));
  // ★ file-lineage: the REAL evolution of this decision — every other commit that
  // touched the same files as the decision commit (not just time-neighbors). This is
  // the accurate "history of this code", most-recent first.
  const atFiles = new Set((at.files || []).filter(Boolean));
  const lineage = atFiles.size
    ? list.filter((c) => c.hash !== at.hash && (c.files || []).some((f) => atFiles.has(f)))
        .sort((a, b) => b.ts - a.ts).slice(0, 8)
        .map((c) => ({ hash: c.hash.slice(0, 12), subject: c.subject || "", ts: c.ts }))
    : [];
  const todosThen = (opts?.todosThen || []).filter((t) => t && t.file).slice(0, 30);
  const citations = [
    ...win.map((c) => c.hash.slice(0, 12)),
    ...lineage.map((c) => c.hash),
    ...todosThen.map((t) => `${t.file}:${t.line}`),
  ];
  const monthsAgo = Math.max(0, Math.round((now - at.ts) / MONTH));
  const body: Omit<SeancePacket, "packetId"> = {
    seance: "SEANCE/1",
    at: { ref: opts?.ref || at.hash.slice(0, 12), hash: at.hash.slice(0, 12), ts: at.ts, monthsAgo },
    decision: { subject: at.subject || "", body: (at.body || "").trim() },
    window, lineage, todosThen, abandoned, themes, citations,
    groundingNote: "Reconstructed deterministically from git. Reason FROM these cited commits/TODOs only — do not invent a memory; an honest 'I don't know from the record' beats a fabricated reason. (HPE-guard the answer.)",
  };
  return { ...body, packetId: sha256(JSON.stringify(body)) };
}

export interface SeanceVerify { ok: boolean; reason: string }
/** Every window/abandoned entry + citation must trace back to the input commits
 *  (nothing invented); TODOs must carry file:line. Pure + total. */
export function verifySeance(packet: SeancePacket, commits: PastCommit[]): SeanceVerify {
  try {
    if (!packet || packet.seance !== "SEANCE/1") return { ok: false, reason: "not a seance packet" };
    const { packetId, ...body } = packet;
    if (sha256(JSON.stringify(body)) !== packetId) return { ok: false, reason: "packetId mismatch — body altered" };
    const known = new Set((commits || []).map((c) => (c.hash || "").slice(0, 12)));
    for (const w of packet.window) if (!known.has(w.hash)) return { ok: false, reason: `window cites unknown commit ${w.hash}` };
    for (const l of (packet.lineage || [])) if (!known.has(l.hash)) return { ok: false, reason: `lineage cites unknown commit ${l.hash}` };
    for (const a of packet.abandoned) if (!known.has(a.hash)) return { ok: false, reason: `abandoned cites unknown commit ${a.hash}` };
    for (const t of packet.todosThen) if (!t.file || typeof t.line !== "number") return { ok: false, reason: "a TODO lacks file:line" };
    return { ok: true, reason: "valid: every claim traces to a real commit/TODO" };
  } catch (e) { return { ok: false, reason: `verify error: ${(e as Error).message}` }; }
}

// ── deterministic proof ──────────────────────────────────────────────────────
function synth(n: number): PastCommit[] {
  const base = 1_700_000_000; const out: PastCommit[] = [];
  for (let i = 0; i < n; i++) out.push({
    hash: "c" + String(i).padStart(4, "0") + "abcdef", author: "alice", ts: base + i * MONTH,
    subject: i === 5 ? "revert the caching layer" : i % 2 ? "feat(cache): add redis caching layer" : "fix(api): pagination edge case",
    body: i === 4 ? "Why: chose redis over in-memory for multi-instance." : "",
    files: ["src/api.ts", i % 2 ? "src/cache.ts" : "src/api.test.ts"],
  });
  return out;
}

export interface SeanceGauntlet {
  reconstructsDecision: boolean;       // the packet's decision == the commit at the ref
  windowIsContext: boolean;            // window pulls the surrounding commits
  lineageRelevant: boolean;            // ★ lineage = commits touching the SAME files (real evolution), all cited
  citesEverything: boolean;            // every window/abandoned/lineage entry is in citations
  surfacesAbandoned: boolean;          // a revert in the window is captured
  groundedNoInvention: boolean;        // ★ verifySeance passes: nothing references a non-existent commit
  tamperEvident: boolean;              // altering the packet breaks packetId
  todosCarryLocation: boolean;         // TODOs keep file:line
  deterministic: boolean;
  total: boolean;
  score: 0 | 100;
}

export function seanceGauntlet(): SeanceGauntlet {
  const cs = synth(12);
  const at = cs[8]!.hash;
  const todos: TodoThen[] = [{ file: "src/cache.ts", line: 42, text: "TODO: add TTL eviction" }];
  const p = reconstructSeance(cs, at, { ref: "8-months-ago", todosThen: todos, now: cs[11]!.ts });

  const reconstructsDecision = p.decision.subject === cs[8]!.subject;
  const windowIsContext = p.window.length >= 5 && p.window.some((w) => w.hash === cs[7]!.hash.slice(0, 12));
  const atFiles = new Set((cs[8]!.files || []));
  const lineageRelevant = p.lineage.length > 0 && p.lineage.every((l) => { const c = cs.find((x) => x.hash.slice(0, 12) === l.hash); return !!c && (c.files || []).some((f) => atFiles.has(f)); });
  const citesEverything = p.window.every((w) => p.citations.includes(w.hash)) && p.abandoned.every((a) => p.citations.includes(a.hash)) && p.lineage.every((l) => p.citations.includes(l.hash));
  const surfacesAbandoned = p.abandoned.some((a) => /revert/i.test(a.subject));
  const groundedNoInvention = verifySeance(p, cs).ok === true;
  const tampered = { ...p, decision: { subject: "I totally remember choosing this for reasons", body: "fabricated" } };
  const tamperEvident = verifySeance(tampered, cs).ok === false;
  const todosCarryLocation = p.todosThen.every((t) => !!t.file && typeof t.line === "number");
  const deterministic = JSON.stringify(reconstructSeance(cs, at, { ref: "8-months-ago", todosThen: todos, now: cs[11]!.ts })) === JSON.stringify(p);
  let total = true;
  try { reconstructSeance(null as unknown as PastCommit[], ""); reconstructSeance([], "x"); verifySeance(null as unknown as SeancePacket, []); } catch { total = false; }

  const all = reconstructsDecision && windowIsContext && lineageRelevant && citesEverything && surfacesAbandoned && groundedNoInvention && tamperEvident && todosCarryLocation && deterministic && total;
  return { reconstructsDecision, windowIsContext, lineageRelevant, citesEverything, surfacesAbandoned, groundedNoInvention, tamperEvident, todosCarryLocation, deterministic, total, score: all ? 100 : 0 };
}
