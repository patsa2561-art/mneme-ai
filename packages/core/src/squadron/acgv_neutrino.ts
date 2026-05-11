/**
 * v1.51.0 — ACGV LAYER 1: NEUTRINO 3-FLAVOR HARMONIC GROUNDING.
 *
 * Inspired by neutrino flavor oscillation (nu_mu -> nu_e -> nu_tau).
 * Every factual claim is checked through THREE independent flavors:
 *
 *   1. v_surface   -- textual match against repo files + README + docs
 *   2. v_substrate -- file-system / package.json / language-extension match
 *   3. v_spectrum  -- git history (did this entity ever exist in any commit?)
 *
 * The flavors are then combined with the HARMONIC MEAN, not arithmetic:
 *
 *     g_total = 3 / (1/v1 + 1/v2 + 1/v3)        (zero-guarded)
 *
 * Why harmonic: any flavor that returns 0 makes g_total = 0. There is no
 * "average it out" rescue. Most systems average flavors and forgive any
 * single zero -- that's how hallucinations slip through. Harmonic mean
 * makes the discriminator unforgiving.
 *
 * The advocate's existing FACT GROUNDING (v1.50.0) is the v_substrate
 * flavor for a subset of claim kinds. This module adds the other two
 * flavors and the harmonic combine.
 *
 * Output is a GroundingResult per claim, ready for the Chandrasekhar
 * collapse layer.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { countMnemeTools, isLibraryInPackageJson, type FactClaim } from "./fact_grounding.js";

export interface FlavorScore {
  /** 0-1 score for how well this flavor grounds the claim entity. */
  score: number;
  /** Human-readable line explaining the score. */
  evidence: string;
}

export interface GroundingResult {
  /** The underlying claim being grounded. */
  claim: FactClaim;
  /** Per-flavor scores. */
  surface: FlavorScore;
  substrate: FlavorScore;
  spectrum: FlavorScore;
  /** Harmonic mean of the three flavors. Zero if any flavor is zero. */
  harmonic: number;
  /** Which flavors returned zero. */
  zeroFlavors: Array<"surface" | "substrate" | "spectrum">;
}

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".mneme",
  "coverage", "out", ".next", ".turbo", ".cache",
]);

const TEXT_EXTS = new Set([
  ".md", ".mdx", ".txt", ".rst",
  ".json", ".yaml", ".yml", ".toml",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
]);

// ─── v_surface: TEXTUAL MATCH ──────────────────────────────────────────

/** Recursively scan textual files and count exact occurrences of `needle`.
 *  Cap at 2000 visited entries / 4 levels deep so large repos stay snappy. */
function countTextHits(repoRoot: string, needle: string): { hits: number; sampleFile: string | null } {
  if (!needle || needle.length < 2) return { hits: 0, sampleFile: null };
  let hits = 0;
  let sampleFile: string | null = null;
  const lower = needle.toLowerCase();
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
      if (s.isDirectory()) { stack.push({ path: full, depth: depth + 1 }); continue; }
      const dot = name.lastIndexOf(".");
      const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
      if (!TEXT_EXTS.has(ext)) continue;
      if (s.size > 1_000_000) continue; // skip files larger than 1 MB
      try {
        const body = readFileSync(full, "utf8").toLowerCase();
        let from = 0;
        while (true) {
          const idx = body.indexOf(lower, from);
          if (idx < 0) break;
          hits++;
          if (!sampleFile) sampleFile = full.slice(repoRoot.length + 1);
          if (hits > 100) return { hits, sampleFile }; // saturate
          from = idx + lower.length;
        }
      } catch { /* skip */ }
    }
  }
  return { hits, sampleFile };
}

/** Map textual hits to a 0-1 score. 0 hits = 0.0. 1-3 hits = 0.4. 4-10 = 0.7.
 *  10+ = 1.0. Calibrated so a single accidental token doesn't graze the
 *  threshold but a real repo entity (mentioned in README + a few files)
 *  scores high. */
function scoreFromHits(hits: number): number {
  if (hits === 0) return 0;
  if (hits <= 3) return 0.4;
  if (hits <= 10) return 0.7;
  return 1.0;
}

