/**
 * v2.19.94 — LIVE SESSION MIRROR.
 *
 * Fixes the bug user caught in v2.19.93: `mneme genesplice transmit`
 * was returning capsule from 2026-05-13 (8 days old) when invoked
 * INSIDE the current Claude Code session today.
 *
 * Root cause: Mneme daemon never recorded the current Claude Code
 * conversation. The MCP `genesplice transmit` handler fell back to
 * `allCapsules[0]` — whatever stale capsule happened to be on disk.
 *
 * The wild idea: every AI editor ALREADY writes the live conversation
 * to a local jsonl on disk. Claude Code writes to
 * `~/.claude/projects/<repo-hash>/<session-uuid>.jsonl`. Cursor writes
 * to its own store. Cline / Codeium / Continue each have their own
 * location. We don't need vendor cooperation — we just READ OUR OWN
 * DATA on OUR OWN DISK in realtime.
 *
 * This module:
 *   1. Discovers the newest live session jsonl across known editor
 *      locations (Claude Code first; pluggable for others)
 *   2. Filters to ones matching the current `cwd` (so multi-repo
 *      machines get the RIGHT conversation)
 *   3. Tails the file (last N turns) — partial-last-line safe because
 *      the file is being written to RIGHT NOW
 *   4. Converts to a SessionCapsule shape so it composes with the
 *      existing GENESPLICE / DIASPORA pipeline (zero changes downstream)
 *
 * Cross-device extension (composes with BEACON v2.19.32+): once a
 * fresh capsule exists, the existing port-ladder + QR + clipboard
 * transports ship it across machines / mobile. The fix here is
 * upstream — making sure the capsule is FRESH at the moment of clone.
 */

import { existsSync, readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash, createHmac, randomBytes } from "node:crypto";

/** A single turn extracted from a live session file. */
export interface LiveTurn {
  /** ISO timestamp. */
  ts: string;
  role: "user" | "assistant" | "tool";
  /** Plain text (already de-multimodal'd; tool_use / thinking dropped). */
  text: string;
}

/** Lightweight discovery record before we parse turns. */
export interface LiveSessionDescriptor {
  vendor: "claude-code" | "cursor" | "cline" | "codeium" | "continue" | "unknown";
  filePath: string;
  sessionId: string;
  /** `cwd` field from the session (the dir the AI was launched in). */
  cwd: string | null;
  /** File mtime in ms. */
  mtimeMs: number;
  /** File size in bytes. */
  sizeBytes: number;
}

/** A fresh capsule built from a live session — shape compatible with
 *  diaspora.SessionCapsule so genesplice can consume it directly. */
export interface LiveCapsule {
  id: string;
  capsuleVersion: 1;
  createdAt: string;
  originVendor: string;
  /** Stable per-machine + repo identifier. */
  repoFingerprint: string;
  /** Auto-summarised one-paragraph context (deterministic, no LLM). */
  contextSummary: string;
  /** Last N turns, oldest first. */
  promptTrace: Array<{ ts: string; role: "user" | "assistant" | "tool"; text: string }>;
  /** Heuristic-extracted decisions (lines that start with verbs like
   *  "ship", "use", "go with", "เลือก", "ตัดสินใจ"). */
  decisions?: string[];
  /** Pointer back to source jsonl for audit. */
  sourceFile: string;
  /** Always present on live capsules — marker so callers can tell. */
  isLive: true;
  hmac: string;
}

// ─── DISCOVERY ─────────────────────────────────────────────────────────

const CLAUDE_PROJECTS_DIR = ".claude/projects";

/** Encode an absolute repo path into Claude Code's project-dir slug.
 *  Mirrors the rule we observed empirically: drive letter colons drop,
 *  separators (\ or /) become single dashes.
 *  e.g. `d:\lib_ai_git` → `d--lib-ai-git` */
export function encodeClaudeProjectSlug(repoRoot: string): string {
  return repoRoot
    .replace(/:/g, "")           // drop drive-letter colon
    .replace(/[\\/]/g, "-")      // separators → dashes
    .replace(/_/g, "-")          // underscores → dashes (observed)
    .replace(/-+/g, "-")         // collapse repeats
    .replace(/^-+|-+$/g, "");    // trim ends
}

/** Find every Claude Code session jsonl on this machine. Skips the
 *  `subagents/` subdirectory because those are tool-spawned sub-sessions
 *  not user conversations. */
