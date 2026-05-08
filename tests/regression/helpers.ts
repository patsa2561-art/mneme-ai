// Regression-test helpers.
//
// Single source of truth for: which commands exist, how to spawn the CLI,
// and how to normalize volatile output for snapshots.
//
// Why this file exists:
// We have ~1010 unit tests but no end-to-end smoke wall over the
// `mneme <command>` surface. These helpers let the regression suite spawn
// the real bin (`packages/cli/bin/mneme.js`), strip ANSI / timestamps,
// and reuse the command list across every regression file.

import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from "node:child_process";

// ── repo + bin paths ────────────────────────────────────────────────────
//
// __dirname-equivalent: tests/regression lives 2 levels under the repo root.
const HERE = resolve(new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:"));
export const REPO_ROOT = resolve(HERE, "..", "..");
export const CLI_BIN = resolve(REPO_ROOT, "packages", "cli", "bin", "mneme.js");

// ── ANSI strip + snapshot normalization ─────────────────────────────────
//
// Why this is finicky: commander renders `--help` using the terminal's column
// width, and Linux runners + Windows + macOS all report different widths in
// their TTY-less defaults. CRLF vs LF line endings, trailing whitespace from
// padding, and the OSC 8 / cursor-positioning escape sequences all sneak in
// and rot snapshots.
//
// The matcher is "match by SHAPE, not by glyph": we drop ANSI, normalize line
// endings, strip trailing whitespace, mask all volatile fields, and collapse
// any wrap-driven inner whitespace inside two-column command rows (those are
// the lines containing the commander " > " arrow).

// All ESC[…] sequences (color, cursor moves, OSC, scrollback) — not just
// SGR (the older `\x1b\[[0-9;]*m`).  Some terminals emit cursor position
// queries (`\x1b\[6n`) and column resets (`\x1b\[\d+D`) that snuck through.
const ANSI_RE = /\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g;

export function strip(s: string): string {
  return s.replace(ANSI_RE, "");
}

/**
 * Normalize for snapshots: drop ANSI, then mask volatile bits
 * (timestamps, durations, hashes, dates, counts) so snapshots stay stable
 * across runs. Order matters — mask before count regex collapses spaces.
 */
export function normalize(out: string): string {
  // 1. Line endings + trailing whitespace + ANSI: do these FIRST so every
  //    later regex sees a canonical \n-separated, right-trimmed string.
  let s = out.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  s = strip(s);
  s = s
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n");

  // 2. Mask volatile content.
  s = s
    // ISO-ish timestamps "2024-01-01T12:34:56.789Z" → <TS>
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, "<TS>")
    // durations: "12.3 ms", "4s", "2 d"
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|µs|us|sec|s|min|d|h)\b/g, "<DURATION>")
    // git-ish hashes (7..40 hex)
    .replace(/\b[a-f0-9]{7,40}\b/g, "<HASH>")
    // ISO dates
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "<DATE>")
    // numeric counts attached to nouns
    .replace(/\b\d+\s+(commits?|chunks?|files?|authors?|entities)\b/g, "<COUNT> $1")
    // file sizes: "1.2 MB" / "234 KB"
    .replace(/\b\d+(?:\.\d+)?\s*(?:KB|MB|GB|B)\b/gi, "<SIZE>")
    // absolute Windows / POSIX paths inside output (to avoid CI vs local diffs)
    .replace(/[A-Za-z]:\\[^\s]+/g, "<PATH>")
    .replace(/\/(?:tmp|var|home|Users)\/[^\s]+/g, "<PATH>");

  // 3. Collapse pty-width-dependent column wrapping in commander's
  //    two-column help layout. These are the lines that look like:
  //        audit [options]                          AI Session Audit — …
  //    The exact gap between "[options]" and "AI" depends on the longest
  //    command name AND the terminal width — neither is portable. We
  //    detect them by the multi-space gap and collapse to a single " > ".
  //    We only touch lines that BEGIN with whitespace + a word followed
  //    by 2+ spaces, so prose lines and code blocks are untouched.
  s = s
    .split("\n")
    .map((line) => {
      // Match: leading indent, command-ish token, 2+ spaces, then the
      // description. This is the commander layout; collapse the gap.
      const m = line.match(/^(\s+)([^\s>][^\n]*?[^\s])(\s{2,})(\S.*)$/);
      if (!m) return line;
      // Avoid touching any line that looks like a code block (starts with
      // `$ `, `>>>`, or has indented bullets like "•" / "·" or pipes).
      if (/^\s*(?:[\$>•·│┃|]|\d+\.\s|-\s|\*\s)/.test(line)) return line;
      // Heuristic: only collapse when the description side does NOT start
      // with a column-aligned punctuation glyph (those are tables we want
      // to keep as-is, e.g. "  ┃ key   ┃ value ┃").
      return `${m[1]}${m[2]}  >  ${m[4]}`;
    })
    .join("\n");

  return s;
}

// ── subprocess helpers ──────────────────────────────────────────────────

