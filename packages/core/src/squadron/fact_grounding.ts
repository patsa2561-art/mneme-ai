/**
 * v1.50.0 — FACT GROUNDING (the production-critical Squad fix).
 *
 * Tester smoking gun: claim "Mneme has 200 tools and the daemon is
 * written in Rust" → Squadron returned SUPPORTED · 57% confidence · 4
 * for, 0 against. Devil's Advocate said "neutral". Hallucinated commits
 * cited as supporting evidence.
 *
 * Root cause: every Squadron bot reasoned over commit-history patterns
 * (witness counts, recency, risk band) -- NONE of them verified
 * factual claims against ground truth on disk. The judgment layer was
 * theater.
 *
 * THIS MODULE makes the judgment layer real:
 *   1. extractFactClaims(text) -- pulls verifiable claims out of the
 *      claim string (languages, counts, libraries, versions, file paths,
 *      function names).
 *   2. verifyFacts(repoRoot, claims) -- checks each against the actual
 *      filesystem (package.json deps, file existence, source-tree grep).
 *   3. Returns an array of FactCheckResult with verdict
 *      "true" | "false" | "unverifiable".
 *
 * The advocate consumes these. A single FALSE fact triggers a hard
 * "refutes" verdict that overrides any number of pattern-matching
 * "supports" findings. No more "57% confident the daemon is Rust".
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { safeExecTry } from "../util/safe_exec.js";

export type FactKind =
  | "language"
  | "tool_count"
  | "library_used"
  | "version"
  | "file_exists"
  | "function_exists"
  | "commit_exists";

export interface FactClaim {
  kind: FactKind;
  asserted: string;
  raw: string;
  /** v1.54.0 -- when true, the claim asserts the NEGATION (e.g.
   *  "Mneme is NOT written in Rust" or "commander is not installed").
   *  Verification flips: true ground truth -> "false" verdict,
   *  false ground truth -> "true" verdict. Fixes the safety bug where
   *  "X is not installed" was rubber-stamped as TRUSTWORTHY when X
   *  *was* installed. */
  negated?: boolean;
}

export interface FactCheckResult {
  claim: FactClaim;
  verdict: "true" | "false" | "unverifiable";
  groundTruth: string | null;
  evidence: string;
}

// ─── EXTRACTION ─────────────────────────────────────────────────────────

