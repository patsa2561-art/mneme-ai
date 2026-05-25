/**
 * v2.45.0 — AUTO-INIT (closes caveat #1).
 *
 * The bug from user's v2.41 audit: "ลูกค้าต้องรัน `mneme init` ก่อน;
 * ถ้าใช้ผ่าน MCP โดยตรงโดยไม่รัน init → อาจไม่มี .gitignore ถูก create".
 *
 * Fix: every MCP tool call (and every CLI invocation that touches the
 * repo) auto-bootstraps in <50ms. Idempotent + defensive — never throws,
 * never duplicates entries, skips DEV-TOOLING folders.
 *
 * User experience after install:
 *   1. user installs Mneme
 *   2. user opens Cursor / Claude Code / etc
 *   3. AI agent calls ANY mneme.* MCP tool → server boot runs autoInit
 *      silently
 *   4. .mneme/ + .gitignore entries appear automatically
 *   5. user NEVER typed `mneme init`
 *
 * Pure deterministic on the idempotent path (already-init → no writes).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { detectDevTooling } from "./dev_tooling_detector.js";

// Entries appended to .gitignore. Each on its own line. Sentinel-bracketed
// so we can find + update them atomically without touching user-authored
// entries above/below.
const GITIGNORE_SENTINEL_BEGIN = "# BEGIN MNEME AUTO-INIT (do not edit between sentinels) — v2.45.0+";
const GITIGNORE_SENTINEL_END   = "# END MNEME AUTO-INIT";
const GITIGNORE_PAYLOAD = [
  ".mneme/",
  "CLAUDE.md",
  "AGENTS.md",
  ".cursorrules",
  ".windsurfrules",
  ".windsurf/",
  ".cursor/",
  ".continuerc",
  "GEMINI.md",
  ".aider.conf.yml",
  ".aider.chat.history.md",
  ".aider.input.history",
  // Mneme local state never goes to git
  ".mneme/lie-vaccines.jsonl",
  ".mneme/cli-activity.jsonl",
  ".mneme/honest_mirror_weights.json",
];

export interface AutoInitResult {
  ok: boolean;
  /** True when no work was needed (.mneme/ + sentinel-block already present). */
  alreadyInit?: boolean;
  /** Why autoInit became a no-op (e.g. dev-tooling folder, no write access). */
  skippedReason?: string;
  /** Paths created or modified. */
  created: string[];
  /** Wall time ms. */
  dtMs: number;
  /** Why ok=false, if applicable. */
  reason?: string;
}

function ensureMnemeDir(cwd: string, created: string[]): boolean {
  const dir = join(cwd, ".mneme");
  if (existsSync(dir)) return true;
  try {
    mkdirSync(dir, { recursive: true });
    created.push(".mneme/");
    return true;
  } catch { return false; }
}

function ensureGitignoreSentinelBlock(cwd: string, created: string[]): boolean {
  const path = join(cwd, ".gitignore");
  let body = "";
  let existed = false;
  try {
    if (existsSync(path)) {
      body = readFileSync(path, "utf8");
      existed = true;
    }
  } catch { return false; }
  // Already has our sentinel block? Idempotent return.
  if (body.includes(GITIGNORE_SENTINEL_BEGIN) && body.includes(GITIGNORE_SENTINEL_END)) {
    return true;
  }
  // Build the block. If user already has SOME of our entries above
  // (legacy install), our sentinel block is still safe — git collapses
  // duplicates without warning.
  const block = [
    "",
    GITIGNORE_SENTINEL_BEGIN,
    ...GITIGNORE_PAYLOAD,
    GITIGNORE_SENTINEL_END,
    "",
  ].join("\n");
  // Strip duplicates from PAYLOAD that may have been written by an
  // older / manual install (avoid the literal duplicate-line audit
  // catch). We only de-dupe lines that exactly match one of our
  // payload entries.
  const payloadSet = new Set(GITIGNORE_PAYLOAD);
  const dedupedLines = body.split("\n").filter((ln, i, arr) => {
    const t = ln.trim();
    if (!payloadSet.has(t)) return true;
    // Keep the FIRST occurrence only
    return arr.findIndex((x) => x.trim() === t) === i;
  });
  const cleanBody = dedupedLines.join("\n");
  // Append our sentinel block.
  const final = cleanBody.endsWith("\n") || cleanBody.length === 0 ? cleanBody + block : cleanBody + "\n" + block;
  try {
    writeFileSync(path, final);
    if (!existed) created.push(".gitignore");
    return true;
  } catch { return false; }
}

/**
 * Idempotent bootstrap. Safe to call before EVERY MCP tool dispatch.
 * Returns ok=false (never throws) when path is invalid or filesystem
 * refuses writes.
 */
export function autoInit(cwd: string): AutoInitResult {
  const t0 = Date.now();
  const created: string[] = [];
  if (!cwd) {
    return { ok: false, reason: "empty cwd", created, dtMs: Date.now() - t0 };
  }
  // Quick existence check (path must exist + be readable)
  try {
    const st = statSync(cwd);
    if (!st.isDirectory()) {
      return { ok: false, reason: "cwd is not a directory", created, dtMs: Date.now() - t0 };
    }
  } catch (e) {
    return { ok: false, reason: `cwd inaccessible: ${(e as Error).message?.slice(0, 80) ?? "err"}`, created, dtMs: Date.now() - t0 };
  }
  // Skip dev-tooling folders (user's own scratch dirs — closes caveat #3).
  const tooling = detectDevTooling(cwd);
  if (tooling.isDevTooling) {
    return {
      ok: true,
      skippedReason: `dev-tooling folder detected: ${tooling.reason}`,
      created,
      dtMs: Date.now() - t0,
    };
  }
  // Hot path: both already in place?
  const mnemeExists = existsSync(join(cwd, ".mneme"));
  let alreadyInit = false;
  if (mnemeExists) {
    const giPath = join(cwd, ".gitignore");
    if (existsSync(giPath)) {
      try {
        const body = readFileSync(giPath, "utf8");
        if (body.includes(GITIGNORE_SENTINEL_BEGIN)) {
          alreadyInit = true;
        }
      } catch { /* fall through to write */ }
    }
  }
  if (alreadyInit) {
    return { ok: true, alreadyInit: true, created, dtMs: Date.now() - t0 };
  }
  // Cold path: ensure both .mneme/ + .gitignore sentinel block.
  const mnemeOk = ensureMnemeDir(cwd, created);
  const giOk = ensureGitignoreSentinelBlock(cwd, created);
  if (!mnemeOk || !giOk) {
    return {
      ok: false,
      reason: `partial init: mneme=${mnemeOk} gitignore=${giOk}`,
      created,
      dtMs: Date.now() - t0,
    };
  }
  return { ok: true, alreadyInit: false, created, dtMs: Date.now() - t0 };
}

/**
 * Best-effort guard: call this at the TOP of every MCP CallTool handler
 * + every CLI command. Never blocks, never throws. Returns silently.
 */
export function autoInitSilent(cwd: string): void {
  try { autoInit(cwd); } catch { /* never bubble */ }
}

export { GITIGNORE_PAYLOAD, GITIGNORE_SENTINEL_BEGIN, GITIGNORE_SENTINEL_END };
export { detectDevTooling };
export type { DevToolingVerdict } from "./dev_tooling_detector.js";