export function discoverClaudeCodeSessions(): LiveSessionDescriptor[] {
  const base = join(homedir(), CLAUDE_PROJECTS_DIR);
  if (!existsSync(base)) return [];
  const out: LiveSessionDescriptor[] = [];
  let projectDirs: string[] = [];
  try { projectDirs = readdirSync(base); } catch { return []; }
  for (const projectDir of projectDirs) {
    const projPath = join(base, projectDir);
    let entries: string[] = [];
    try {
      const st = statSync(projPath);
      if (!st.isDirectory()) continue;
      entries = readdirSync(projPath);
    } catch { continue; }
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      const filePath = join(projPath, entry);
      let st;
      try { st = statSync(filePath); } catch { continue; }
      if (!st.isFile()) continue;
      const sessionId = entry.replace(/\.jsonl$/, "");
      // Peek the first line to extract `cwd`.
      const cwd = peekCwd(filePath);
      out.push({
        vendor: "claude-code",
        filePath,
        sessionId,
        cwd,
        mtimeMs: st.mtimeMs,
        sizeBytes: st.size,
      });
    }
  }
  // Sort newest first.
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

/** Read just enough of a jsonl to extract the `cwd` field. Scans the
 *  first ~8 lines because line 1 is often an `ai-title` metadata row
 *  with no cwd; cwd lives on the first user/assistant turn. */
function peekCwd(filePath: string): string | null {
  try {
    const buf = Buffer.alloc(16384);
    const fd = openSync(filePath, "r");
    try {
      const n = readSync(fd, buf, 0, 16384, 0);
      const slice = buf.slice(0, n).toString("utf8");
      const lines = slice.split("\n").slice(0, 8);
      for (const line of lines) {
        if (!line || line.length < 2) continue;
        try {
          const obj = JSON.parse(line);
          if (typeof obj?.cwd === "string" && obj.cwd.length > 0) return obj.cwd;
        } catch { /* keep scanning */ }
      }
      return null;
    } finally {
      try { closeSync(fd); } catch { /* */ }
    }
  } catch { return null; }
}

// ─── EXTRACT TURNS ─────────────────────────────────────────────────────

/** Read the tail of a jsonl and extract last N user/assistant turns
 *  with plain text only (tool_use / thinking / tool_result with bulky
 *  content are dropped). */
export function extractRecentTurns(filePath: string, lastN: number = 20): LiveTurn[] {
  if (!existsSync(filePath)) return [];
  let raw: string;
  let wasTailed = false;
  try {
    // For very large files, read the last ~2MB only — cheap on disk.
    const stat = statSync(filePath);
    const fd = openSync(filePath, "r");
    try {
      const TAIL = 2 * 1024 * 1024;
      const tailSize = Math.min(stat.size, TAIL);
      const startOffset = Math.max(0, stat.size - tailSize);
      wasTailed = startOffset > 0;
      const buf = Buffer.alloc(tailSize);
      readSync(fd, buf, 0, tailSize, startOffset);
      raw = buf.toString("utf8");
    } finally {
      try { closeSync(fd); } catch { /* */ }
    }
  } catch { return []; }
  // Drop line 0 ONLY when we tailed (cut mid-record).  For files small
  // enough to read in full, line 0 is the real first record.
  const lines = raw.split("\n");
  const startIdx = wasTailed ? 1 : 0;
  const turns: LiveTurn[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line || line.length < 2) continue;
    let obj: any;
    try { obj = JSON.parse(line); } catch { continue; }
    if (!obj || typeof obj !== "object") continue;
    const ts = typeof obj.timestamp === "string" ? obj.timestamp : new Date().toISOString();
    const msg = obj.message;
    if (!msg || typeof msg !== "object") continue;
    const role = msg.role;
    if (role !== "user" && role !== "assistant") continue;
    let text = "";
    let toolResultOnly = false;
    const content = msg.content;
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      const parts: string[] = [];
      let sawText = false;
      let sawToolResult = false;
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        if (part.type === "text" && typeof part.text === "string") {
          parts.push(part.text);
          sawText = true;
        }
        // tool_use / thinking are dropped (bloat).
        if (part.type === "tool_result") sawToolResult = true;
      }
      text = parts.join("\n").trim();
      toolResultOnly = !sawText && sawToolResult;
    }
    // Skip turns that are PURELY tool-results — they're noise, not
    // the real conversation.  Same goes for empty/very-short turns.
    if (toolResultOnly) continue;
    if (!text || text.length < 4) continue;
    turns.push({ ts, role, text });
  }
  // Last N (most recent).
  return turns.slice(-lastN);
}

// ─── BUILD CAPSULE ─────────────────────────────────────────────────────

const CAPSULE_VERSION = 1 as const;