export interface RunResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  combined: string;
}

/**
 * Run the CLI with `args`. We invoke node on the bin directly (no shell)
 * so argv parsing is identical on Windows + POSIX, and so we don't
 * accidentally inherit a hung shell stdin.
 */
export function runCli(args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): RunResult {
  // 30s default — generous enough for Windows + Node 24 cold-start
  // (node:sqlite first-load + git subprocess + dist/index.js parse). The
  // test value is catching genuine hangs (daemons, infinite loops), not
  // enforcing wall-clock perf — runaway commands still trip the limit.
  const spawnOpts: SpawnSyncOptions = {
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 30_000,
    cwd: opts.cwd ?? REPO_ROOT,
    // Hand the child an empty stdin so anything that calls `await readline`
    // gets EOF instead of blocking. NO_COLOR keeps snapshots stable.
    input: "",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", CI: "1" },
    maxBuffer: 10 * 1024 * 1024,
  };
  const r = spawnSync(process.execPath, [CLI_BIN, ...args], spawnOpts) as SpawnSyncReturns<string>;
  const stdout = (r.stdout ?? "") as string;
  const stderr = (r.stderr ?? "") as string;
  return {
    status: r.status,
    signal: r.signal,
    stdout,
    stderr,
    combined: stdout + stderr,
  };
}

// ── temp-repo factories ────────────────────────────────────────────────

export function mkTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "mneme-regression-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  // a single commit so commands that walk HEAD don't trip on "no commits yet"
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "test"], { cwd: dir });
  spawnSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: dir });
  return dir;
}

export function rmTempRepo(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort; Windows file locks during a test run shouldn't fail the suite
  }
}

// ── command list ───────────────────────────────────────────────────────
//
// Source of truth: parse `packages/cli/src/index.ts` and pull every
// `.command("<name>...")` declaration. We do this once at module load.
function discoverCommands(): string[] {
  const src = readFileSync(resolve(REPO_ROOT, "packages", "cli", "src", "index.ts"), "utf8");
  const out: string[] = [];
  // top-level commands: `program.command("foo ...")` / `program.command("foo")`
  const topRe = /\bprogram\s*\.\s*command\(\s*"([^"]+)"/g;
  // forensics sub-commands attach to forensicsCmd
  const subRe = /\bforensicsCmd\s*\.\s*command\(\s*"([^"]+)"/g;

  let m: RegExpExecArray | null;
  while ((m = topRe.exec(src)) !== null) {
    const head = (m[1] ?? "").split(/\s+/, 1)[0]; // trim "ask <question...>" → "ask"
    if (head) out.push(head);
  }
  while ((m = subRe.exec(src)) !== null) {
    const head = (m[1] ?? "").split(/\s+/, 1)[0];
    if (head) out.push(`forensics ${head}`);
  }
  return Array.from(new Set(out)).sort();
}

export const ALL_COMMANDS: string[] = discoverCommands();

/** Commands that take a required positional and have nothing useful to say with no args. */
export const REQUIRES_ARGS = new Set<string>([
  "do", "ask", "why", "blast", "palimpsest", "teach", "genius",
  "who-knows", "story", "premortem", "time-machine",
  "forensics match", "forensics attribute",
  "feedback",
]);

/**
 * Commands that are interactive, daemons, or open network sockets — they will
 * hang or have non-trivial side-effects when run with no flags. We test these
 * via `--help` only.
 */
export const INTERACTIVE_OR_DAEMON = new Set<string>([
  "watch", "chat", "mcp", "guardian", "guard", "init", "setup-free",
  "upgrade", "feedback",
]);

/** Smallest valid invocation for commands that need args. */
export const SMALLEST_VALID_INVOCATION: Record<string, string[]> = {
  do: ["do", "noop"],
  ask: ["ask", "noop"],
  why: ["why", "README.md"],
  blast: ["blast", "HEAD"],
  palimpsest: ["palimpsest", "README.md:1"],
  teach: ["teach", "README.md", "--no-llm"],
  genius: ["genius", "noop", "--no-llm"],
  "who-knows": ["who-knows", "noop"],
  story: ["story", "noop", "--no-llm"],
  premortem: ["premortem", "noop"],
  "time-machine": ["time-machine", "README.md"],
  "forensics match": ["forensics", "match", "HEAD", "test@example.com"],
  "forensics attribute": ["forensics", "attribute", "HEAD"],
  feedback: ["feedback", "noop", "up"],
};

/** argv-array form of `cmd` — handles space-containing forensics subcommands. */
export function argvFor(cmd: string): string[] {
  if (SMALLEST_VALID_INVOCATION[cmd]) return SMALLEST_VALID_INVOCATION[cmd]!;
  return cmd.split(/\s+/);
}

/** Did the bin actually build? Tests should bail with a clear message if not. */
export function distExists(): boolean {
  return existsSync(resolve(REPO_ROOT, "packages", "cli", "dist", "index.js"));
}