export function neutrinoSurface(repoRoot: string, claim: FactClaim): FlavorScore {
  const needle = claim.asserted;
  // v1.54.0 -- claim kinds where substrate is the CANONICAL ground truth
  // (the binary fact "is X in package.json / is commit X reachable / does
  // file X exist") -- surface scan can MISS the entity in source comments
  // entirely. Return neutral 0.7 so harmonic-mean isn't killed when text
  // scan misses a real dependency / file / commit. The flip-side: when
  // surface DOES find textual mentions, the substrate would also be 1.0
  // so the bump is harmless.
  if (claim.kind === "commit_exists" || claim.kind === "library_used" || claim.kind === "file_exists") {
    return { score: 0.7, evidence: `${claim.kind} -- surface scan deferred to substrate (canonical signal)` };
  }
  // For language claims, surface scan is the *word* not the extension.
  // (substrate handles the extensions.) Skip the word "rust" finding the
  // verb "rust"; require word-boundary intent via prefix space.
  const probe = claim.kind === "language" ? ` ${needle}` : needle;
  const { hits, sampleFile } = countTextHits(repoRoot, probe.trim());
  const score = scoreFromHits(hits);
  const evidence = hits === 0
    ? `zero textual hits for "${needle}" across scanned files`
    : `${hits} textual hit(s) for "${needle}" (sample: ${sampleFile ?? "?"})`;
  return { score, evidence };
}

// ─── v_substrate: FILE-SYSTEM / PACKAGE.JSON / LANGUAGE EXT ─────────────

