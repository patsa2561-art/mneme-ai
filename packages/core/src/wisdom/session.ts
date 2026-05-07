/**
 * Conversational session memory — path-aware ask context across invocations.
 *
 * Why this exists: when a user runs `mneme ask` twice in a row, the second
 * question almost always builds on the first. Without session memory, every
 * ask is a cold start; with it, Q2 search is constrained by the commits and
 * files surfaced in Q1, and topic vocabulary accumulates.
 *
 * Storage is a small JSON file at `<repoRoot>/.mneme/session.json`. We keep
 * it deliberately separate from the SQLite store: sessions are short-lived
 * (1-hour idle expiry), human-readable, and cheap to nuke. SQLite is the
 * permanent record; this is the scratch pad.
 *
 * Concurrency: writes go through a temp-file rename so a crashed/half-written
 * write never corrupts the file readers see.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface AskTurn {
  /** ISO timestamp. */
  at: string;
  /** Question text. */
  question: string;
  /** Top commits surfaced in the answer (hashes). */
  topHashes: string[];
  /** Top files mentioned (paths). */
  topFiles: string[];
  /** Confidence label of the answer. */
  confidence: "high" | "medium" | "low" | "none";
}

export interface Session {
  /** ISO timestamp of session start. */
  startedAt: string;
  /** Last activity. Sessions auto-expire after 1 hour of idle. */
  lastActivityAt: string;
  /** History of ask turns, oldest first. Cap at 20 turns. */
  turns: AskTurn[];
}

export interface SessionContext {
  /** Hashes seen in the last N turns (recency-weighted). */
  recentHashes: Set<string>;
  /** Files seen in the last N turns. */
  recentFiles: Set<string>;
  /** Topics — extracted noun phrases from recent questions, frequency-weighted. */
  recentTopics: Map<string, number>;
}

/** Maximum turns retained in a single session. */
export const MAX_TURNS = 20;
/** Idle timeout in milliseconds (1 hour). */
export const SESSION_IDLE_MS = 60 * 60 * 1000;
/** Number of recent turns considered when building context. */
const CONTEXT_TURN_WINDOW = 5;

function sessionPath(repoRoot: string): string {
  return join(repoRoot, ".mneme", "session.json");
}

/** Read session from .mneme/session.json — returns null if expired/missing. */
export function readSession(repoRoot: string, nowMs: number = Date.now()): Session | null {
  const path = sessionPath(repoRoot);
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const s = parsed as Partial<Session>;
  if (typeof s.startedAt !== "string" || typeof s.lastActivityAt !== "string" || !Array.isArray(s.turns)) {
    return null;
  }
  const lastMs = Date.parse(s.lastActivityAt);
  if (Number.isNaN(lastMs) || nowMs - lastMs > SESSION_IDLE_MS) {
    return null;
  }
  // Defensive normalization — discard any malformed turns rather than throw.
  const turns: AskTurn[] = [];
  for (const t of s.turns) {
    if (!t || typeof t !== "object") continue;
    const turn = t as Partial<AskTurn>;
    if (
      typeof turn.at !== "string" ||
      typeof turn.question !== "string" ||
      !Array.isArray(turn.topHashes) ||
      !Array.isArray(turn.topFiles) ||
      typeof turn.confidence !== "string"
    ) {
      continue;
    }
    turns.push({
      at: turn.at,
      question: turn.question,
      topHashes: turn.topHashes.filter((x): x is string => typeof x === "string"),
      topFiles: turn.topFiles.filter((x): x is string => typeof x === "string"),
      confidence: turn.confidence as AskTurn["confidence"],
    });
  }
  return { startedAt: s.startedAt, lastActivityAt: s.lastActivityAt, turns };
}

function atomicWrite(path: string, contents: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // If we cannot create the .mneme dir (e.g. read-only fs in tests), no-op.
      return;
    }
  }
  // Per-pid + timestamp temp suffix avoids two concurrent writers clobbering
  // each other's tmp file before the rename.
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    writeFileSync(tmp, contents, "utf8");
    renameSync(tmp, path);
  } catch {
    // Cleanup any orphan temp file; swallow — session is best-effort.
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
  }
}

/** Append a turn + write back. Auto-rotates when >MAX_TURNS turns. */
export function appendTurn(repoRoot: string, turn: AskTurn): void {
  const nowIso = new Date().toISOString();
  const existing = readSession(repoRoot, Date.now());
  const session: Session = existing
    ? {
        startedAt: existing.startedAt,
        lastActivityAt: nowIso,
        turns: [...existing.turns, turn],
      }
    : {
        startedAt: nowIso,
        lastActivityAt: nowIso,
        turns: [turn],
      };
  if (session.turns.length > MAX_TURNS) {
    session.turns = session.turns.slice(session.turns.length - MAX_TURNS);
  }
  atomicWrite(sessionPath(repoRoot), JSON.stringify(session, null, 2));
}

/** Reset session (e.g. user runs `mneme reset-session`). */
export function clearSession(repoRoot: string): void {
  const path = sessionPath(repoRoot);
  if (!existsSync(path)) return;
  try {
    rmSync(path, { force: true });
  } catch {
    /* ignore — best-effort cleanup */
  }
}

/**
 * Cheap noun-phrase extraction. We are not building an NLP pipeline; we just
 * want a stable bag of topic tokens that survives across turns. Anything
 * fancier (POS tagging, real chunkers) would dwarf the rest of `mneme ask`.
 */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "in", "on", "at", "to",
  "for", "with", "by", "from", "as", "is", "are", "was", "were", "be", "been",
  "being", "this", "that", "these", "those", "it", "its", "i", "you", "we",
  "they", "he", "she", "do", "does", "did", "can", "could", "should", "would",
  "will", "shall", "may", "might", "must", "have", "has", "had", "what", "why",
  "how", "when", "where", "who", "which", "there", "here", "not", "no", "yes",
  "so", "than", "then", "about", "into", "out", "up", "down", "over", "under",
  "very", "just", "only", "also", "any", "some", "all", "each", "every", "my",
  "your", "our", "their", "his", "her", "me", "us", "them", "him",
]);

function extractTopics(question: string): string[] {
  const out: string[] = [];
  for (const raw of question.toLowerCase().split(/[^a-z0-9_]+/)) {
    if (raw.length < 3) continue;
    if (STOP_WORDS.has(raw)) continue;
    if (/^\d+$/.test(raw)) continue;
    out.push(raw);
  }
  return out;
}

/**
 * Build a "session context" for retrieval — accumulates hashes/files/topics
 * from recent turns to bias search. Used by the next ask.
 */
export function buildSessionContext(session: Session | null): SessionContext {
  const ctx: SessionContext = {
    recentHashes: new Set<string>(),
    recentFiles: new Set<string>(),
    recentTopics: new Map<string, number>(),
  };
  if (!session) return ctx;
  const turns = session.turns.slice(-CONTEXT_TURN_WINDOW);
  for (const t of turns) {
    for (const h of t.topHashes) ctx.recentHashes.add(h);
    for (const f of t.topFiles) ctx.recentFiles.add(f);
    for (const topic of extractTopics(t.question)) {
      ctx.recentTopics.set(topic, (ctx.recentTopics.get(topic) ?? 0) + 1);
    }
  }
  return ctx;
}
