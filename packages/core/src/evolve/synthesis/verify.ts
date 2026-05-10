/**
 * Phase 3 verification gates.
 *
 * Three gates, run in order. ANY failure = patch rejected:
 *
 *   1. Working-tree-clean gate -- the target file must have NO
 *      uncommitted changes. Without this, applying our patch on top
 *      of in-flight user edits would silently rewrite their work.
 *
 *   2. tsc --noEmit gate -- the patched source must still type-check
 *      against the project's tsconfig. Catches the obvious "we broke
 *      the type signature" failure mode.
 *
 *   3. vitest run <related> gate -- targeted test run. Today this
 *      runs the test file that lives next to the patched file (e.g.
 *      checks.ts -> selfcheck.test.ts). Future versions can compute
 *      a fuller "blast radius" via Mneme's blast-radius tool.
 *
 * Implementation:
 *
 *   - We APPLY the patch in-place (overwrite the target file), run
 *     the gates, then either keep the change (if all green) or
 *     restore from the working-tree backup we took first.
 *   - All subprocess calls use spawnSync with explicit timeouts so
 *     a hung tsc/vitest can't wedge the daemon.
 *   - Stderr is captured + truncated for the result; we never throw.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";

import type { TemplateMatch, SynthesisGateResult } from "./types.js";

const TSC_TIMEOUT_MS = 180_000;   // bigger packages can take ~60s; keep headroom
const TEST_TIMEOUT_MS = 240_000;
const GIT_TIMEOUT_MS = 5_000;
const IS_WIN = process.platform === "win32";

/**
 * Verify that `git diff --quiet HEAD -- <filePath>` exits 0 (clean).
 */
function gateWorkingTreeClean(repoRoot: string, filePath: string): { ok: boolean; reason?: string } {
  const r = spawnSync("git", ["diff", "--quiet", "HEAD", "--", filePath], {
    cwd: repoRoot, encoding: "utf8", timeout: GIT_TIMEOUT_MS,
  });
  if (r.status === 0) return { ok: true };
  if (r.status === 1) return { ok: false, reason: "target file has uncommitted changes" };
  return { ok: false, reason: `git diff failed: ${r.stderr?.slice(0, 200) ?? r.error?.message ?? "unknown"}` };
}

/**
 * Locate the package's tsconfig + run `tsc --noEmit -p <tsconfig>`.
 * For files under packages/<pkg>/src/..., we use packages/<pkg>/tsconfig.json.
 */
