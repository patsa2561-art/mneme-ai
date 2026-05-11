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

export type FactKind =
  | "language"
  | "tool_count"
  | "library_used"
  | "version"
  | "file_exists"
  | "function_exists";

export interface FactClaim {
  kind: FactKind;
  asserted: string;
  raw: string;
}

export interface FactCheckResult {
  claim: FactClaim;
  verdict: "true" | "false" | "unverifiable";
  groundTruth: string | null;
  evidence: string;
}

// ─── EXTRACTION ─────────────────────────────────────────────────────────

const LANGUAGE_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "rust", re: /\b(written\s+in\s+rust|in\s+rust|rust[-\s]?based)\b/i },
  { name: "go", re: /\b(written\s+in\s+go|in\s+golang?|golang[-\s]?based)\b/i },
  { name: "python", re: /\bwritten\s+in\s+python|python[-\s]?based\b/i },
  { name: "typescript", re: /\bwritten\s+in\s+typescript|typescript[-\s]?based\b/i },
  { name: "javascript", re: /\bwritten\s+in\s+javascript|javascript[-\s]?based\b/i },
  { name: "node.js", re: /\b(written\s+in\s+node\.?js|node\.?js[-\s]?based)\b/i },
  { name: "java", re: /\bwritten\s+in\s+java\b/i },
  { name: "csharp", re: /\bwritten\s+in\s+c#|written\s+in\s+csharp\b/i },
  { name: "ruby", re: /\bwritten\s+in\s+ruby\b/i },
  { name: "elixir", re: /\bwritten\s+in\s+elixir\b/i },
];

const TOOL_COUNT_RE = /\b(?:has|exposes|ships|exports?|provides?|with)\s+(\d+)\s+(?:tools?|commands?|mcp\s+tools?|features?)\b/i;
const LIBRARY_USED_RE = /\b(?:depends?\s+on|uses?|built\s+on|requires?|imports?)\s+(?:the\s+)?([a-z][a-z0-9\-_/@.]{1,40})\s*(?:library|package|module|framework)?\b/i;
const VERSION_RE = /\b(?:version\s+)?v?(\d+\.\d+\.\d+(?:[.-][\w]+)?)\b/g;
const FILE_PATH_RE = /\b([a-zA-Z0-9_./-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|md|json|ya?ml|toml))\b/g;
const FUNCTION_RE = /\b(?:function|fn|method|class)\s+([a-zA-Z_][a-zA-Z0-9_]+)\b/g;

export function extractFactClaims(text: string): FactClaim[] {
  if (!text) return [];
  const out: FactClaim[] = [];

  // Language claims
  for (const lang of LANGUAGE_PATTERNS) {
    const m = text.match(lang.re);
    if (m) out.push({ kind: "language", asserted: lang.name, raw: m[0] });
  }

  // Tool counts -- only the FIRST hit; multiple "N tools" claims in one
  // sentence is rare and we treat them as the same claim.
  const tc = text.match(TOOL_COUNT_RE);
  if (tc) out.push({ kind: "tool_count", asserted: tc[1]!, raw: tc[0] });

  // Library used (best-effort; we only verify against package.json)
  const lib = text.match(LIBRARY_USED_RE);
  if (lib) {
    const candidate = lib[1]!.toLowerCase();
    // Filter out generic words that match the pattern but aren't libs.
    const GENERIC = new Set(["it", "this", "that", "ai", "the", "mneme", "node", "rust", "go", "python", "typescript", "javascript", "java"]);
    if (!GENERIC.has(candidate) && candidate.length >= 2) {
      out.push({ kind: "library_used", asserted: candidate, raw: lib[0] });
    }
  }

  // Versions
  const versionMatches: string[] = [];
  for (const m of text.matchAll(VERSION_RE)) versionMatches.push(m[1]!);
  for (const v of new Set(versionMatches)) {
    out.push({ kind: "version", asserted: v, raw: `v${v}` });
  }

  // File paths
  const fileMatches: string[] = [];
  for (const m of text.matchAll(FILE_PATH_RE)) fileMatches.push(m[1]!);
  for (const f of new Set(fileMatches)) {
    out.push({ kind: "file_exists", asserted: f, raw: f });
  }

  // Function / class names
  const fnMatches: string[] = [];
  for (const m of text.matchAll(FUNCTION_RE)) fnMatches.push(m[1]!);
  for (const f of new Set(fnMatches)) {
    out.push({ kind: "function_exists", asserted: f, raw: `function ${f}` });
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

function countMnemeTools(repoRoot: string): number {
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

function isLibraryInPackageJson(repoRoot: string, lib: string): boolean {
  const pkg = readPackageJson(repoRoot);
  if (!pkg) return false;
  const deps = (pkg.dependencies ?? {}) as Record<string, unknown>;
  const dev = (pkg.devDependencies ?? {}) as Record<string, unknown>;
  return lib in deps || lib in dev || `@${lib}` in deps || `@${lib}` in dev;
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

    out.push({ claim: c, verdict: "unverifiable", groundTruth: null, evidence: "unknown fact kind" });
  }
  return out;
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
