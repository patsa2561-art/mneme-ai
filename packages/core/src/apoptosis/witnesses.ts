/**
 * v1.65.0 -- APOPTOSIS L1: 5-WITNESS FUSION.
 *
 * Forensic-grade grounding. Every AI claim is broken into 5
 * independent oracles that each verify a separate facet of reality.
 * Break ANY one → the witness fails and APOPTOSIS escalates.
 *
 *   W1 path-exists       claim names a file -> does it exist on disk?
 *   W2 symbol-exists     claim names a symbol -> does it appear in source?
 *   W3 type-shape-matches  claim names a return/arg type -> matches tsc?
 *   W4 git-history-consistent  claim names a version/SHA -> tag walk agrees?
 *   W5 behavior-cited    claim names behavior -> at least one test mentions it?
 *
 * This is the floor. Layers 2-7 add semantic, temporal, statistical,
 * fractal, and cascade-level checks.
 *
 * Pure read. No side effects. Returns per-witness verdict + overall.
 */

import { existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { safeExecTry } from "../util/safe_exec.js";

export type WitnessId = "W1-path" | "W2-symbol" | "W3-type" | "W4-history" | "W5-behavior";

export type WitnessVerdict = "GROUNDED" | "ALERT" | "INAPPLICABLE";

export interface WitnessReport {
  id: WitnessId;
  verdict: WitnessVerdict;
  /** Plain-English why. */
  detail: string;
  /** Optional evidence the witness consulted. */
  evidence?: string[];
  /** Time spent in this witness, ms. */
  ms: number;
}

export interface ClaimFacets {
  /** Raw claim text. */
  text: string;
  /** Files the claim names (relative or absolute paths). */
  paths?: string[];
  /** Identifiers the claim names (functions, classes, vars). */
  symbols?: string[];
  /** Type names + expected shape (e.g. "function foo returns User"). */
  typeAssertions?: Array<{ symbol: string; expectedReturn?: string; expectedArgs?: string[] }>;
  /** Version / tag / SHA references. */
  versionRefs?: Array<{ kind: "tag" | "sha" | "version"; value: string }>;
  /** Behavioral / domain phrases (e.g. "handles auth", "retries on 5xx"). */
  behaviors?: string[];
}

export interface FiveWitnessReport {
  witnesses: WitnessReport[];
  /** ALERT count. */
  alerts: number;
  /** All-grounded? */
  unanimous: boolean;
  /** Composite confidence in [0, 1]. */
  confidence: number;
  /** Total elapsed ms across all 5. */
  ms: number;
}

// ─── Facet extraction ─────────────────────────────────────────────────

const PATH_REGEX = /\b([./]?[\w@/-]+\.(?:ts|tsx|js|mjs|cjs|jsx|json|md|sql|yml|yaml|py|rs|go))\b/g;
const SYMBOL_REGEX = /\b([A-Za-z_][\w]{2,})\s*\(/g; // identifier followed by (
const VERSION_REGEX = /\bv?(\d+\.\d+\.\d+(?:-[\w.-]+)?)\b/g;
const SHA_REGEX = /\b([0-9a-f]{7,40})\b/g;
const BEHAVIOR_PHRASES = [
  /\b(handles?|implements?|covers?|supports?|tests?|validates?|enforces?|verifies?|caches?|deduplicates?)\b\s+([\w-]+(?:\s+[\w-]+){0,3})/gi,
];

/** Parse free-form claim text into structured facets. */
export function extractFacets(text: string): ClaimFacets {
  const facets: ClaimFacets = { text };
  const paths = new Set<string>();
  const symbols = new Set<string>();
  const versionRefs: NonNullable<ClaimFacets["versionRefs"]> = [];
  const behaviors = new Set<string>();
  for (const m of text.matchAll(PATH_REGEX)) paths.add(m[1]!);
  for (const m of text.matchAll(SYMBOL_REGEX)) {
    const id = m[1]!;
    // Skip common language words.
    if (id.length < 3) continue;
    if (/^(the|and|for|with|this|that|from|into|when|then|else|return|true|false|null)$/i.test(id)) continue;
    symbols.add(id);
  }
  for (const m of text.matchAll(VERSION_REGEX)) versionRefs.push({ kind: "version", value: m[1]! });
  for (const m of text.matchAll(SHA_REGEX)) {
    const v = m[1]!;
    // Avoid grabbing year-like numbers; SHAs need >=7 hex chars AND at least 1 letter typically.
    if (v.length >= 7 && /[a-f]/.test(v)) versionRefs.push({ kind: "sha", value: v });
  }
  for (const re of BEHAVIOR_PHRASES) {
    for (const m of text.matchAll(re)) behaviors.add(m[0]!.toLowerCase());
  }
  if (paths.size > 0) facets.paths = [...paths];
  if (symbols.size > 0) facets.symbols = [...symbols];
  if (versionRefs.length > 0) facets.versionRefs = versionRefs;
  if (behaviors.size > 0) facets.behaviors = [...behaviors];
  return facets;
}

// ─── W1: path-exists ──────────────────────────────────────────────────

function w1PathExists(repoRoot: string, facets: ClaimFacets): WitnessReport {
  const t0 = Date.now();
  if (!facets.paths || facets.paths.length === 0) {
    return { id: "W1-path", verdict: "INAPPLICABLE", detail: "Claim names no file paths.", ms: Date.now() - t0 };
  }
  const missing: string[] = [];
  const present: string[] = [];
  for (const p of facets.paths) {
    const abs = p.startsWith("/") || /^[A-Z]:/.test(p) ? p : join(repoRoot, p);
    if (existsSync(abs)) present.push(p);
    else missing.push(p);
  }
  if (missing.length === 0) {
    return { id: "W1-path", verdict: "GROUNDED", detail: `${present.length} path(s) verified on disk.`, evidence: present, ms: Date.now() - t0 };
  }
  return {
    id: "W1-path",
    verdict: "ALERT",
    detail: `${missing.length} of ${facets.paths.length} path(s) do not exist on disk: ${missing.join(", ")}`,
    evidence: missing,
    ms: Date.now() - t0,
  };
}

// ─── W2: symbol-exists ────────────────────────────────────────────────

function listSourceFiles(repoRoot: string, max = 5000): string[] {
  const out: string[] = [];
  const skipDirs = new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".mneme", "coverage"]);
  const walk = (dir: string) => {
    if (out.length >= max) return;
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      if (skipDirs.has(e)) continue;
      const p = join(dir, e);
      let s: ReturnType<typeof statSync>;
      try { s = statSync(p); } catch { continue; }
      if (s.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs|cjs|jsx|py|rs|go)$/.test(e)) out.push(p);
      if (out.length >= max) return;
    }
  };
  walk(repoRoot);
  return out;
}