// v1.54.0 -- per-language pattern set. Each entry has BOTH an explicit
// "written in X" / "X-based" pattern AND an implicit "X project /
// X codebase / X repo" pattern so claims like "this is a TypeScript
// project" actually extract a language claim (was PASSTHROUGH pre-v1.54).
const LANGUAGE_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "rust", re: /\b(written\s+in\s+rust|in\s+rust|rust[-\s]?based|rust\s+(?:project|codebase|repo|stack))\b/i },
  { name: "go", re: /\b(written\s+in\s+go|in\s+golang?|golang[-\s]?based|go(?:lang)?\s+(?:project|codebase|repo|stack))\b/i },
  { name: "python", re: /\b(written\s+in\s+python|python[-\s]?based|python\s+(?:project|codebase|repo|stack))\b/i },
  { name: "typescript", re: /\b(written\s+in\s+typescript|typescript[-\s]?based|typescript\s+(?:project|codebase|repo|stack))\b/i },
  { name: "javascript", re: /\b(written\s+in\s+javascript|javascript[-\s]?based|javascript\s+(?:project|codebase|repo|stack))\b/i },
  { name: "node.js", re: /\b(written\s+in\s+node\.?js|node\.?js[-\s]?based|node\.?js\s+(?:project|codebase|repo|stack))\b/i },
  { name: "java", re: /\b(written\s+in\s+java|java\s+(?:project|codebase|repo|stack))\b/i },
  { name: "csharp", re: /\b(written\s+in\s+c#|written\s+in\s+csharp|c#\s+(?:project|codebase|repo))\b/i },
  { name: "ruby", re: /\b(written\s+in\s+ruby|ruby\s+(?:project|codebase|repo))\b/i },
  { name: "elixir", re: /\b(written\s+in\s+elixir|elixir\s+(?:project|codebase|repo))\b/i },
];

const TOOL_COUNT_RE = /\b(?:has|exposes|ships|exports?|provides?|with)\s+(\d+)\s+(?:tools?|commands?|mcp\s+tools?|features?)\b/i;
const LIBRARY_USED_RE = /\b(?:depends?\s+on|uses?|built\s+on|requires?|imports?)\s+(?:the\s+)?([a-z][a-z0-9\-_/@.]{1,40})\s*(?:library|package|module|framework)?\b/i;
const VERSION_RE = /\b(?:version\s+)?v?(\d+\.\d+\.\d+(?:[.-][\w]+)?)\b/g;
const FILE_PATH_RE = /\b([a-zA-Z0-9_./-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|md|json|ya?ml|toml))\b/g;
const FUNCTION_RE = /\b(?:function|fn|method|class)\s+([a-zA-Z_][a-zA-Z0-9_]+)\b/g;
// v1.54.0 -- commit SHA references. Triggers `commit_exists` claim verified
// via `git cat-file`. Matches both "commit abcd123" and bare 7+ hex.
const COMMIT_RE = /\b(?:commit\s+)([0-9a-f]{7,40})\b/gi;

// v1.54.0 -- NEGATION CONTEXT detector. Looks for negation markers in the
// 25 chars *immediately before* the matched fact. Single regex catches:
// "not X", "isn't X", "doesn't X", "no X", "does not X", "is never X",
// "without X", "lacks X", "absent X", + Thai "ไม่" (rare in EN prompts).
// Single source of truth so all claim kinds share the negation logic.
const NEGATION_RE = /\b(?:not|isn'?t|aren'?t|wasn'?t|weren'?t|doesn'?t|don'?t|didn'?t|never|no|without|lacks?|absent|ไม่)\b\s*(?:\w+\s+){0,3}$/i;

function isNegated(fullText: string, matchIndex: number): boolean {
  // Look at the 30-char window ENDING at the match start. If a negation
  // word appears there, the claim is asserting the OPPOSITE.
  if (matchIndex <= 0) return false;
  const windowStart = Math.max(0, matchIndex - 30);
  const window = fullText.slice(windowStart, matchIndex);
  return NEGATION_RE.test(window);
}

export function extractFactClaims(text: string): FactClaim[] {
  if (!text) return [];
  const out: FactClaim[] = [];

  // Language claims (now picks up explicit AND implicit "X project" patterns).
  for (const lang of LANGUAGE_PATTERNS) {
    const m = lang.re.exec(text);
    if (m) {
      out.push({
        kind: "language",
        asserted: lang.name,
        raw: m[0],
        negated: isNegated(text, m.index),
      });
    }
  }

  // Tool counts -- only the FIRST hit; multiple "N tools" claims in one
  // sentence is rare and we treat them as the same claim.
  const tc = TOOL_COUNT_RE.exec(text);
  if (tc) {
    out.push({
      kind: "tool_count",
      asserted: tc[1]!,
      raw: tc[0],
      negated: isNegated(text, tc.index),
    });
  }

  // Library used (best-effort; we only verify against package.json). v1.54.0
  // extends GENERIC to skip conjunctions ("both", "and", "or") that the LIBRARY_RE
  // would otherwise grab as the library name -- the bug surfaced in stress
  // testing where "uses both X and Y" extracted `library_used=both`.
  const lib = LIBRARY_USED_RE.exec(text);
  if (lib) {
    const candidate = lib[1]!.toLowerCase();
    const GENERIC = new Set([
      "it", "this", "that", "ai", "the", "mneme",
      "node", "rust", "go", "python", "typescript", "javascript", "java",
      // v1.54.0 -- conjunctions + connectors that aren't libraries
      "both", "and", "or", "either", "neither", "any", "all", "some",
    ]);
    if (!GENERIC.has(candidate) && candidate.length >= 2) {
      out.push({
        kind: "library_used",
        asserted: candidate,
        raw: lib[0],
        negated: isNegated(text, lib.index),
      });
    }
  }

  // Versions
  const versionMatches: { v: string; idx: number }[] = [];
  for (const m of text.matchAll(VERSION_RE)) versionMatches.push({ v: m[1]!, idx: m.index });
  const seenVersions = new Set<string>();
  for (const vm of versionMatches) {
    if (seenVersions.has(vm.v)) continue;
    seenVersions.add(vm.v);
    out.push({
      kind: "version",
      asserted: vm.v,
      raw: `v${vm.v}`,
      negated: isNegated(text, vm.idx),
    });
  }

  // File paths
  const fileMatches: { f: string; idx: number }[] = [];
  for (const m of text.matchAll(FILE_PATH_RE)) fileMatches.push({ f: m[1]!, idx: m.index });
  const seenFiles = new Set<string>();
  for (const fm of fileMatches) {
    if (seenFiles.has(fm.f)) continue;
    seenFiles.add(fm.f);
    out.push({
      kind: "file_exists",
      asserted: fm.f,
      raw: fm.f,
      negated: isNegated(text, fm.idx),
    });
  }

  // Function / class names
  const fnMatches: { f: string; idx: number }[] = [];
  for (const m of text.matchAll(FUNCTION_RE)) fnMatches.push({ f: m[1]!, idx: m.index });
  const seenFns = new Set<string>();
  for (const fm of fnMatches) {
    if (seenFns.has(fm.f)) continue;
    seenFns.add(fm.f);
    out.push({
      kind: "function_exists",
      asserted: fm.f,
      raw: `function ${fm.f}`,
      negated: isNegated(text, fm.idx),
    });
  }

  // v1.54.0 -- commit SHA claims: "commit abc1234 did X" extracts a
  // commit_exists assertion that's verified via `git cat-file`.
  const commitMatches: { sha: string; idx: number }[] = [];
  for (const m of text.matchAll(COMMIT_RE)) commitMatches.push({ sha: m[1]!.toLowerCase(), idx: m.index });
  const seenShas = new Set<string>();
  for (const cm of commitMatches) {
    if (seenShas.has(cm.sha)) continue;
    seenShas.add(cm.sha);
    out.push({
      kind: "commit_exists",
      asserted: cm.sha,
      raw: `commit ${cm.sha}`,
      negated: isNegated(text, cm.idx),
    });
  }

  return out;
}

// ─── VERIFICATION ───────────────────────────────────────────────────────

function readPackageJson(repoRoot: string): Record<string, unknown> | null {
  const p = join(repoRoot, "package.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

function langExtensions(lang: string): string[] {
  switch (lang) {
    case "rust": return [".rs"];
    case "go": return [".go"];
    case "python": return [".py"];
    case "typescript": return [".ts", ".tsx"];
    case "javascript": return [".js", ".jsx", ".mjs", ".cjs"];
    case "node.js": return [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
    case "java": return [".java"];
    case "csharp": return [".cs"];
    case "ruby": return [".rb"];
    case "elixir": return [".ex", ".exs"];
    default: return [];
  }
}

function countLanguageFiles(repoRoot: string, exts: string[]): { count: number; sampleFile: string | null } {
  // Walk up to 2000 files / 4 levels deep so we don't churn on huge repos.
  let count = 0;
  let sampleFile: string | null = null;
  const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".mneme", "coverage", "out"]);
  const stack: { path: string; depth: number }[] = [{ path: repoRoot, depth: 0 }];
  let visited = 0;
  while (stack.length > 0 && visited < 2000) {
    const { path, depth } = stack.pop()!;
    if (depth > 4) continue;
    let entries: string[];
    try { entries = readdirSync(path); } catch { continue; }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(path, name);
      visited++;
      let s; try { s = statSync(full); } catch { continue; }
      if (s.isDirectory()) {
        stack.push({ path: full, depth: depth + 1 });
      } else {
        for (const ext of exts) {
          if (name.endsWith(ext)) {
            count++;
            if (!sampleFile) sampleFile = full.slice(repoRoot.length + 1);
            break;
          }
        }
      }
    }
  }
  return { count, sampleFile };
}

export function countMnemeTools(repoRoot: string): number {
  // Heuristic: count occurrences of `name: "mneme.` in MCP tool definitions.
  const stack: string[] = [join(repoRoot, "packages")];
  if (!existsSync(stack[0]!)) return 0;
  const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".mneme"]);
  let total = 0;
  let visited = 0;
  while (stack.length > 0 && visited < 5000) {
    const path = stack.pop()!;
    let entries: string[];
    try { entries = readdirSync(path); } catch { continue; }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(path, name);
      visited++;
      let s; try { s = statSync(full); } catch { continue; }
      if (s.isDirectory()) { stack.push(full); continue; }
      if (!name.endsWith(".ts") || name.endsWith(".test.ts") || name.endsWith(".d.ts")) continue;
      try {
        const body = readFileSync(full, "utf8");
        const matches = body.match(/name:\s*["'`]mneme\.[a-zA-Z0-9._-]+["'`]/g);
        if (matches) total += matches.length;
      } catch { /* skip */ }
    }
  }
  return total;
}

// v2.19.44 N3-overshoot guard helper — return a Set of every
// `mneme.X.Y`-shaped tool name declared in the local source tree.
// Used by acgv vaccine match to verify that a "previously refuted"
// tool is STILL refuted by the live catalog before short-circuiting
// AUTO_REFUTE. Sync + cheap (~30ms) because vaccine path is rare.
let _liveToolNamesCache: { repoRoot: string; names: Set<string>; ts: number } | null = null;
const LIVE_NAMES_TTL_MS = 30_000;

export function liveMnemeToolNames(repoRoot: string): Set<string> {
  const now = Date.now();
  if (_liveToolNamesCache && _liveToolNamesCache.repoRoot === repoRoot && (now - _liveToolNamesCache.ts) < LIVE_NAMES_TTL_MS) {
    return _liveToolNamesCache.names;
  }
  const out = new Set<string>();
  const stack: string[] = [join(repoRoot, "packages")];
  if (!existsSync(stack[0]!)) return out;
  const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".mneme"]);
  let visited = 0;
  while (stack.length > 0 && visited < 5000) {
    const path = stack.pop()!;
    let entries: string[];
    try { entries = readdirSync(path); } catch { continue; }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(path, name);
      visited++;
      let s; try { s = statSync(full); } catch { continue; }
      if (s.isDirectory()) { stack.push(full); continue; }
      if (!name.endsWith(".ts") || name.endsWith(".test.ts") || name.endsWith(".d.ts")) continue;
      try {
        const body = readFileSync(full, "utf8");
        const matches = body.matchAll(/name:\s*["'`](mneme\.[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)["'`]/g);
        for (const m of matches) out.add(m[1]!);
      } catch { /* skip */ }
    }
  }
  _liveToolNamesCache = { repoRoot, names: out, ts: now };
  return out;
}