function readPackageJson(repoRoot: string): Record<string, unknown> | null {
  const p = join(repoRoot, "package.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

function langExtensions(lang: string): string[] {
  switch (lang.toLowerCase()) {
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

function countExtFiles(repoRoot: string, exts: string[]): number {
  let count = 0;
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
      if (s.isDirectory()) { stack.push({ path: full, depth: depth + 1 }); continue; }
      for (const ext of exts) if (name.endsWith(ext)) { count++; break; }
    }
  }
  return count;
}

export function neutrinoSubstrate(repoRoot: string, claim: FactClaim): FlavorScore {
  // Language claim -- count language extension files. >= 5 = strong substrate.
  if (claim.kind === "language") {
    const exts = langExtensions(claim.asserted);
    if (exts.length === 0) {
      return { score: 0, evidence: `unknown language extension for "${claim.asserted}"` };
    }
    const count = countExtFiles(repoRoot, exts);
    if (count >= 5) return { score: 1.0, evidence: `${count} ${claim.asserted} source file(s) on disk` };
    if (count > 0) return { score: 0.3, evidence: `only ${count} ${claim.asserted} file(s) -- not the dominant language` };
    return { score: 0, evidence: `zero ${claim.asserted} files on disk (no ${exts.join("/")} extension)` };
  }
  // Library claim -- check root + workspace package.json manifests. v1.54.0
  // fix: previously only root was scanned and workspace-pinned libraries
  // (commander in packages/cli/package.json, etc) were refuted as missing.
  if (claim.kind === "library_used") {
    if (isLibraryInPackageJson(repoRoot, claim.asserted)) {
      return { score: 1.0, evidence: `${claim.asserted} listed in root or workspace package.json` };
    }
    return { score: 0, evidence: `${claim.asserted} not in any root or workspace package.json` };
  }
  // File claim -- existsSync at a few likely paths.
  if (claim.kind === "file_exists") {
    const candidates = [
      join(repoRoot, claim.asserted),
      join(repoRoot, "packages", "core", "src", claim.asserted),
      join(repoRoot, "packages", "cli", "src", claim.asserted),
      join(repoRoot, "packages", "mcp", "src", claim.asserted),
    ];
    const hit = candidates.find((p) => existsSync(p));
    if (hit) return { score: 1.0, evidence: `file exists at ${hit.slice(repoRoot.length + 1)}` };
    return { score: 0, evidence: `file not found at any candidate path` };
  }
  // Version claim -- check root package.json version.
  if (claim.kind === "version") {
    const pkg = readPackageJson(repoRoot);
    if (!pkg || typeof pkg.version !== "string") {
      return { score: 0.5, evidence: "no package.json version to compare" };
    }
    if (pkg.version === claim.asserted || pkg.version.startsWith(claim.asserted) || claim.asserted.startsWith(pkg.version)) {
      return { score: 1.0, evidence: `package.json version ${pkg.version} matches` };
    }
    return { score: 0, evidence: `package.json says ${pkg.version}, claim says ${claim.asserted}` };
  }
  // Tool count -- count actual `mneme.<...>` tool definitions and compare
  // to asserted N with 15% slack. False-positive bug fix (v1.52.1): pre-fix
  // this returned 0.5 default and let "500 tools" pass as TRUSTWORTHY when
  // actual is 172. Now it grounds properly:
  //   |asserted - actual| <= slack -> 1.0 (within tolerance)
  //   off by 1-2x slack             -> 0.3 (borderline; pushes to LIMBO)
  //   off by > 2x slack             -> 0   (substrate refute; explicit negative)
  if (claim.kind === "tool_count") {
    const asserted = parseInt(claim.asserted, 10);
    if (!Number.isFinite(asserted) || asserted <= 0) {
      return { score: 0.5, evidence: "non-numeric tool count" };
    }
    const actual = countMnemeTools(repoRoot);
    const slack = Math.max(5, asserted * 0.15);
    const diff = Math.abs(asserted - actual);
    if (diff <= slack) {
      return { score: 1.0, evidence: `${actual} MCP tool definitions found (within ${Math.round(slack)} of asserted ${asserted})` };
    }
    if (diff <= slack * 2) {
      return { score: 0.3, evidence: `${actual} actual vs ${asserted} asserted -- borderline (off by ${diff}, slack ${Math.round(slack)})` };
    }
    return { score: 0, evidence: `no support for ${asserted} tools -- actual count is ${actual} (off by ${diff}, slack ${Math.round(slack)})` };
  }
  // Function exists -- delegated to advocate fact-checker for cross-file grep.
  if (claim.kind === "function_exists") {
    return { score: 0.5, evidence: "function existence handled by advocate fact-checker" };
  }
  // Commit exists -- verify via git cat-file. 1.0 if reachable, 0 if not.
  if (claim.kind === "commit_exists") {
    if (!/^[0-9a-f]{7,40}$/i.test(claim.asserted)) {
      return { score: 0, evidence: `not a valid SHA: ${claim.asserted}` };
    }
    try {
      execSync(`git -C "${repoRoot}" cat-file -e ${claim.asserted}`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 3000,
      });
      return { score: 1.0, evidence: `commit ${claim.asserted} reachable via git cat-file` };
    } catch {
      return { score: 0, evidence: `commit ${claim.asserted} not reachable in this repo` };
    }
  }
  return { score: 0.5, evidence: "no substrate check for this claim kind" };
}

// ─── v_spectrum: GIT HISTORY ────────────────────────────────────────────

/** Cheap git-log grep. Returns true if `needle` appeared in any commit
 *  message or any added/removed line touched by any commit. Cap to 200
 *  commits so we don't burn the daemon on a 50k-commit history. */
function appearedInGit(repoRoot: string, needle: string): { hits: number; sample: string | null } {
  if (!needle || needle.length < 2) return { hits: 0, sample: null };
  // Use --grep on log first (cheap), then -S (pickaxe) only if --grep is empty.
  // --grep finds in commit messages; -S finds in diffs.
  try {
    const cmd1 = `git -C "${repoRoot}" log --grep="${needle.replace(/"/g, '\\"')}" -n 5 --pretty=format:%h:%s`;
    const out1 = execSync(cmd1, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim();
    if (out1) {
      const lines = out1.split("\n").filter(Boolean);
      return { hits: lines.length, sample: lines[0] ?? null };
    }
  } catch { /* swallow */ }
  try {
    const cmd2 = `git -C "${repoRoot}" log -S"${needle.replace(/"/g, '\\"')}" -n 5 --pretty=format:%h:%s`;
    const out2 = execSync(cmd2, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim();
    if (out2) {
      const lines = out2.split("\n").filter(Boolean);
      return { hits: lines.length, sample: lines[0] ?? null };
    }
  } catch { /* swallow */ }
  return { hits: 0, sample: null };
}

export function neutrinoSpectrum(repoRoot: string, claim: FactClaim): FlavorScore {
  const needle = claim.asserted;
  // v1.54.0 -- canonical-substrate claim kinds defer spectrum the same
  // way they defer surface: substrate is the binary ground truth, the
  // git history just provides extra signal when available, never refutes.
  if (claim.kind === "commit_exists" || claim.kind === "library_used" || claim.kind === "file_exists") {
    return { score: 0.7, evidence: `${claim.kind} -- spectrum deferred to substrate (canonical signal)` };
  }
  // Hard-skip the noisy generic words that match accidentally in any repo.
  const NOISY = new Set(["js", "ts", "node", "go", "the", "and", "or", "use"]);
  if (NOISY.has(needle.toLowerCase())) {
    return { score: 0.5, evidence: `entity "${needle}" too generic for git spectrum` };
  }
  const { hits, sample } = appearedInGit(repoRoot, needle);
  if (hits === 0) {
    return { score: 0, evidence: `"${needle}" never appeared in any commit message or diff` };
  }
  if (hits === 1) return { score: 0.5, evidence: `${needle} in 1 commit: ${sample}` };
  return { score: 1.0, evidence: `${needle} in ${hits}+ commit(s); sample: ${sample}` };
}

// ─── HARMONIC COMBINE ───────────────────────────────────────────────────

/** Harmonic mean. Returns 0 if any input is 0 (the unforgiving discriminator).
 *  This is the BIG architectural choice -- most systems average flavors
 *  and forgive zeros. Mneme treats any single zero as a refutation signal. */
export function harmonicMean(scores: number[]): number {
  if (scores.length === 0) return 0;
  if (scores.some((s) => s <= 0)) return 0;
  const sumReciprocal = scores.reduce((acc, s) => acc + 1 / s, 0);
  return scores.length / sumReciprocal;
}

/** Combined neutrino grounding for one fact claim. v1.54.0 applies the
 *  negation flip at the very end: a claim that asserts "X is NOT Y" with
 *  reality not-Y has its effective harmonic inverted (1 - raw). The raw
 *  flavor scores are preserved on the result so the explainer can still
 *  surface the underlying signals. */
export function groundClaim(repoRoot: string, claim: FactClaim): GroundingResult {
  const root = resolve(repoRoot);
  const surface = neutrinoSurface(root, claim);
  const substrate = neutrinoSubstrate(root, claim);
  const spectrum = neutrinoSpectrum(root, claim);
  const rawHarmonic = harmonicMean([surface.score, substrate.score, spectrum.score]);
  const harmonic = claim.negated ? 1 - rawHarmonic : rawHarmonic;
  // zeroFlavors describes the raw-grounding signal (which flavors saw nothing).
  // It's used by the Godel layer; we keep this regardless of negation so the
  // proof certificate cites the raw evidence on disk.
  const zeroFlavors: GroundingResult["zeroFlavors"] = [];
  if (surface.score === 0) zeroFlavors.push("surface");
  if (substrate.score === 0) zeroFlavors.push("substrate");
  if (spectrum.score === 0) zeroFlavors.push("spectrum");
  // When a negated claim COMES BACK as supported (raw=0 -> flipped to 1.0),
  // the Godel UNSAT-core would still fire on the raw zeroes. Suppress that
  // by clearing zeroFlavors on a successfully negated claim. Otherwise Godel
  // would refute a TRUE negation -- exactly the bug we're fixing.
  if (claim.negated && rawHarmonic === 0) {
    return { claim, surface, substrate, spectrum, harmonic, zeroFlavors: [] };
  }
  return { claim, surface, substrate, spectrum, harmonic, zeroFlavors };
}

export function groundAllClaims(repoRoot: string, claims: FactClaim[]): GroundingResult[] {
  return claims.map((c) => groundClaim(repoRoot, c));
}