function w2SymbolExists(repoRoot: string, facets: ClaimFacets): WitnessReport {
  const t0 = Date.now();
  if (!facets.symbols || facets.symbols.length === 0) {
    return { id: "W2-symbol", verdict: "INAPPLICABLE", detail: "Claim names no symbols.", ms: Date.now() - t0 };
  }
  const files = listSourceFiles(repoRoot);
  const missing: string[] = [];
  const present: string[] = [];
  // Build a single regex of all symbols (escaped) for one-pass scanning.
  const escapedSymbols = facets.symbols.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const foundSet = new Set<string>();
  for (const f of files) {
    let content = "";
    try { content = readFileSync(f, "utf8"); } catch { continue; }
    for (const sym of escapedSymbols) {
      if (foundSet.has(sym)) continue;
      const re = new RegExp(`\\b${sym}\\b`);
      if (re.test(content)) foundSet.add(sym);
    }
    if (foundSet.size === escapedSymbols.length) break;
  }
  for (let i = 0; i < facets.symbols.length; i++) {
    if (foundSet.has(escapedSymbols[i]!)) present.push(facets.symbols[i]!);
    else missing.push(facets.symbols[i]!);
  }
  if (missing.length === 0) {
    return { id: "W2-symbol", verdict: "GROUNDED", detail: `${present.length} symbol(s) found in source.`, evidence: present, ms: Date.now() - t0 };
  }
  return {
    id: "W2-symbol",
    verdict: "ALERT",
    detail: `${missing.length} of ${facets.symbols.length} symbol(s) not found in source: ${missing.join(", ")}`,
    evidence: missing,
    ms: Date.now() - t0,
  };
}