/** For tests: clear the memoised live-names cache. */
export function _resetLiveToolNamesCache(): void { _liveToolNamesCache = null; }

export function isLibraryInPackageJson(repoRoot: string, lib: string): boolean {
  // Check root + every workspace package.json. v1.54.0 fix: previously
  // only the root manifest was scanned, so claims like "depends on
  // commander" were refuted as missing even when commander lives in
  // a workspace's package.json (real-world surface bug from field test).
  const candidates: string[] = [join(repoRoot, "package.json")];
  const workspacesRoot = join(repoRoot, "packages");
  if (existsSync(workspacesRoot)) {
    try {
      for (const name of readdirSync(workspacesRoot)) {
        const p = join(workspacesRoot, name, "package.json");
        if (existsSync(p)) candidates.push(p);
      }
    } catch { /* */ }
  }
  for (const path of candidates) {
    let pkg: Record<string, unknown> | null;
    try { pkg = JSON.parse(readFileSync(path, "utf8")); } catch { continue; }
    if (!pkg) continue;
    const deps = (pkg.dependencies ?? {}) as Record<string, unknown>;
    const dev = (pkg.devDependencies ?? {}) as Record<string, unknown>;
    if (lib in deps || lib in dev || `@${lib}` in deps || `@${lib}` in dev) return true;
  }
  return false;
}