function gateTsc(repoRoot: string, filePath: string): { ok: boolean; reason?: string } {
  // Find the nearest tsconfig.json walking up from the file.
  let dir = dirname(join(repoRoot, filePath));
  let tsconfig: string | null = null;
  for (let i = 0; i < 6; i++) {
    const cand = join(dir, "tsconfig.json");
    if (existsSync(cand)) { tsconfig = cand; break; }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (!tsconfig) return { ok: false, reason: "no tsconfig.json found" };

  // Use the project's local tsc (node_modules/.bin/tsc). We don't
  // want a global typescript that may differ in version.
  // Windows .cmd files require shell:true in spawnSync; POSIX uses
  // direct exec. Quote the tsconfig path defensively for shell mode.
  const tscBin = IS_WIN
    ? join(repoRoot, "node_modules", ".bin", "tsc.cmd")
    : join(repoRoot, "node_modules", ".bin", "tsc");
  const tscExists = existsSync(tscBin);
  if (!tscExists) return { ok: false, reason: `tsc not found at ${tscBin}` };

  const r = IS_WIN
    ? spawnSync(`"${tscBin}" --noEmit -p "${tsconfig}"`, {
        cwd: repoRoot, encoding: "utf8", timeout: TSC_TIMEOUT_MS, shell: true,
      })
    : spawnSync(tscBin, ["--noEmit", "-p", tsconfig], {
        cwd: repoRoot, encoding: "utf8", timeout: TSC_TIMEOUT_MS, shell: false,
      });
  if (r.status === 0) return { ok: true };
  const detail = ((r.stdout || "") + (r.stderr || "")).slice(0, 600);
  const reason = r.status === null
    ? `tsc spawn failed (timeout=${TSC_TIMEOUT_MS}ms or exec error): ${r.error?.message ?? "no error message"}; stderr: ${detail}`
    : `tsc exit ${r.status}: ${detail}`;
  return { ok: false, reason };
}

/**
 * Run the test file that lives next to the patched file, if one
 * exists. Convention: foo.ts -> foo.test.ts in the same directory.
 *
 * If no co-located test file exists, this gate is SKIPPED (returns
 * ok:true) -- we don't want to require tests for files that genuinely
 * don't have them. The compile gate is the floor.
 */
function gateVitest(repoRoot: string, filePath: string): { ok: boolean; reason?: string; ran?: boolean } {
  const fileDir = dirname(filePath);
  const fileBase = basename(filePath, ".ts");
  const candidate = join(fileDir, `${fileBase}.test.ts`);
  const fullCandidate = join(repoRoot, candidate);
  if (!existsSync(fullCandidate)) return { ok: true, ran: false };

  // Use vitest from node_modules/.bin. Windows .cmd needs shell:true.
  const vitestBin = IS_WIN
    ? join(repoRoot, "node_modules", ".bin", "vitest.cmd")
    : join(repoRoot, "node_modules", ".bin", "vitest");
  if (!existsSync(vitestBin)) return { ok: false, reason: `vitest not found at ${vitestBin}` };

  const r = IS_WIN
    ? spawnSync(`"${vitestBin}" run "${candidate}"`, {
        cwd: repoRoot, encoding: "utf8", timeout: TEST_TIMEOUT_MS, shell: true,
      })
    : spawnSync(vitestBin, ["run", candidate], {
        cwd: repoRoot, encoding: "utf8", timeout: TEST_TIMEOUT_MS, shell: false,
      });
  if (r.status === 0) return { ok: true, ran: true };
  const detail = ((r.stdout || "") + (r.stderr || "")).slice(0, 800);
  const reason = r.status === null
    ? `vitest spawn failed (timeout=${TEST_TIMEOUT_MS}ms or exec error): ${r.error?.message ?? "no error message"}; output: ${detail}`
    : `vitest exit ${r.status}: ${detail}`;
  return { ok: false, reason, ran: true };
}

/**
 * Apply a TemplateMatch to the target file in-place, then run the
 * gates. Restores the original file if any gate fails.
 *
 * Returns:
 *   - gates    : SynthesisGateResult with per-gate verdicts
 *   - patchText: the unified-diff representation of the change
 *                (always present, regardless of gate outcome -- so
 *                callers can persist a "rejected" patch for human
 *                forensics if they want)
 *   - kept     : true iff the change was kept on disk (all gates passed)
 */
export function applyAndVerify(
  repoRoot: string,
  match: TemplateMatch,
): { gates: SynthesisGateResult; patchText: string; kept: boolean } {
  const fullPath = join(repoRoot, match.filePath);
  const errors: string[] = [];

  // Read original (we'll need it for both diff + restore).
  let original: string;
  try { original = readFileSync(fullPath, "utf8"); }
  catch (e) {
    return {
      gates: { workingTreeClean: false, compileOk: null, testsOk: null, errors: [`cannot read ${match.filePath}: ${(e as Error).message}`] },
      patchText: "",
      kept: false,
    };
  }

  // Gate 1: working tree clean for this file.
  const wtc = gateWorkingTreeClean(repoRoot, match.filePath);
  if (!wtc.ok) {
    if (wtc.reason) errors.push(`gate1: ${wtc.reason}`);
    return {
      gates: { workingTreeClean: false, compileOk: null, testsOk: null, errors },
      patchText: "",
      kept: false,
    };
  }

  // Apply the template by string-replace (deterministic; the template
  // guarantees a unique-in-file `before` slice).
  if (!original.includes(match.before)) {
    errors.push("template before-text not found in target (template stale or file already patched)");
    return {
      gates: { workingTreeClean: true, compileOk: null, testsOk: null, errors },
      patchText: "",
      kept: false,
    };
  }
  const patched = original.replace(match.before, match.after);
  if (patched === original) {
    errors.push("template produced no-op replacement");
    return {
      gates: { workingTreeClean: true, compileOk: null, testsOk: null, errors },
      patchText: "",
      kept: false,
    };
  }

  // Build a unified-diff representation for the patch file. We use a
  // simple line-based diff: rebuild the changed block as -/+ lines.
  const patchText = buildUnifiedDiff(match.filePath, original, patched);

  // Write the patched file in-place so tsc + vitest see the new code.
  writeFileSync(fullPath, patched, "utf8");

  let compileOk: boolean | null = null;
  let testsOk: boolean | null = null;
  try {
    const tsc = gateTsc(repoRoot, match.filePath);
    compileOk = tsc.ok;
    if (!tsc.ok && tsc.reason) errors.push(`gate2-tsc: ${tsc.reason}`);

    if (tsc.ok) {
      const vt = gateVitest(repoRoot, match.filePath);
      testsOk = vt.ok;
      if (!vt.ok && vt.reason) errors.push(`gate3-vitest: ${vt.reason}`);
    }
  } finally {
    // Synthesize is dry-run by contract: ALWAYS restore the file, even
    // when all gates pass. The user runs `mneme evolve apply <id>` to
    // actually apply (which uses `git apply` on the saved .patch).
    // This way the working tree stays clean across synthesis runs --
    // no surprise "why is checks.ts modified?" moments.
    try { writeFileSync(fullPath, original, "utf8"); }
    catch (e) { errors.push(`restore failed: ${(e as Error).message}`); }
  }

  // `kept` here means "patch is verified and worth saving as .patch
  // file" -- not "file on disk was kept patched" (we always restore).
  const kept = compileOk === true && (testsOk === true || testsOk === null);
  return {
    gates: { workingTreeClean: true, compileOk, testsOk, errors },
    patchText,
    kept,
  };
}

/**
 * Cheap line-based unified diff. Good enough for `git apply` because
 * we only ever change small contiguous regions (1-3 lines from a
 * template).
 */
function buildUnifiedDiff(filePath: string, oldText: string, newText: string): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Find the first + last differing line indices.
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd--;
    newEnd--;
  }
  const oldHunkLen = oldEnd - start + 1;
  const newHunkLen = newEnd - start + 1;

  // Add 3 lines of context on each side, clamped.
  const ctxBefore = Math.max(0, start - 3);
  const ctxAfterOld = Math.min(oldLines.length - 1, oldEnd + 3);
  const ctxAfterNew = Math.min(newLines.length - 1, newEnd + 3);

  const oldHunkStart = ctxBefore + 1;        // 1-based for diff
  const oldHunkSize = (ctxAfterOld - ctxBefore + 1);
  const newHunkStart = ctxBefore + 1;
  const newHunkSize = (ctxAfterNew - ctxBefore + 1);

  const lines: string[] = [];
  lines.push(`--- a/${filePath}`);
  lines.push(`+++ b/${filePath}`);
  lines.push(`@@ -${oldHunkStart},${oldHunkSize} +${newHunkStart},${newHunkSize} @@`);

  for (let i = ctxBefore; i < start; i++) lines.push(` ${oldLines[i] ?? ""}`);
  for (let i = start; i < start + oldHunkLen; i++) lines.push(`-${oldLines[i] ?? ""}`);
  for (let i = start; i < start + newHunkLen; i++) lines.push(`+${newLines[i] ?? ""}`);
  for (let i = oldEnd + 1; i <= ctxAfterOld; i++) lines.push(` ${oldLines[i] ?? ""}`);

  return lines.join("\n") + "\n";
}