/** Build a fresh capsule from the live session. Returns null if no live
 *  Claude Code session is found for this repoRoot. */
export function captureLiveCapsule(repoRoot: string, opts: { lastN?: number; secret?: string } = {}): LiveCapsule | null {
  const lastN = opts.lastN ?? 25;
  const all = discoverClaudeCodeSessions();
  if (all.length === 0) return null;
  // Prefer session whose `cwd` matches repoRoot (case-insensitive — Windows).
  const norm = (s: string | null) => (s ?? "").replace(/[\\/]+$/, "").toLowerCase();
  const target = norm(repoRoot);
  let pick = all.find((s) => norm(s.cwd) === target);
  if (!pick) {
    // Fallback: pick newest globally.
    pick = all[0];
  }
  if (!pick) return null;
  const turns = extractRecentTurns(pick.filePath, lastN);
  if (turns.length === 0) return null;
  const contextSummary = summariseTurns(turns);
  const decisions = extractDecisions(turns);
  const createdAt = new Date().toISOString();
  const repoFingerprint = createHash("sha256").update(repoRoot).digest("hex").slice(0, 16);
  const secret = opts.secret ?? randomBytes(32).toString("hex");
  const payload = {
    capsuleVersion: CAPSULE_VERSION,
    createdAt,
    originVendor: pick.vendor === "claude-code" ? "claude-opus-4-7" : pick.vendor,
    repoFingerprint,
    contextSummary,
    promptTrace: turns,
    decisions,
    sourceFile: pick.filePath,
    isLive: true as const,
  };
  const canon = JSON.stringify({ ...payload, hmac: undefined });
  const hmac = createHmac("sha256", secret).update(canon).digest("hex");
  const id = createHash("sha256").update(canon).digest("hex").slice(0, 16);
  return { id, ...payload, hmac };
}

/** Deterministic 1-3 sentence context summary. No LLM call. */
function summariseTurns(turns: LiveTurn[]): string {
  // Take last 3 user turns; concatenate first ~80 chars each.
  const userTurns = turns.filter((t) => t.role === "user").slice(-3);
  if (userTurns.length === 0) return "Live Claude Code session in progress.";
  const snippets = userTurns.map((t) => {
    const oneLine = t.text.replace(/\s+/g, " ").trim();
    return oneLine.length > 160 ? oneLine.slice(0, 160) + "…" : oneLine;
  });
  const tail = turns[turns.length - 1];
  const head = `Live Claude Code session — ${turns.length} recent turn(s), most recent ${tail?.role ?? "?"} at ${tail?.ts ?? "?"}.`;
  return head + " Recent user asks: " + snippets.map((s, i) => `(${i + 1}) ${s}`).join("  ");
}

/** Heuristic: pull lines that look like decisions. Multilingual (EN+TH). */
function extractDecisions(turns: LiveTurn[]): string[] {
  const out: string[] = [];
  const verbs = /\b(ship|use|go with|pick|chose|decided|let'?s|i'?ll|we'?ll)\b|เลือก|ตัดสินใจ|จะใช้|จะทำ|จะ ship/i;
  for (const t of turns) {
    if (t.role !== "assistant") continue;
    for (const rawLine of t.text.split(/\n/)) {
      const line = rawLine.trim().replace(/^[#>\-\*•]+\s*/, "");
      if (line.length < 12 || line.length > 200) continue;
      if (verbs.test(line)) out.push(line);
      if (out.length >= 10) break;
    }
    if (out.length >= 10) break;
  }
  return out;
}

// ─── INSPECTOR (for CLI / debugging) ───────────────────────────────────

export interface LiveSessionInspectorResult {
  sessions: LiveSessionDescriptor[];
  pickedFor: { repoRoot: string; picked: LiveSessionDescriptor | null };
  freshTurnCount: number;
  sampleTurn: LiveTurn | null;
}

/** Diagnostic: what does the mirror see right now? */
export function inspectLiveSessions(repoRoot: string): LiveSessionInspectorResult {
  const sessions = discoverClaudeCodeSessions();
  const norm = (s: string | null) => (s ?? "").replace(/[\\/]+$/, "").toLowerCase();
  const target = norm(repoRoot);
  const picked = sessions.find((s) => norm(s.cwd) === target) ?? sessions[0] ?? null;
  const turns = picked ? extractRecentTurns(picked.filePath, 5) : [];
  return {
    sessions: sessions.slice(0, 10),
    pickedFor: { repoRoot, picked },
    freshTurnCount: turns.length,
    sampleTurn: turns[turns.length - 1] ?? null,
  };
}