// v1.54.0 -- verify a commit SHA is reachable from the current repo via
// `git cat-file`. Falls back to false when git isn't on PATH (rare in CI).
function commitExists(repoRoot: string, sha: string): boolean {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return false;
  try {
    // v2.4: SHA is regex-validated AND passed as a distinct argv element; no shell.
    const r = safeExecTry("git", ["-C", repoRoot, "cat-file", "-e", sha], { timeoutMs: 3000 });
    return r?.status === 0;
  } catch {
    return false;
  }
}

function repoVersion(repoRoot: string): string | null {
  const pkg = readPackageJson(repoRoot);
  if (!pkg || typeof pkg.version !== "string") return null;
  return pkg.version;
}

function functionExistsInRepo(repoRoot: string, name: string): { found: boolean; sampleFile: string | null } {
  // Simple grep across TS/JS sources. Limits identical to countMnemeTools.
  const stack: string[] = [join(repoRoot, "packages")];
  if (!existsSync(stack[0]!)) return { found: false, sampleFile: null };
  const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".mneme"]);
  const patterns = [
    new RegExp(`\\bfunction\\s+${name}\\b`),
    new RegExp(`\\bclass\\s+${name}\\b`),
    new RegExp(`\\bconst\\s+${name}\\s*=`),
    new RegExp(`\\bexport\\s+(?:async\\s+)?function\\s+${name}\\b`),
  ];
  let visited = 0;
  while (stack.length > 0 && visited < 5000) {
    const path = stack.pop()!;
    let entries: string[];
    try { entries = readdirSync(path); } catch { continue; }
    for (const n of entries) {
      if (SKIP_DIRS.has(n)) continue;
      const full = join(path, n);
      visited++;
      let s; try { s = statSync(full); } catch { continue; }
      if (s.isDirectory()) { stack.push(full); continue; }
      if (!n.endsWith(".ts") && !n.endsWith(".js")) continue;
      if (n.endsWith(".d.ts")) continue;
      try {
        const body = readFileSync(full, "utf8");
        for (const p of patterns) {
          if (p.test(body)) return { found: true, sampleFile: full.slice(repoRoot.length + 1) };
        }
      } catch { /* */ }
    }
  }
  return { found: false, sampleFile: null };
}

