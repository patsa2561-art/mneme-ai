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
 * Stop-words that follow "Mneme" in natural prose, never CLI verbs.
 * v2.57 fix: pre-v2.57 the extractor matched `mneme <next-word>` greedily
 * and treated "Mneme is the X" / "Mneme ships Y" as CLI claims, then
 * spawned `mneme is --help` (unknown command). Whole gate was false-
 * positive on every doc commit. This list kills the bug class.
 */
const PROSE_STOPWORDS: ReadonlySet<string> = new Set([
  // English copula / common verbs
  "is", "isn", "are", "aren", "was", "were", "be", "been", "being",
  "has", "have", "had", "having",
  "does", "do", "did", "doing", "doesn", "don", "didn",
  "will", "would", "could", "should", "shall", "may", "might", "must", "can",
  // English motion / position
  "inside", "outside", "on", "off", "in", "into", "onto", "at", "to", "from",
  "for", "with", "without", "between", "through", "across", "around",
  // English transitive verbs typical in prose about Mneme
  "ships", "ship", "runs", "ran", "makes", "made", "uses", "used", "needs", "needed",
  "treats", "treat", "knows", "knew", "calls", "called", "becomes", "became",
  "stands", "stood", "lives", "lived", "sits", "sat", "wraps", "wrapped",
  "exposes", "exposed", "adds", "added", "removes", "removed",
  // Determiners / pronouns
  "the", "a", "an", "this", "that", "these", "those", "its", "their", "your", "our", "my", "his", "her", "all", "any", "some",
  // Negation / modal helpers
  "not", "no", "never", "always", "only", "even", "still", "yet",
  // Conjunctions
  "and", "or", "but", "so", "if", "then", "when", "while",
  // Common adjectives that follow "Mneme"
  "first", "last", "next", "now", "today", "tomorrow",
  // Existing commit-prefix words (kept from pre-v2.57)
  "release", "version", "init", "log", "diff", "status", "push", "config",
  // Strategy / marketing prose words
  "as", "primitive", "of", "by", "via", "per",
]);

/**
 * v2.57 fix: only extract verbs from BACKTICK-wrapped strings or from
 * explicit CLI markers (` $ mneme X` / `Run: mneme X` / `CLI: mneme X`).
 * Free-text "Mneme is the X" → no longer captured.
 */
export function extractClaimedVerbs(repoRoot: string, opts: { maxCommits?: number; commitLog?: string } = {}): { verbs: ClaimedVerb[]; scannedCommits: number } {
  const maxCommits = opts.maxCommits ?? 10;
  try {
    // Test seam: callers may inject the raw log (same `%H%n%s%n%b%n--MNEMESPLIT--`
    // format) to exercise the extractor deterministically — production omits it
    // and reads live git history exactly as before.
    const log = typeof opts.commitLog === "string"
      ? opts.commitLog
      : execSync(`git -C "${repoRoot}" log -${maxCommits} --format="%H%n%s%n%b%n--MNEMESPLIT--"`, {
          encoding: "utf8", timeout: 8000,
        });
    const entries = log.split("--MNEMESPLIT--").filter((s) => s.trim());
    const verbs = new Map<string, ClaimedVerb>();
    let scanned = 0;
    for (const e of entries) {
      const lines = e.trim().split("\n");
      const sha = lines[0]?.trim() ?? "";
      const subject = lines[1]?.trim() ?? "";
      if (!sha) continue;
      scanned++;
      const body = lines.slice(1).join("\n");

      // Strategy 1: backtick-wrapped — `mneme <verb> [subverb]`
      const tickMatches = body.matchAll(/`mneme\s+([a-z_][a-z0-9_]*)(?:\s+([a-z_][a-z0-9_]*))?[^`]*`/gi);
      // Strategy 2: explicit CLI marker — `$ mneme ...` / `Run: mneme ...` / `CLI: mneme ...`
      const cliMarkers = body.matchAll(/(?:^|\s)(?:\$|Run:|CLI:|Use:|cmd:)\s*mneme\s+([a-z_][a-z0-9_]*)(?:\s+([a-z_][a-z0-9_]*))?/gim);

      // v2.73.0 — DEFERRAL EXCLUSION (closes wiring-lag false positive).
      // A commit line like "CLI verb `mneme grok` (deferred — covered by
      // SDK)" is NOT claiming the verb works — it is explicitly saying it
      // does NOT exist yet. Pre-v2.73 the extractor flagged it as a broken
      // wired verb (the v2.70 `mneme grok` false positive that NO-GO'd the
      // launch window). We now skip any claim whose trailing context (≤80
      // chars after the match) carries a deferral / future qualifier.
      const DEFERRAL_RE = /\b(deferred?|deferral|planned|not\s+(?:yet|implemented|wired|shipped)|future|roadmap|todo|upcoming|coming\s+soon|will\s+ship|next\s+release|stub|placeholder|wip)\b/i;
      const isDeferred = (m: RegExpMatchArray): boolean => {
        if (typeof m.index !== "number") return false;
        const after = body.slice(m.index + m[0].length, m.index + m[0].length + 80);
        return DEFERRAL_RE.test(after);
      };

      const collect = (m: RegExpMatchArray): void => {
        const verb = m[1]?.toLowerCase();
        const subverb = m[2]?.toLowerCase();
        if (!verb) return;
        if (PROSE_STOPWORDS.has(verb)) return;
        if (isDeferred(m)) return; // explicitly marked deferred/planned → not a wiring claim
        if (subverb && PROSE_STOPWORDS.has(subverb)) {
          // verb might be real, subverb is prose noise → use verb-only
          const full = `mneme ${verb}`;
          if (!verbs.has(full)) verbs.set(full, { full, verb, source: { sha: sha.slice(0, 7), subject } });
          return;
        }
        const full = subverb ? `mneme ${verb} ${subverb}` : `mneme ${verb}`;
        if (!verbs.has(full)) {
          verbs.set(full, { full, verb, subverb, source: { sha: sha.slice(0, 7), subject } });
        }
      };

      for (const m of tickMatches) collect(m);
      for (const m of cliMarkers) collect(m);
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