// ─── W3: type-shape ───────────────────────────────────────────────────

function w3TypeShape(repoRoot: string, facets: ClaimFacets): WitnessReport {
  const t0 = Date.now();
  if (!facets.typeAssertions || facets.typeAssertions.length === 0) {
    return { id: "W3-type", verdict: "INAPPLICABLE", detail: "Claim makes no type assertions.", ms: Date.now() - t0 };
  }
  const files = listSourceFiles(repoRoot, 2000);
  const failed: string[] = [];
  const passed: string[] = [];
  for (const ta of facets.typeAssertions) {
    let foundDecl = false;
    let returnOk = ta.expectedReturn === undefined;
    for (const f of files) {
      let content = "";
      try { content = readFileSync(f, "utf8"); } catch { continue; }
      // Match `function NAME(...): TYPE` or `NAME(...): TYPE =>` or `NAME(...): TYPE {`
      const declRe = new RegExp(`\\b(?:function\\s+)?${ta.symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\\\$&")}\\s*\\(([^)]*)\\)\\s*:\\s*([\\w<>\\[\\],| \\t]+?)(?:\\s*[{=]|\\s*$)`, "m");
      const m = content.match(declRe);
      if (m) {
        foundDecl = true;
        const actualReturn = (m[2] ?? "").trim();
        if (ta.expectedReturn && !actualReturn.includes(ta.expectedReturn)) {
          // mismatch
          returnOk = false;
        } else if (ta.expectedReturn) {
          returnOk = true;
        }
        break;
      }
    }
    if (!foundDecl) {
      failed.push(`${ta.symbol}: declaration not found`);
    } else if (!returnOk) {
      failed.push(`${ta.symbol}: return type mismatch (expected ${ta.expectedReturn})`);
    } else {
      passed.push(ta.symbol);
    }
  }
  if (failed.length === 0) {
    return { id: "W3-type", verdict: "GROUNDED", detail: `${passed.length} type assertion(s) match source.`, evidence: passed, ms: Date.now() - t0 };
  }
  return {
    id: "W3-type",
    verdict: "ALERT",
    detail: `${failed.length} of ${facets.typeAssertions.length} type assertion(s) failed: ${failed.join("; ")}`,
    evidence: failed,
    ms: Date.now() - t0,
  };
}

// ─── W4: git-history consistency ──────────────────────────────────────

function w4GitHistory(repoRoot: string, facets: ClaimFacets): WitnessReport {
  const t0 = Date.now();
  if (!facets.versionRefs || facets.versionRefs.length === 0) {
    return { id: "W4-history", verdict: "INAPPLICABLE", detail: "Claim makes no version/SHA references.", ms: Date.now() - t0 };
  }
  // v2.4 — root-cause fix for command injection. repoRoot may be supplied
  // by an MCP tool arg; never interpolate it into a shell template. Use
  // spawnSync with argv array (no shell) via safeExecTry.
  const tagsResult = safeExecTry("git", ["-C", repoRoot, "tag", "--list"], { timeoutMs: 3000 });
  const tags = tagsResult?.status === 0 ? tagsResult.stdout : "";
  const shasResult = safeExecTry("git", ["-C", repoRoot, "log", "--format=%H", "--max-count=1000"], { timeoutMs: 3000 });
  const shas = shasResult?.status === 0 ? shasResult.stdout : "";
  const tagSet = new Set(tags.split("\n").map((s) => s.trim()).filter(Boolean));
  const shaSet = new Set(shas.split("\n").map((s) => s.trim()).filter(Boolean));
  const failed: string[] = [];
  const passed: string[] = [];
  for (const ref of facets.versionRefs) {
    if (ref.kind === "version" || ref.kind === "tag") {
      const candidates = [ref.value, `v${ref.value}`];
      if (candidates.some((c) => tagSet.has(c))) passed.push(`tag:${ref.value}`);
      else failed.push(`tag/version "${ref.value}" not found in git tags`);
    } else if (ref.kind === "sha") {
      const hit = [...shaSet].some((s) => s.startsWith(ref.value));
      if (hit) passed.push(`sha:${ref.value}`);
      else failed.push(`sha "${ref.value}" not found in recent 1000 commits`);
    }
  }
  if (failed.length === 0) {
    return { id: "W4-history", verdict: "GROUNDED", detail: `${passed.length} version/SHA ref(s) verified.`, evidence: passed, ms: Date.now() - t0 };
  }
  return {
    id: "W4-history",
    verdict: "ALERT",
    detail: `${failed.length} of ${facets.versionRefs.length} version/SHA ref(s) failed: ${failed.join("; ")}`,
    evidence: failed,
    ms: Date.now() - t0,
  };
}

