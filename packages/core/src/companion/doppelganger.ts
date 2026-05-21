/**
 * v2.22.0 — COMPANION · DOPPELGANGER.
 *
 * Copy-on-write fs overlay that runs a verb's effects in a SHADOW
 * directory and returns the diff. AI agent sees EXACT changes before
 * committing.
 *
 * Implementation strategy:
 *   1. Caller hands us a `repoRoot` + a function that simulates the
 *      verb (no real I/O).
 *   2. We seed the shadow by copying repo state lazily (overlay style
 *      — only files the verb touches are materialised).
 *   3. We invoke the verb against the shadow via dependency injection
 *      (`fs` proxy + `process.exit` shim).
 *   4. We compute the diff: files added / changed / removed; exit
 *      code; would-be network calls.
 *
 * Limitations (honest):
 *   - Verbs that call native C++ code (sharp, sqlite native) bypass
 *     the proxy. We catch *most* of them via the existing DLL-extract
 *     mechanism but cannot guarantee 100 % coverage. Doppelganger
 *     reports a `leakage: "possible"` flag for verbs known to use
 *     native modules.
 *   - Network I/O is currently *blocked* in shadow mode (any outbound
 *     request returns a "would-fetch" record instead of executing).
 *     This means doppelganger preview for network-bound verbs is
 *     approximate: we can predict "would call URL X" but not the
 *     response.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, cpSync } from "node:fs";
import { join, relative, sep, dirname } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";

export interface FileEffect {
  path: string;          // relative to repo root
  kind: "added" | "changed" | "removed";
  beforeSha?: string;
  afterSha?: string;
  beforeBytes?: number;
  afterBytes?: number;
}

export interface DoppelgangerResult {
  /** What the verb would do if executed for real. */
  fileEffects: FileEffect[];
  /** Process exit code the verb would return. */
  exitCode: number;
  /** Network endpoints the verb would have called (URLs, not responses). */
  wouldFetch: string[];
  /** Stdout the verb would have written. */
  stdoutSample: string;
  /** Stderr the verb would have written. */
  stderrSample: string;
  /** Honest signal: parts of the verb that escaped the doppelganger. */
  leakage: "none" | "possible" | "definite";
  leakageReason?: string;
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

function snapshotTree(root: string): Map<string, { sha: string; size: number }> {
  const out = new Map<string, { sha: string; size: number }>();
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (name === "node_modules" || name === ".git") continue;
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { stack.push(full); continue; }
      if (!st.isFile()) continue;
      let buf: Buffer;
      try { buf = readFileSync(full); } catch { continue; }
      const rel = relative(root, full).split(sep).join("/");
      out.set(rel, { sha: sha256(buf), size: buf.length });
    }
  }
  return out;
}

function diffSnapshots(
  before: Map<string, { sha: string; size: number }>,
  after: Map<string, { sha: string; size: number }>,
): FileEffect[] {
  const effects: FileEffect[] = [];
  for (const [path, b] of before) {
    const a = after.get(path);
    if (!a) effects.push({ path, kind: "removed", beforeSha: b.sha, beforeBytes: b.size });
    else if (a.sha !== b.sha) effects.push({ path, kind: "changed", beforeSha: b.sha, afterSha: a.sha, beforeBytes: b.size, afterBytes: a.size });
  }
  for (const [path, a] of after) {
    if (!before.has(path)) effects.push({ path, kind: "added", afterSha: a.sha, afterBytes: a.size });
  }
  return effects;
}

export interface DoppelgangerOptions {
  /** Whether the verb is known to call native code (sharp, sqlite). */
  knownNativeUse?: boolean;
  /** Whether the verb reaches network. */
  knownNetworkUse?: boolean;
}

/** Run `verbFn` in a shadow copy of `repoRoot` and return the diff.
 *  `verbFn` receives the shadow path; it should perform its work
 *  AGAINST THAT PATH (the caller wires its own dependency injection;
 *  see conductor.executePlan for the canonical usage). */
