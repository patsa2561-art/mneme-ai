/**
 * AI Session Audit — BASELINE module.
 *
 * Snapshots a repo's behavior + types + perf BEFORE an AI session does
 * anything.  We later diff each axis against post-session reality so we
 * can produce a 5-axis trust certificate.
 *
 * Vendor-neutral.  No assumption about which AI is making the changes —
 * we only need a "before" frame and an "after" frame.
 *
 * Pure data extraction.  All process I/O (git, npm, mneme) goes through
 * a `Runner` interface so tests can drive deterministic output.
 *
 * Persisted format — `<repoRoot>/.mneme/audit/baseline.json` — is the
 * single source of truth for `--trace`, `--certify`, and `--report`.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** A single output sample — exit code + stdout digest + line count. */
export interface OutputSample {
  exitCode: number;
  /** SHA-256 hex of the raw stdout bytes. */
  stdoutHash: string;
  /** Number of newline-separated lines in stdout. */
  stdoutLines: number;
}

export interface Baseline {
  /** ISO ts when baseline was captured. */
  capturedAt: string;
  /** git rev-parse HEAD at capture time. */
  headHash: string;
  /** Output samples — key commands' exit code + stdout hash + line count. */
  outputs: Record<string, OutputSample>;
  /** Test pass rate per file (vitest results). */
  testPassRate: { passed: number; failed: number; files: number };
  /** Exported types per package — flattened API surface. */
  apiSurface: Record<string, string[]>;
  /** Perf: median ms for a small set of representative commands. */
  perfMs: Record<string, number>;
}

/** Test seam — every external invocation goes through this. */
export interface Runner {
  /** Run a command, return exit code + stdout. Never throws on non-zero. */
  run(cmd: string, args: string[]): { exitCode: number; stdout: string };
  /**
   * High-resolution wall-clock ms for one invocation.  Returns ms (>=0)
   * even if the command failed, so callers can still compute a median.
   */
  timeMs(cmd: string, args: string[]): number;
  /** Read all `.d.ts` exports inside `dir` (recursive).  Returns map pkg→names. */
  readApiSurface(repoRoot: string): Record<string, string[]>;
}

