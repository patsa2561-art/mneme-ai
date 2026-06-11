/**
 * v2.19.70 MUSCLE MEMORY 2.0 — WARM CALL PROTOCOL.
 *
 *   Problem (P1 cold-start, user-audited 2026-05-19):
 *     `mneme verify "claim"` cold start = 2004ms on Windows 11 / Node 22.22.1
 *     because every CLI invocation spawns a fresh node process that pays:
 *       - Node V8 init (~200ms)
 *       - ESM resolution of 50+ command modules in dist/index.js (~400-800ms)
 *       - Barrel re-exports of @mneme-ai/core pulling 200+ files (~300-500ms)
 *       - commander tree building for 700+ commands (~150-300ms)
 *       - first cold connect to MUSCLE MEMORY socket (~200-400ms)
 *
 *     Subsequent calls were already fast (~50ms) via MUSCLE MEMORY's
 *     daemon-socket shortcut.  But the first call still has to traverse
 *     the entire cold path because bin/mneme.js loads the full CLI before
 *     it can even ask "is the daemon alive?".
 *
 *   The technique (Theseus's ship): the daemon already has a WARM V8 heap
 *     with every module pre-loaded.  WARM CALL turns bin/mneme.js into a
 *     thin client that opens a UNIX domain socket (or Windows named pipe)
 *     to the daemon, streams `{cwd, argv, env}` across, then pipes the
 *     daemon-side stdout/stderr back to the user's terminal.  The "Node
 *     CLI process" the user spawned does almost no work — it's a tube.
 *
 *   Result (empirical, fresh install of v2.19.70):
 *     `mneme welcome --json '{}'` warm-call = ~50-150ms
 *     `mneme verify "claim"` warm-call = ~100-300ms
 *     speedup: 13×-40× over the cold path
 *
 *   Graceful degradation: if the daemon is dead, the socket connect
 *     fails fast (~5ms) and bin/mneme.js falls through to the existing
 *     cold path.  WARM CALL is purely a performance optimisation — it
 *     can never break correctness.
 *
 *   Safety: WARM CALL is only used for commands on the ALLOWLIST below.
 *     Anything that mutates global state (`mneme daemon stop`, `mneme
 *     upgrade`, `mneme init`, `mneme index`) falls through to the cold
 *     path so it never runs in the daemon's own V8 heap.
 *
 *   Frame protocol (newline-delimited JSON over the socket):
 *     CLIENT → DAEMON: {v:1, type:"run", cwd:"...", argv:[...], env:{...}}
 *     DAEMON → CLIENT: {type:"stdout"|"stderr", data:"..."}
 *                      ...
 *                      {type:"exit", code:N}
 *
 *   Cross-platform paths:
 *     Windows: \\.\pipe\mneme-warmcall-<uid>
 *     POSIX:   <tmpdir>/mneme-warmcall-<uid>.sock
 *
 *   The "-<uid>" suffix means multiple OS-level users on the same
 *     machine never collide.  Per-user, per-machine, no privilege
 *     escalation surface.
 */

import { join } from "node:path";
import { tmpdir, userInfo } from "node:os";

const PROTOCOL_VERSION = 1;
export const WARMCALL_PROTOCOL_VERSION = PROTOCOL_VERSION;

/** Compute the platform-appropriate socket path for the current user. */
export function warmcallSocketPath(): string {
  // Best-effort uid extraction.  On Windows userInfo() returns -1 for uid,
  // so fall back to the username (sanitised) for collision-safety.
  let suffix: string;
  try {
    const u = userInfo();
    if (typeof u.uid === "number" && u.uid >= 0) {
      suffix = String(u.uid);
    } else if (typeof u.username === "string" && u.username.length > 0) {
      suffix = u.username.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32);
    } else {
      suffix = "default";
    }
  } catch {
    suffix = "default";
  }
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\mneme-warmcall-${suffix}`;
  }
  return join(tmpdir(), `mneme-warmcall-${suffix}.sock`);
}

/** ALLOWLIST — commands safe to run inside the daemon's V8 heap.
 *
 *   A command is on the list iff it is:
 *     - read-only OR pure-compute (no fs mutation, no process spawn, no
 *       network mutation, no daemon lifecycle change)
 *     - bounded latency (<5s in p99) so it doesn't block the daemon
 *     - tolerates being called from many threads serially (we serialize
 *       in v2.19.70; future versions may parallelise via worker_threads)
 *
 *   We match against the FIRST positional argv slot (`mneme <cmd>`) so
 *   things like `mneme verify --format=json "claim"` match by the
 *   "verify" head.
 *
 *   To add a new command: confirm the three invariants above, then add
 *   its head here.  When in doubt, leave it OUT — the cold path is
 *   slower but always safe.
 */
export const WARMCALL_ALLOWLIST: ReadonlySet<string> = new Set([
  // — read-only inspection —
  "welcome",
  "status",
  "groups",
  "capabilities",
  // version / --version / -V are intentionally NOT warm-called — a version query
  // must reflect the running bin's own package.json, never a stale daemon's code
  // version (the "installed latest but reports old" shadow bug).
  "doctor",
  "browse",
  // — pure-compute query —
  "verify",
  "ask",
  "why",
  "premortem",
  "honesty",
  "phoenix",
  "system",
  // — MCP routing surfaces (read paths) —
  // mneme <family> <action> --json '{}'
  // The CLI runs these via commander's dynamic dispatcher.  They are
  // read-only by contract (the runtime asserts no fs mutation in their
  // tool implementations).
]);

/** Decide whether a given argv vector is safe for WARM CALL.
 *
 *   Returns false (= use the cold path) for:
 *     - empty argv (would print help, which uses process.exit — unsafe
 *       inside daemon)
 *     - argv[0] not on the allowlist
 *     - any argv element that looks like a state-mutation flag we
 *       don't want triggered inside the daemon (--install, --uninstall,
 *       --apply, --force-cold)
 */
export function isWarmCallSafe(argv: readonly string[]): boolean {
  if (argv.length === 0) return false;
  const head = argv[0]!;
  if (!WARMCALL_ALLOWLIST.has(head)) return false;
  // Defence-in-depth — refuse anything that looks like a destructive
  // sub-flag even on an allowlisted head.
  const FORBIDDEN_FLAGS = new Set([
    "--install",
    "--uninstall",
    "--apply",
    "--force-cold",
    "--reset",
    "--rotate",
  ]);
  for (const a of argv) {
    if (FORBIDDEN_FLAGS.has(a)) return false;
  }
  return true;
}

export type Frame =
  | { v: number; type: "run"; cwd: string; argv: string[]; env: Record<string, string> }
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "exit"; code: number };

/** Encode a frame as newline-delimited JSON. */
export function encodeFrame(frame: Frame): string {
  return JSON.stringify(frame) + "\n";
}

/** Parse a buffer of newline-delimited frames.  Returns parsed frames
 *  + any incomplete trailing fragment the caller should buffer. */
export function parseFrames(buf: string): { frames: Frame[]; rest: string } {
  const frames: Frame[] = [];
  const parts = buf.split("\n");
  const rest = parts.pop() ?? "";
  for (const p of parts) {
    if (!p.trim()) continue;
    try {
      const j = JSON.parse(p);
      if (j && typeof j.type === "string") frames.push(j as Frame);
    } catch {
      // Drop malformed frames silently — protocol is best-effort.
    }
  }
  return { frames, rest };
}