export function verifyFacts(repoRoot: string, claims: FactClaim[]): FactCheckResult[] {
  const root = resolve(repoRoot);
  const out: FactCheckResult[] = [];

  for (const c of claims) {
    if (c.kind === "language") {
      const exts = langExtensions(c.asserted);
      if (exts.length === 0) {
        out.push({ claim: c, verdict: "unverifiable", groundTruth: null, evidence: `unknown language: ${c.asserted}` });
        continue;
      }
      const { count, sampleFile } = countLanguageFiles(root, exts);
      // Threshold: a real "written in X" claim should mean MANY X files,
      // not just one. Require ≥ 5 source files of that extension OR be the
      // dominant extension. Conservative: >=5 to call it "true".
      if (count >= 5) {
        out.push({ claim: c, verdict: "true", groundTruth: `${count} ${c.asserted} source files`, evidence: `sample: ${sampleFile ?? "?"}` });
      } else if (count === 0) {
        out.push({ claim: c, verdict: "false", groundTruth: `zero ${c.asserted} source files in repo`, evidence: `walked ${root}/packages and found no ${exts.join("/")} files` });
      } else {
        out.push({ claim: c, verdict: "false", groundTruth: `only ${count} ${c.asserted} file(s) -- not a "${c.asserted}-based" project`, evidence: `sample: ${sampleFile ?? "?"}` });
      }
      continue;
    }

    if (c.kind === "tool_count") {
      const asserted = parseInt(c.asserted, 10);
      const actual = countMnemeTools(root);
      // 15% slack so "about 200" or "around 170" passes when actual is 172.
      const slack = Math.max(5, asserted * 0.15);
      if (Math.abs(asserted - actual) <= slack) {
        out.push({ claim: c, verdict: "true", groundTruth: String(actual), evidence: `${actual} MCP tool definitions found (within ${Math.round(slack)} of asserted ${asserted})` });
      } else {
        out.push({ claim: c, verdict: "false", groundTruth: String(actual), evidence: `asserted ${asserted}, actual ${actual} (off by ${Math.abs(asserted - actual)})` });
      }
      continue;
    }

    if (c.kind === "library_used") {
      const present = isLibraryInPackageJson(root, c.asserted);
      if (present) {
        out.push({ claim: c, verdict: "true", groundTruth: `${c.asserted} in package.json`, evidence: "matched dependencies or devDependencies" });
      } else {
        out.push({ claim: c, verdict: "false", groundTruth: `${c.asserted} NOT in package.json`, evidence: "scanned dependencies + devDependencies" });
      }
      continue;
    }

    if (c.kind === "version") {
      const repoV = repoVersion(root);
      if (!repoV) {
        out.push({ claim: c, verdict: "unverifiable", groundTruth: null, evidence: "no package.json version" });
        continue;
      }
      // Match major.minor.patch loose
      if (repoV.startsWith(c.asserted) || c.asserted.startsWith(repoV)) {
        out.push({ claim: c, verdict: "true", groundTruth: repoV, evidence: "package.json" });
      } else {
        out.push({ claim: c, verdict: "false", groundTruth: repoV, evidence: `package.json says ${repoV}, claim says ${c.asserted}` });
      }
      continue;
    }

    if (c.kind === "file_exists") {
      const candidates = [
        join(root, c.asserted),
        join(root, "packages", "core", "src", c.asserted),
        join(root, "packages", "cli", "src", c.asserted),
        join(root, "packages", "mcp", "src", c.asserted),
      ];
      const hit = candidates.find((p) => existsSync(p));
      if (hit) {
        out.push({ claim: c, verdict: "true", groundTruth: hit.slice(root.length + 1), evidence: "fs.existsSync" });
      } else {
        out.push({ claim: c, verdict: "false", groundTruth: "(not found)", evidence: `checked ${candidates.length} candidate paths` });
      }
      continue;
    }

    if (c.kind === "function_exists") {
      const r = functionExistsInRepo(root, c.asserted);
      if (r.found) {
        out.push({ claim: c, verdict: "true", groundTruth: r.sampleFile ?? "(somewhere)", evidence: "grep across packages/**/*.ts" });
      } else {
        out.push({ claim: c, verdict: "false", groundTruth: "(not found)", evidence: "no function/class/const definition matched" });
      }
      continue;
    }

    if (c.kind === "commit_exists") {
      const present = commitExists(root, c.asserted);
      if (present) {
        out.push({ claim: c, verdict: "true", groundTruth: c.asserted, evidence: "git cat-file -e succeeded" });
      } else {
        out.push({ claim: c, verdict: "false", groundTruth: "(not in repo)", evidence: "git cat-file -e failed -- commit SHA not reachable" });
      }
      continue;
    }

    out.push({ claim: c, verdict: "unverifiable", groundTruth: null, evidence: "unknown fact kind" });
  }
  // v1.54.0 -- NEGATION FLIP. Verification computed "is the entity there?"
  // but the claim asserted the OPPOSITE if `negated`. Flip the verdict so
  // a true-grounded entity makes a negated claim FALSE (and vice versa).
  // Single source of truth for negation across every fact kind.
  return out.map((r) => {
    if (!r.claim.negated) return r;
    if (r.verdict === "true") {
      return { ...r, verdict: "false" as const, evidence: `NEGATION FLIP: ${r.evidence} (claim denied this; reality contradicts)` };
    }
    if (r.verdict === "false") {
      return { ...r, verdict: "true" as const, evidence: `NEGATION FLIP: ${r.evidence} (claim denied this; reality confirms)` };
    }
    return r; // unverifiable stays as-is
  });
}

/** Convenience: extract + verify in one call. */
export function checkClaim(repoRoot: string, text: string): FactCheckResult[] {
  return verifyFacts(repoRoot, extractFactClaims(text));
}

/** Did the claim contain at least one verifiable falsehood?
 *  Used by the advocate to hard-veto a verdict. */
export function hasFalseFact(results: FactCheckResult[]): boolean {
  return results.some((r) => r.verdict === "false");
}