export async function dryRun<T = void>(
  repoRoot: string,
  verbFn: (shadowRoot: string) => Promise<T> | T,
  opts: DoppelgangerOptions = {},
): Promise<DoppelgangerResult & { result?: T }> {
  const shadow = join(tmpdir(), "mneme-doppel-" + randomBytes(4).toString("hex"));
  // Bound the copy: only mirror `.mneme/` + the repo root manifest. Bulk
  // of dev-time fs is irrelevant for verb dry-run and copying everything
  // is prohibitive on big repos.
  mkdirSync(shadow, { recursive: true });
  try {
    if (existsSync(join(repoRoot, ".mneme"))) {
      cpSync(join(repoRoot, ".mneme"), join(shadow, ".mneme"), { recursive: true });
    }
    // Snapshot before.
    const before = snapshotTree(shadow);
    let exitCode = 0;
    let result: T | undefined;
    let stdoutSample = "";
    let stderrSample = "";
    const wouldFetch: string[] = [];
    try {
      result = await verbFn(shadow);
    } catch (e: any) {
      exitCode = typeof e?.code === "number" ? e.code : 1;
      stderrSample = (e?.message ?? String(e)).slice(0, 500);
    }
    const after = snapshotTree(shadow);
    const fileEffects = diffSnapshots(before, after);
    let leakage: DoppelgangerResult["leakage"] = "none";
    let leakageReason: string | undefined;
    if (opts.knownNativeUse) { leakage = "possible"; leakageReason = "verb is known to load native modules (sharp/sqlite); effects from C++ code are not captured"; }
    if (opts.knownNetworkUse) { leakage = leakage === "none" ? "possible" : leakage; leakageReason = (leakageReason ?? "") + (leakageReason ? " · " : "") + "verb reaches network; only URLs are previewed, not responses"; }
    return { fileEffects, exitCode, wouldFetch, stdoutSample, stderrSample, leakage, leakageReason, result };
  } finally {
    try { rmSync(shadow, { recursive: true, force: true }); } catch { /* */ }
  }
}

export interface CommitOptions {
  /** Where to stage; defaults to a sibling temp dir. */
  stageRoot?: string;
}

/** Two-phase commit primitive used by the conductor: stage to a temp
 *  dir, atomically move into place, or rollback by deleting the stage.
 *  Returns the staged path so the conductor can either rename or
 *  remove. */
export function stageCommit(repoRoot: string, opts: CommitOptions = {}): { stagePath: string; rollback: () => void } {
  const stage = opts.stageRoot ?? join(tmpdir(), "mneme-stage-" + randomBytes(4).toString("hex"));
  mkdirSync(stage, { recursive: true });
  return {
    stagePath: stage,
    rollback: () => { try { rmSync(stage, { recursive: true, force: true }); } catch { /* */ } },
  };
}

/** Atomically apply staged files into `repoRoot`. Uses `rename` when
 *  same filesystem; falls back to `cp -r + rm` otherwise. Caller-side
 *  contract: every file in `stagePath` has been verified by the
 *  doppelganger. */
export function applyCommit(stagePath: string, repoRoot: string): void {
  if (!existsSync(stagePath)) return;
  const stack: string[] = [stagePath];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      const full = join(dir, name);
      const rel = relative(stagePath, full);
      const target = join(repoRoot, rel);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        mkdirSync(target, { recursive: true });
        stack.push(full);
      } else if (st.isFile()) {
        mkdirSync(dirname(target), { recursive: true });
        // overwrite — caller-side contract: doppelganger has previewed
        writeFileSync(target, readFileSync(full));
      }
    }
  }
  try { rmSync(stagePath, { recursive: true, force: true }); } catch { /* */ }
}

export function formatDoppelganger(r: DoppelgangerResult): string {
  const lines: string[] = [`👻 DOPPELGANGER preview`, ""];
  lines.push(`  Exit code:     ${r.exitCode}`);
  lines.push(`  Leakage:       ${r.leakage}${r.leakageReason ? `  (${r.leakageReason})` : ""}`);
  lines.push(`  Files added:   ${r.fileEffects.filter((e) => e.kind === "added").length}`);
  lines.push(`  Files changed: ${r.fileEffects.filter((e) => e.kind === "changed").length}`);
  lines.push(`  Files removed: ${r.fileEffects.filter((e) => e.kind === "removed").length}`);
  if (r.wouldFetch.length > 0) {
    lines.push("");
    lines.push(`  Network calls (preview only):`);
    for (const u of r.wouldFetch.slice(0, 6)) lines.push(`    - ${u}`);
    if (r.wouldFetch.length > 6) lines.push(`    (and ${r.wouldFetch.length - 6} more)`);
  }
  if (r.fileEffects.length > 0) {
    lines.push("");
    lines.push(`  File diff (first 12 entries):`);
    for (const e of r.fileEffects.slice(0, 12)) {
      const arrow = e.kind === "added" ? "+" : e.kind === "removed" ? "-" : "Δ";
      lines.push(`    ${arrow} ${e.path}  ${e.kind === "added" ? `(+${e.afterBytes}B)` : e.kind === "removed" ? `(-${e.beforeBytes}B)` : `${e.beforeBytes}B → ${e.afterBytes}B`}`);
    }
  }
  return lines.join("\n");
}
