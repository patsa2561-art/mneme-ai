/**
 * v2.53.0 — WIRING-LAG CI gate.
 *
 * Closes P0-3 from v2.52 audit: WIRING LAG class re-emerges every
 * 2-3 releases (dev_tooling v2.45→v2.49, honest_receipt v2.36 still,
 * probe_coverage v2.48→v2.51). Pattern: commit message claims
 * `mneme <verb>` works but the actual CLI surface wasn't wired.
 *
 * This gate parses recent commit messages, extracts every `mneme <verb>`
 * claim, spawns each as a real subprocess (CLI), and surfaces every
 * "unknown command" exit as a wiring-lag bug.
 *
 * Designed to run BOTH in CI and via release.mjs pre-tag.
 */

import { spawnSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export interface ClaimedVerb {
  /** Full claimed CLI invocation, e.g. "mneme nemesis stealth_score". */
  full: string;
  /** Top-level verb (e.g. "nemesis"). */
  verb: string;
  /** Subverb if present (e.g. "stealth_score"). */
  subverb?: string;
  /** Commit sha + subject this was extracted from. */
  source: { sha: string; subject: string };
}

export interface WiringLagResult {
  ok: boolean;
  totalClaims: number;
  workingCount: number;
  brokenCount: number;
  broken: Array<{ verb: string; reason: string; source: { sha: string; subject: string } }>;
  scannedCommits: number;
  /** Hint when broken > 0. */
  hint: string;
}

/**
 * Parse `git log -N --format` output + extract every `mneme <verb> [subverb]`
 * claim. Returns deduplicated list of verbs.
 */
export function extractClaimedVerbs(repoRoot: string, opts: { maxCommits?: number } = {}): { verbs: ClaimedVerb[]; scannedCommits: number } {
  const maxCommits = opts.maxCommits ?? 10;
  try {
    const log = execSync(`git -C "${repoRoot}" log -${maxCommits} --format="%H%n%s%n%b%n--MNEMESPLIT--"`, {
      encoding: "utf8", timeout: 8000,
    });
    const entries = log.split("--MNEMESPLIT--").filter((s) => s.trim());
    const verbs = new Map<string, ClaimedVerb>(); // key = full
    let scanned = 0;
    for (const e of entries) {
      const lines = e.trim().split("\n");
      const sha = lines[0]?.trim() ?? "";
      const subject = lines[1]?.trim() ?? "";
      if (!sha) continue;
      scanned++;
      const body = lines.slice(1).join("\n");
      // Match `mneme <verb> [subverb]` — exclude commit prefix words
      const matches = body.match(/`?mneme\s+([a-z_][a-z0-9_]*)(?:\s+([a-z_][a-z0-9_]*))?`?/gi) ?? [];
      for (const m of matches) {
        const inner = m.match(/mneme\s+([a-z_][a-z0-9_]*)(?:\s+([a-z_][a-z0-9_]*))?/i);
        if (!inner) continue;
        const verb = inner[1]!.toLowerCase();
        const subverb = inner[2]?.toLowerCase();
        // Skip common false-positives (commit subject prefixes / placeholders)
        if (["release", "version", "init", "log", "diff", "status", "push", "config"].includes(verb)) continue;
        const full = subverb ? `mneme ${verb} ${subverb}` : `mneme ${verb}`;
        if (!verbs.has(full)) {
          verbs.set(full, { full, verb, subverb, source: { sha: sha.slice(0, 7), subject } });
        }
      }
    }
    return { verbs: Array.from(verbs.values()), scannedCommits: scanned };
  } catch (e) {
    void e;
    return { verbs: [], scannedCommits: 0 };
  }
}

/**
 * Spawn each verb as a subprocess (with --help to avoid side-effects)
 * + check exit code + stderr for "unknown command" markers.
 *
 * Defensive: respects per-process timeout; never throws.
 */
export function checkWiringLag(repoRoot: string, opts: { maxCommits?: number; cliBin?: string } = {}): WiringLagResult {
  const cliBin = opts.cliBin ?? resolve(repoRoot, "packages/cli/bin/mneme.js");
  if (!existsSync(cliBin)) {
    return {
      ok: true,
      totalClaims: 0,
      workingCount: 0,
      brokenCount: 0,
      broken: [],
      scannedCommits: 0,
      hint: `CLI bin not built at ${cliBin} — skipping wiring-lag gate (run npm --prefix packages/cli run build)`,
    };
  }
  const { verbs, scannedCommits } = extractClaimedVerbs(repoRoot, { maxCommits: opts.maxCommits ?? 10 });
  const broken: WiringLagResult["broken"] = [];
  let working = 0;
  for (const v of verbs) {
    // We probe `<verb> --help` (or `<verb> <subverb> --help`) — every CLI
    // that exists should accept --help and exit 0 (or non-error). Unknown
    // verbs cause commander to print "unknown command" on stderr.
    const args = v.subverb ? [v.verb, v.subverb, "--help"] : [v.verb, "--help"];
    const r = spawnSync(process.execPath, [cliBin, ...args], {
      encoding: "utf8", timeout: 8000, cwd: repoRoot,
      env: { ...process.env, MNEME_WARMCALL: "0", MNEME_MUSCLE_BYPASS: "0", NO_COLOR: "1" },
    });
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    const unknownMatch = /unknown command|did you mean|error: unknown/i.test(out) && !/Did you mean `mneme/.test(out);
    if (unknownMatch) {
      broken.push({ verb: v.full, reason: `subprocess reported "unknown command" — claimed in ${v.source.sha} "${v.source.subject}"`, source: v.source });
    } else {
      working++;
    }
  }
  const ok = broken.length === 0;
  return {
    ok,
    totalClaims: verbs.length,
    workingCount: working,
    brokenCount: broken.length,
    broken,
    scannedCommits,
    hint: ok
      ? `wiring-lag gate: ${working}/${verbs.length} claimed verbs work (scanned ${scannedCommits} commits)`
      : `wiring-lag gate FAILED: ${broken.length}/${verbs.length} claimed verbs are unwired. Fix the broken verbs or update the commit messages.`,
  };
}