/** Default real-world Runner — uses `child_process` + filesystem. */
export const realRunner: Runner = {
  run(cmd, args) {
    try {
      const stdout = execFileSync(cmd, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      });
      return { exitCode: 0, stdout };
    } catch (err) {
      const e = err as { status?: number; stdout?: string | Buffer };
      const stdout = e.stdout ? String(e.stdout) : "";
      return { exitCode: typeof e.status === "number" ? e.status : 1, stdout };
    }
  },
  timeMs(cmd, args) {
    const t0 = Date.now();
    try {
      execFileSync(cmd, args, {
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch {
      // Still record the elapsed time even on failure.
    }
    return Date.now() - t0;
  },
  readApiSurface(repoRoot) {
    return collectApiSurface(repoRoot);
  },
};

/**
 * The fixed set of commands we sample for the "behavioral parity" axis.
 *
 * Why these:
 *  - `git rev-parse HEAD` — must always succeed; cheap; sanity check.
 *  - `git log --oneline -20` — recent history fingerprint.
 *  - `node -v` — environment fingerprint.
 *
 * We deliberately do NOT include `mneme status` here because the audit
 * lives in the same package and a bootstrapping cycle would be brittle.
 */
export const SAMPLE_COMMANDS: Array<{ name: string; cmd: string; args: string[] }> = [
  { name: "git_head", cmd: "git", args: ["rev-parse", "HEAD"] },
  { name: "git_log_20", cmd: "git", args: ["log", "--oneline", "-20"] },
  { name: "node_version", cmd: "node", args: ["-v"] },
];

const PERF_COMMANDS: Array<{ name: string; cmd: string; args: string[] }> = [
  { name: "git_status", cmd: "git", args: ["status", "--porcelain"] },
  { name: "git_head", cmd: "git", args: ["rev-parse", "HEAD"] },
];

/** Hash arbitrary bytes — used for stdout digest. */
export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Count newline-separated lines (trailing newline ignored). */
export function lineCount(s: string): number {
  if (!s) return 0;
  const trimmed = s.endsWith("\n") ? s.slice(0, -1) : s;
  if (!trimmed) return 0;
  return trimmed.split("\n").length;
}

/** Median of a non-empty number array.  Returns 0 for empty input. */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[m]!
    : (sorted[m - 1]! + sorted[m]!) / 2;
}

/**
 * Capture a baseline.  Pure(-ish): all side effects flow through `runner`
 * so tests can supply deterministic samples + perf timings.
 */
export async function captureBaseline(
  repoRoot: string,
  runner: Runner = realRunner,
): Promise<Baseline> {
  const capturedAt = new Date().toISOString();

  // ── HEAD hash ──────────────────────────────────────────────────────
  const head = runner.run("git", ["rev-parse", "HEAD"]);
  const headHash = head.stdout.trim();

  // ── Sample outputs ─────────────────────────────────────────────────
  const outputs: Record<string, OutputSample> = {};
  for (const s of SAMPLE_COMMANDS) {
    const r = runner.run(s.cmd, s.args);
    outputs[s.name] = {
      exitCode: r.exitCode,
      stdoutHash: sha256(r.stdout),
      stdoutLines: lineCount(r.stdout),
    };
  }

  // ── Test pass rate ─────────────────────────────────────────────────
  // We use a deterministic shape; real vitest parsing is best-effort.
  // The runner returns vitest-like text; we parse a "Tests: N passed, M failed"
  // marker. If absent we fall back to zeros (safer than guessing).
  let passed = 0;
  let failed = 0;
  let files = 0;
  const tr = runner.run("npm", ["test", "--silent"]);
  const out = tr.stdout;
  // Vitest emits two summary lines:
  //   "Test Files  98 passed"
  //   "Tests       1331 passed"
  // We deliberately match the second line for `passed`/`failed` (the
  // test-total counts), and the first for `files`.
  const passMatch = out.match(/\bTests?\s+(\d+)\s+passed/i);
  const failMatch = out.match(/\bTests?\s+\d+\s+passed[^\n]*?(\d+)\s+failed/i)
    ?? out.match(/(\d+)\s+failed/i);
  const filesMatch = out.match(/Test Files\s+(\d+)/i);
  if (passMatch) passed = Number(passMatch[1]);
  if (failMatch) failed = Number(failMatch[1]);
  if (filesMatch) files = Number(filesMatch[1]);

  // ── API surface ────────────────────────────────────────────────────
  const apiSurface = runner.readApiSurface(repoRoot);

  // ── Perf — median of 3 runs per command ────────────────────────────
  const perfMs: Record<string, number> = {};
  for (const p of PERF_COMMANDS) {
    const samples: number[] = [];
    for (let i = 0; i < 3; i++) samples.push(runner.timeMs(p.cmd, p.args));
    perfMs[p.name] = median(samples);
  }

  return {
    capturedAt,
    headHash,
    outputs,
    testPassRate: { passed, failed, files },
    apiSurface,
    perfMs,
  };
}

/** Where the baseline is persisted. */
export function baselinePath(repoRoot: string): string {
  return join(repoRoot, ".mneme", "audit", "baseline.json");
}

export function persistBaseline(repoRoot: string, b: Baseline): void {
  const dir = join(repoRoot, ".mneme", "audit");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(baselinePath(repoRoot), JSON.stringify(b, null, 2), "utf8");
}

export function loadBaseline(repoRoot: string): Baseline | null {
  const p = baselinePath(repoRoot);
  if (!existsSync(p)) return null;
  try {
    const raw = readFileSync(p, "utf8");
    return JSON.parse(raw) as Baseline;
  } catch {
    return null;
  }
}

// ─── API-surface scanner ────────────────────────────────────────────
//
// We scan every `dist/**/*.d.ts` file (or `src/**/*.ts` if dist absent)
// and grep "export" tokens.  A real TypeScript-compiler walk would be
// more accurate but heavier — and our use case (drift detection)
// tolerates a few false positives.

import { readdirSync, statSync } from "node:fs";

const EXPORT_RE =
  /^\s*export\s+(?:type|interface|class|function|const|let|var|enum|async\s+function)\s+([A-Za-z_$][\w$]*)/gm;
const REEXPORT_RE = /^\s*export\s+\{\s*([^}]+)\s*\}/gm;

export function collectApiSurface(repoRoot: string): Record<string, string[]> {
  const packagesDir = join(repoRoot, "packages");
  if (!existsSync(packagesDir)) return {};
  const out: Record<string, string[]> = {};
  let pkgs: string[] = [];
  try {
    pkgs = readdirSync(packagesDir).filter((n) => {
      const p = join(packagesDir, n);
      try {
        return statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return {};
  }
  for (const pkg of pkgs) {
    const distDir = join(packagesDir, pkg, "dist");
    const srcDir = join(packagesDir, pkg, "src");
    const root = existsSync(distDir) ? distDir : srcDir;
    if (!existsSync(root)) continue;
    const names = new Set<string>();
    for (const file of walkFiles(root)) {
      if (!(file.endsWith(".d.ts") || file.endsWith(".ts"))) continue;
      // Skip test files — they aren't part of the public surface.
      if (file.endsWith(".test.ts") || file.endsWith(".test.d.ts")) continue;
      let text = "";
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      let m: RegExpExecArray | null;
      EXPORT_RE.lastIndex = 0;
      while ((m = EXPORT_RE.exec(text)) !== null) {
        if (m[1]) names.add(m[1]);
      }
      REEXPORT_RE.lastIndex = 0;
      while ((m = REEXPORT_RE.exec(text)) !== null) {
        const inner = m[1] ?? "";
        for (const part of inner.split(",")) {
          const tok = part.trim().split(/\s+as\s+/)[0]?.trim();
          if (tok) names.add(tok);
        }
      }
    }
    out[pkg] = [...names].sort();
  }
  return out;
}

function* walkFiles(root: string): Generator<string> {
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const e of entries) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const full = join(root, e);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) yield* walkFiles(full);
    else yield full;
  }
}