// ─── W5: behavior-cited ───────────────────────────────────────────────

function w5BehaviorCited(repoRoot: string, facets: ClaimFacets): WitnessReport {
  const t0 = Date.now();
  if (!facets.behaviors || facets.behaviors.length === 0) {
    return { id: "W5-behavior", verdict: "INAPPLICABLE", detail: "Claim makes no behavioral assertions.", ms: Date.now() - t0 };
  }
  const skipDirs = new Set(["node_modules", ".git", "dist", "build", ".mneme"]);
  const testFiles: string[] = [];
  const walk = (dir: string) => {
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      if (skipDirs.has(e)) continue;
      const p = join(dir, e);
      let s: ReturnType<typeof statSync>;
      try { s = statSync(p); } catch { continue; }
      if (s.isDirectory()) walk(p);
      else if (/\.(test|spec)\.(ts|tsx|js|mjs)$/.test(e)) testFiles.push(p);
    }
  };
  walk(repoRoot);

  const failed: string[] = [];
  const passed: string[] = [];
  for (const b of facets.behaviors) {
    // Extract the noun phrase after the verb.
    const m = b.match(/\b(?:handles?|implements?|covers?|supports?|tests?|validates?|enforces?|verifies?|caches?|deduplicates?)\b\s+(.+)$/i);
    if (!m) continue;
    const phrase = m[1]!.trim().toLowerCase();
    const tokens = phrase.split(/\s+/).filter((t) => t.length >= 3);
    if (tokens.length === 0) continue;
    let hit = false;
    for (const tf of testFiles) {
      let content = "";
      try { content = readFileSync(tf, "utf8").toLowerCase(); } catch { continue; }
      if (tokens.every((t) => content.includes(t))) {
        hit = true;
        break;
      }
    }
    if (hit) passed.push(phrase);
    else failed.push(phrase);
  }
  if (failed.length === 0) {
    return { id: "W5-behavior", verdict: "GROUNDED", detail: `${passed.length} behavior(s) cited by tests.`, evidence: passed, ms: Date.now() - t0 };
  }
  return {
    id: "W5-behavior",
    verdict: "ALERT",
    detail: `${failed.length} of ${facets.behaviors.length} behavior(s) not cited by any test: ${failed.join("; ")}`,
    evidence: failed,
    ms: Date.now() - t0,
  };
}

// ─── Public API ───────────────────────────────────────────────────────

export function fiveWitness(repoRoot: string, claimText: string, knownFacets?: Partial<ClaimFacets>): FiveWitnessReport {
  const t0 = Date.now();
  const facets: ClaimFacets = { ...extractFacets(claimText), ...knownFacets };
  const witnesses: WitnessReport[] = [
    w1PathExists(repoRoot, facets),
    w2SymbolExists(repoRoot, facets),
    w3TypeShape(repoRoot, facets),
    w4GitHistory(repoRoot, facets),
    w5BehaviorCited(repoRoot, facets),
  ];
  const alerts = witnesses.filter((w) => w.verdict === "ALERT").length;
  const grounded = witnesses.filter((w) => w.verdict === "GROUNDED").length;
  const applicable = witnesses.filter((w) => w.verdict !== "INAPPLICABLE").length;
  const unanimous = alerts === 0 && grounded > 0;
  const confidence = applicable === 0 ? 0.5 : Math.max(0, (grounded - alerts) / applicable * 0.5 + 0.5);
  return {
    witnesses,
    alerts,
    unanimous,
    confidence,
    ms: Date.now() - t0,
  };
}
