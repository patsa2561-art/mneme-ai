/**
 * Mneme Antivirus -- the 8 seed vaccines.
 *
 * Each vaccine targets one strain. Assays are REAL: they shell out to git,
 * read the filesystem, query npm, etc. No mocks. No "looks-like" heuristics
 * (those live in strains.ts as surface patterns). The vaccine's job is to
 * CONFIRM whether a flagged surface match is genuinely an infection.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { Vaccine, VaccineCache, VaccineContext, SuspectClaim } from "./types.js";

// ─── Cache builder (called once per scan to amortize git/fs lookups) ────

export function buildCache(repoRoot: string): VaccineCache {
  const cache: VaccineCache = {};

  // Git SHAs (latest 5000 commits, both abbrev and full)
  try {
    const r = spawnSync("git", ["log", "-5000", "--format=%H"], {
      cwd: repoRoot, encoding: "utf8", timeout: 10000,
    });
    if (r.status === 0) {
      const fullShas = (r.stdout ?? "").split("\n").filter(Boolean);
      const set = new Set<string>();
      for (const sha of fullShas) {
        set.add(sha.toLowerCase());
        // also add common abbreviations (7, 8, 10, 12 chars)
        for (const len of [7, 8, 10, 12]) set.add(sha.slice(0, len).toLowerCase());
      }
      cache.knownShas = set;
    }
  } catch { /* best-effort */ }

  // Git authors (name + email)
  try {
    const r = spawnSync("git", ["log", "--format=%aN%n%aE", "--all"], {
      cwd: repoRoot, encoding: "utf8", timeout: 10000,
    });
    if (r.status === 0) {
      const set = new Set<string>();
      for (const line of (r.stdout ?? "").split("\n")) {
        const t = line.trim();
        if (t) set.add(t.toLowerCase());
      }
      cache.knownAuthors = set;
    }
  } catch { /* best-effort */ }

  // File paths (top-level dirs walked one level + git ls-files for completeness)
  try {
    const r = spawnSync("git", ["ls-files"], {
      cwd: repoRoot, encoding: "utf8", timeout: 15000,
      maxBuffer: 50 * 1024 * 1024,
    });
    if (r.status === 0) {
      const set = new Set<string>();
      for (const p of (r.stdout ?? "").split("\n")) {
        const t = p.trim();
        if (t) {
          set.add(t);
          // also normalize backslash to forward slash
          set.add(t.replace(/\\/g, "/"));
        }
      }
      cache.knownPaths = set;
    }
  } catch { /* best-effort */ }

  // Polyglot package deps -- v1.28.0 expanded from JS-only to:
  //   JS    : package.json (deps + dev + peer + optional)
  //   Python: requirements.txt + pyproject.toml [project.dependencies]
  //   Rust  : Cargo.toml [dependencies] + [dev-dependencies]
  //   Go    : go.mod (require blocks)
  //   Ruby  : Gemfile (gem 'name')
  //   Java  : build.gradle / pom.xml (best-effort regex)
  // Each ecosystem extends the same `knownDeps` set; the
  // depends_imaginarium vaccine looks up across all of them.
  const knownDeps = new Set<string>();
  try {
    const pkgPath = join(repoRoot, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      for (const k of Object.keys(pkg.dependencies ?? {})) knownDeps.add(k);
      for (const k of Object.keys(pkg.devDependencies ?? {})) knownDeps.add(k);
      for (const k of Object.keys(pkg.peerDependencies ?? {})) knownDeps.add(k);
      for (const k of Object.keys(pkg.optionalDependencies ?? {})) knownDeps.add(k);
    }
  } catch { /* */ }
  // Python: requirements.txt
  try {
    const reqPath = join(repoRoot, "requirements.txt");
    if (existsSync(reqPath)) {
      for (const line of readFileSync(reqPath, "utf8").split("\n")) {
        const m = /^([a-zA-Z0-9_.\-]+)\s*[<>=~!\[]/.exec(line.trim()) ?? /^([a-zA-Z0-9_.\-]+)\s*$/.exec(line.trim());
        if (m && m[1]) knownDeps.add(m[1].toLowerCase());
      }
    }
  } catch { /* */ }
  // Python: pyproject.toml [project.dependencies] (best-effort regex --
  // we don't pull in a TOML parser to keep deps minimal)
  try {
    const pp = join(repoRoot, "pyproject.toml");
    if (existsSync(pp)) {
      const text = readFileSync(pp, "utf8");
      const m = /\[project\.dependencies\]([\s\S]*?)(?:\n\[|$)/.exec(text)
        ?? /dependencies\s*=\s*\[([\s\S]*?)\]/.exec(text);
      if (m && m[1]) {
        for (const dep of m[1].matchAll(/["']([a-zA-Z0-9_.\-]+)/g)) {
          if (dep[1]) knownDeps.add(dep[1].toLowerCase());
        }
      }
    }
  } catch { /* */ }
  // Rust: Cargo.toml [dependencies]
  try {
    const cargo = join(repoRoot, "Cargo.toml");
    if (existsSync(cargo)) {
      const text = readFileSync(cargo, "utf8");
      const sections = text.match(/\[(?:dev-)?dependencies\]([\s\S]*?)(?=\n\[|$)/g) ?? [];
      for (const sec of sections) {
        for (const m of sec.matchAll(/^([a-zA-Z0-9_-]+)\s*=/gm)) {
          if (m[1]) knownDeps.add(m[1].toLowerCase());
        }
      }
    }
  } catch { /* */ }
  // Go: go.mod
  try {
    const gomod = join(repoRoot, "go.mod");
    if (existsSync(gomod)) {
      const text = readFileSync(gomod, "utf8");
      // Single-line + multi-line `require ( ... )` blocks.
      const req = text.match(/^require\s+(?:\(([\s\S]*?)\)|(\S+\s+\S+))/m);
      if (req) {
        const body = req[1] ?? req[2] ?? "";
        for (const m of body.matchAll(/^\s*([a-zA-Z0-9_./.\-]+)\s+v\d/gm)) {
          if (m[1]) knownDeps.add(m[1].toLowerCase());
        }
      }
    }
  } catch { /* */ }
  // Ruby: Gemfile / Gemfile.lock
  try {
    for (const f of ["Gemfile", "Gemfile.lock"]) {
      const p = join(repoRoot, f);
      if (existsSync(p)) {
        const text = readFileSync(p, "utf8");
        for (const m of text.matchAll(/(?:^|\s)(?:gem\s+["']|^\s+)([a-zA-Z0-9_\-]+)/gm)) {
          if (m[1]) knownDeps.add(m[1].toLowerCase());
        }
      }
    }
  } catch { /* */ }
  // Java: build.gradle / pom.xml (best-effort)
  try {
    const gradle = join(repoRoot, "build.gradle");
    if (existsSync(gradle)) {
      const text = readFileSync(gradle, "utf8");
      for (const m of text.matchAll(/['"]([a-zA-Z0-9_.\-]+):([a-zA-Z0-9_.\-]+):/g)) {
        if (m[1] && m[2]) knownDeps.add(`${m[1]}:${m[2]}`.toLowerCase());
      }
    }
    const pom = join(repoRoot, "pom.xml");
    if (existsSync(pom)) {
      const text = readFileSync(pom, "utf8");
      const groups = text.matchAll(/<artifactId>([^<]+)<\/artifactId>/g);
      for (const g of groups) {
        if (g[1]) knownDeps.add(g[1].toLowerCase());
      }
    }
  } catch { /* */ }
  if (knownDeps.size > 0) cache.knownDeps = knownDeps;

  return cache;
}

// ─── Vaccine 1: anti-Citatio viridis (commit-hash verifier) ─────────────

export const VAC_CITATIO_VIRIDIS: Vaccine = {
  id: "anti_citatio_viridis_v1",
  strain: "citatio_viridis",
  version: "1.0.0",
  atoms: ["mneme.audit.verify_commit", "mneme.replay.cross_reference"],
  mechanism:
    "Extracts the matched 7-40 char hex string. Looks it up in the in-memory cache of all known git SHAs (full + common abbreviations). If absent, verifies via `git cat-file -t <sha>` as a tie-breaker before reporting infection.",
  assay: async (claim, ctx) => {
    const sha = (claim.match.match(/[0-9a-fA-F]{7,40}/) ?? [""])[0]?.toLowerCase() ?? "";
    if (!sha) return { infected: false, evidence: "no SHA-shaped substring", cure: undefined };
    // Reject obvious non-shas (e.g., word starting with hex letters)
    if (sha.length < 7) return { infected: false, evidence: "too short to be a SHA" };
    if (ctx.cache?.knownShas?.has(sha)) {
      return { infected: false, evidence: `SHA ${sha} found in git log cache` };
    }
    // Tie-breaker: ask git directly. Cheap if cache miss is rare.
    const probe = spawnSync("git", ["cat-file", "-t", sha], {
      cwd: ctx.repoRoot, encoding: "utf8", timeout: 3000,
    });
    if (probe.status === 0) {
      return { infected: false, evidence: `git cat-file confirmed ${sha} exists` };
    }
    return {
      infected: true,
      evidence: `SHA ${sha} not found in git log nor by cat-file`,
      cure: `Remove or replace SHA "${sha}" -- it doesn't exist in this repo's git history.`,
    };
  },
};

// ─── Vaccine 2: anti-Persona fictum (author-name verifier) ──────────────

export const VAC_PERSONA_FICTUM: Vaccine = {
  id: "anti_persona_fictum_v1",
  strain: "persona_fictum",
  version: "1.0.0",
  atoms: ["mneme.people.passport", "mneme.people.atrophy"],
  mechanism:
    "Extracts the capitalized name from the surface match. Lowercases + checks against the cached set of all distinct git authors (name OR email). Tolerates minor whitespace variation.",
  assay: async (claim, ctx) => {
    // Pattern capture group is the second token (the name); normalize.
    const m = claim.match.match(/(?:by|@|committed by|written by|authored by)\s+(.+)$/i);
    const candidate = (m?.[1] ?? "").trim().toLowerCase();
    if (!candidate) return { infected: false, evidence: "no name extracted from match" };
    const known = ctx.cache?.knownAuthors;
    if (!known || known.size === 0) {
      return { infected: false, evidence: "git author cache unavailable -- skipping (open verdict)" };
    }
    // Direct hit (full name or email)
    if (known.has(candidate)) {
      return { infected: false, evidence: `"${candidate}" is a known author` };
    }
    // Substring hit (last name etc.)
    for (const author of known) {
      if (author.includes(candidate) || candidate.includes(author)) {
        return { infected: false, evidence: `"${candidate}" matches known author "${author}" by substring` };
      }
    }
    return {
      infected: true,
      evidence: `"${candidate}" not found among ${known.size} git authors`,
      cure: `Remove the attribution to "${candidate}" or replace with one of the actual authors (use \`git log --format='%aN' | sort -u\` to see them).`,
    };
  },
};

// ─── Vaccine 3: anti-API phantasma (function-existence checker) ──────────

export const VAC_API_PHANTASMA: Vaccine = {
  id: "anti_api_phantasma_v1",
  strain: "api_phantasma",
  version: "1.0.0",
  atoms: ["mneme.entities.symbols", "mneme.dna.search"],
  mechanism:
    "Extracts the function/method identifier. Greps the repo for a definition: `function NAME`, `const NAME =`, `NAME(... ) {`, `def NAME`, etc. If no definition found, reports infection. Skips builtins (console, Math, JSON, Object, Array, Promise, etc.).",
  assay: async (claim, ctx) => {
    // Capture group 1 is the identifier. May include a dot (foo.bar).
    const id = (claim.match.match(/^[\w$.]+/) ?? [""])[0];
    const lastSeg = id.split(".").pop() ?? "";
    if (!lastSeg) return { infected: false, evidence: "no identifier extracted" };
    // Builtins / very common identifiers -- never flag these.
    const BUILTINS = new Set([
      "console", "log", "warn", "error", "info", "debug",
      "JSON", "parse", "stringify",
      "Math", "max", "min", "abs", "floor", "ceil", "round", "random", "sqrt", "pow",
      "Object", "keys", "values", "entries", "assign", "freeze",
      "Array", "from", "of", "isArray", "map", "filter", "reduce", "forEach", "find", "indexOf",
      "Promise", "all", "race", "resolve", "reject",
      "String", "Number", "Boolean", "Date", "RegExp", "Error",
      "fetch", "setTimeout", "setInterval", "clearTimeout", "clearInterval",
      "require", "import", "exports", "module",
      "describe", "it", "test", "expect", "beforeEach", "afterEach", "beforeAll", "afterAll",
    ]);
    if (BUILTINS.has(lastSeg)) return { infected: false, evidence: `${lastSeg} is a builtin/common identifier` };
    if (lastSeg.length < 3) return { infected: false, evidence: "identifier too short to be meaningful" };
    // grep across the repo (rg-equivalent via git grep, fast on indexed files).
    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const def = spawnSync("git", [
      "grep", "-l", "-E",
      `\\b(function|const|let|var|class|def|fn)\\s+${escapeRe(lastSeg)}\\b|\\b${escapeRe(lastSeg)}\\s*[=:]\\s*(\\(|function|async)|^\\s*${escapeRe(lastSeg)}\\s*\\(`,
    ], { cwd: ctx.repoRoot, encoding: "utf8", timeout: 8000 });
    if (def.status === 0 && (def.stdout ?? "").trim().length > 0) {
      return { infected: false, evidence: `definition found via git grep` };
    }
    return {
      infected: true,
      evidence: `no definition for "${lastSeg}" found via git grep across the repo`,
      cure: `Verify ${lastSeg} exists -- could be a typo or a function from a library. If it's external, name the library; if it's local, double-check the spelling.`,
    };
  },
};

// ─── Vaccine 4: anti-Depends imaginarium (npm pkg verifier) ─────────────

export const VAC_DEPENDS_IMAGINARIUM: Vaccine = {
  id: "anti_depends_imaginarium_v1",
  strain: "depends_imaginarium",
  version: "1.0.0",
  atoms: ["mneme.audit.deps", "mneme.security.sbom"],
  mechanism:
    "Extracts the package name. Checks (1) project dependencies, (2) node_modules existence, (3) npm registry packument. If all three miss, reports infection.",
  assay: async (claim, ctx) => {
    const m = claim.match.match(/['"]?(@?[a-z0-9][\w./-]*)['"]?$/);
    const pkg = (m?.[1] ?? "").replace(/\/.*$/, ""); // strip subpath: foo/bar -> foo, @scope/foo/bar -> @scope/foo
    if (!pkg) return { infected: false, evidence: "no package name extracted" };
    // Skip relative imports
    if (pkg.startsWith(".") || pkg.startsWith("/")) return { infected: false, evidence: "relative path, not a package" };
    // Skip Node builtins
    const NODE_BUILTINS = new Set([
      "fs", "path", "os", "url", "util", "stream", "buffer", "events",
      "crypto", "http", "https", "child_process", "querystring", "zlib",
      "node:fs", "node:path", "node:os", "node:url", "node:util", "node:stream",
      "node:buffer", "node:events", "node:crypto", "node:http", "node:https",
      "node:child_process", "node:querystring", "node:zlib", "node:test", "node:assert",
    ]);
    if (NODE_BUILTINS.has(pkg)) return { infected: false, evidence: "node builtin" };
    // 1. project deps
    if (ctx.cache?.knownDeps?.has(pkg)) {
      return { infected: false, evidence: `"${pkg}" is in package.json` };
    }
    // 2. node_modules
    const nmPath = pkg.startsWith("@")
      ? join(ctx.repoRoot, "node_modules", ...pkg.split("/"))
      : join(ctx.repoRoot, "node_modules", pkg);
    if (existsSync(nmPath)) {
      return { infected: false, evidence: `"${pkg}" exists in node_modules` };
    }
    // 3. npm registry packument
    try {
      const url = `https://registry.npmjs.org/${pkg.replace("/", "%2f")}`;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 5000);
      const r = await fetch(url, { signal: ctl.signal });
      clearTimeout(timer);
      if (r.ok) {
        return { infected: false, evidence: `"${pkg}" exists on npm registry (not installed locally)` };
      }
    } catch { /* network may be offline -- fall through to infected */ }
    return {
      infected: true,
      evidence: `"${pkg}" not in package.json, not in node_modules, not on npm registry`,
      cure: `Replace "${pkg}" with a real package, or install it explicitly: \`npm install ${pkg}\`. Double-check spelling.`,
    };
  },
};

// ─── Vaccine 5: anti-Tempus perversum (date verifier) ───────────────────

export const VAC_TEMPUS_PERVERSUM: Vaccine = {
  id: "anti_tempus_perversum_v1",
  strain: "tempus_perversum",
  version: "1.0.0",
  atoms: ["mneme.audit.timeline"],
  mechanism:
    "Extracts the ISO date. Flags as infected only when the date is implausibly distant from the repo's commit-date range (more than 1 year before the first commit, or more than 1 year after the last commit at scan time).",
  assay: async (claim, ctx) => {
    const date = (claim.match.match(/\d{4}-\d{2}-\d{2}/) ?? [""])[0];
    if (!date) return { infected: false, evidence: "no date extracted" };
    const dateMs = Date.parse(date);
    if (!Number.isFinite(dateMs)) return { infected: false, evidence: "unparseable date" };
    // Get repo's commit date range (cheap: --format with -1 + --reverse -1).
    let firstMs = 0;
    let lastMs = Date.now();
    try {
      const last = spawnSync("git", ["log", "-1", "--format=%ct"], {
        cwd: ctx.repoRoot, encoding: "utf8", timeout: 3000,
      });
      if (last.status === 0) lastMs = parseInt((last.stdout ?? "").trim(), 10) * 1000;
      const first = spawnSync("git", ["log", "--reverse", "-1", "--format=%ct"], {
        cwd: ctx.repoRoot, encoding: "utf8", timeout: 3000,
      });
      if (first.status === 0) firstMs = parseInt((first.stdout ?? "").trim(), 10) * 1000;
    } catch { /* best-effort */ }
    if (!firstMs) return { infected: false, evidence: "git commit-date range unavailable -- open verdict" };
    const ONE_YEAR = 365 * 24 * 60 * 60 * 1000;
    if (dateMs < firstMs - ONE_YEAR) {
      return {
        infected: true,
        evidence: `date ${date} predates this repo by more than 1 year (first commit: ${new Date(firstMs).toISOString().slice(0, 10)})`,
        cure: `The repo didn't exist on ${date}. Pick a date from the repo's actual history.`,
      };
    }
    if (dateMs > lastMs + ONE_YEAR) {
      return {
        infected: true,
        evidence: `date ${date} is more than 1 year past the latest commit (${new Date(lastMs).toISOString().slice(0, 10)})`,
        cure: `${date} is in the future relative to this repo's history. Use a real past date or note it's a projection.`,
      };
    }
    return { infected: false, evidence: `date ${date} falls within the repo's commit-date range` };
  },
};

// ─── Vaccine 6: anti-Confidens cardinalis (count verifier) ──────────────

export const VAC_CONFIDENS_CARDINALIS: Vaccine = {
  id: "anti_confidens_cardinalis_v1",
  strain: "confidens_cardinalis",
  version: "1.0.0",
  atoms: ["mneme.metrics.count"],
  mechanism:
    "Extracts (count, noun) pairs. For nouns Mneme can verify (commits, files, packages, tests), runs the actual count and flags if claimed-vs-actual differs by >20% AND >5 absolute.",
  assay: async (claim, ctx) => {
    const m = claim.match.match(/^(\d{1,6})\s+(\w+)/);
    const claimedN = parseInt(m?.[1] ?? "", 10);
    const noun = (m?.[2] ?? "").toLowerCase().replace(/s$/, ""); // singularize
    if (!Number.isFinite(claimedN) || !noun) return { infected: false, evidence: "no count extracted" };

    let actual: number | null = null;
    let how = "";
    try {
      if (noun === "commit") {
        const r = spawnSync("git", ["rev-list", "--count", "HEAD"], {
          cwd: ctx.repoRoot, encoding: "utf8", timeout: 5000,
        });
        if (r.status === 0) { actual = parseInt((r.stdout ?? "").trim(), 10); how = "git rev-list --count HEAD"; }
      } else if (noun === "file") {
        const r = spawnSync("git", ["ls-files"], {
          cwd: ctx.repoRoot, encoding: "utf8", timeout: 8000, maxBuffer: 50 * 1024 * 1024,
        });
        if (r.status === 0) { actual = (r.stdout ?? "").split("\n").filter(Boolean).length; how = "git ls-files"; }
      } else if (noun === "package") {
        if (ctx.cache?.knownDeps) { actual = ctx.cache.knownDeps.size; how = "package.json deps + devDeps"; }
      } else if (noun === "test") {
        // Count *.test.ts / *.test.js files
        const r = spawnSync("git", ["ls-files", "*.test.*"], {
          cwd: ctx.repoRoot, encoding: "utf8", timeout: 5000,
        });
        if (r.status === 0) { actual = (r.stdout ?? "").split("\n").filter(Boolean).length; how = "git ls-files *.test.*"; }
      }
    } catch { /* best-effort */ }

    if (actual == null) return { infected: false, evidence: `no verifier for noun "${noun}" -- open verdict` };
    const diff = Math.abs(claimedN - actual);
    const pct = actual === 0 ? (claimedN === 0 ? 0 : 1) : diff / actual;
    if (diff > 5 && pct > 0.2) {
      return {
        infected: true,
        evidence: `claimed ${claimedN} ${noun}s; actual ${actual} (via ${how}). Diff ${diff} (${(pct * 100).toFixed(0)}%)`,
        cure: `Replace "${claimedN} ${noun}s" with the verified count: ${actual}. (Source: ${how})`,
      };
    }
    return { infected: false, evidence: `claimed ${claimedN} ${noun}s; actual ${actual} -- within tolerance` };
  },
};

// ─── Vaccine 7: anti-Structura invenita (file-path verifier) ────────────

export const VAC_STRUCTURA_INVENITA: Vaccine = {
  id: "anti_structura_invenita_v1",
  strain: "structura_invenita",
  version: "1.0.0",
  atoms: ["mneme.audit.fs"],
  mechanism:
    "Normalizes the path (forward slashes, strip leading `./`). Checks (1) the cached git ls-files set, (2) fs.existsSync as a tie-breaker. If both miss, reports infection.",
  assay: async (claim, ctx) => {
    const raw = claim.match.trim().replace(/^\.\//, "").replace(/\\/g, "/");
    if (!raw) return { infected: false, evidence: "empty path" };
    if (ctx.cache?.knownPaths?.has(raw)) {
      return { infected: false, evidence: `"${raw}" found in git ls-files` };
    }
    // Tie-breaker: real filesystem (catches files newer than the cache).
    const abs = resolve(ctx.repoRoot, raw);
    if (existsSync(abs)) return { infected: false, evidence: `"${raw}" exists on disk` };
    // Skip very short / generic strings that pattern false-positives.
    // v1.24.2: bumped from `< 6` to `<= 8` to cover log.js, util.js,
    // index.ts (8 chars), foo.json -- generic names that say nothing
    // about "this exact path exists" until a slash gives them context.
    if (raw.length <= 8 && !raw.includes("/")) {
      return { infected: false, evidence: `"${raw}" too generic to flag (no parent dir)` };
    }
    return {
      infected: true,
      evidence: `path "${raw}" not in git ls-files and not on disk`,
      cure: `The path "${raw}" doesn't exist. Use \`git ls-files | grep <name>\` to find the real path or remove the reference.`,
    };
  },
};

// ─── Vaccine 8: anti-Logica circularis (cycle detector) ─────────────────

export const VAC_LOGICA_CIRCULARIS: Vaccine = {
  id: "anti_logica_circularis_v1",
  strain: "logica_circularis",
  version: "1.0.0",
  atoms: ["mneme.adversarial.cross_examine"],
  mechanism:
    "Splits the draft into clauses around causal markers. Builds a tiny (premise -> conclusion) graph keyed by lowercase 6-gram fingerprint of each clause. Detects a cycle => infection.",
  assay: async (claim, _ctx) => {
    // claim.match here is one causal connective; we need the FULL surrounding
    // draft to detect a cycle. The scan() function passes the full draft via
    // ctx.cache.fullDraft (set by scan.ts). For the standalone smoke test we
    // gracefully no-op when the draft isn't available.
    void claim; void _ctx;
    // We use a side-channel: scan.ts sets globalThis.__mnemeCurrentDraft.
    const draft = (globalThis as { __mnemeCurrentDraft?: string }).__mnemeCurrentDraft ?? "";
    if (!draft || draft.length < 40) return { infected: false, evidence: "draft too short for cycle analysis" };

    // Split by causal connectives + sentence boundaries.
    const clauses = draft
      .split(/(?:[.!?\n]|\bbecause\b|\btherefore\b|\bsince\b|\bso\b)/i)
      .map((c) => c.trim().toLowerCase().replace(/\s+/g, " "))
      .filter((c) => c.length > 6);

    if (clauses.length < 4) return { infected: false, evidence: "too few clauses for cycle analysis" };

    // Fingerprint each clause by its first 6 significant words (drop stop-words).
    const STOP = new Set(["the", "a", "an", "is", "was", "are", "were", "of", "to", "in", "on", "for", "with", "and", "or", "that", "this"]);
    const fp = (s: string) =>
      s.split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)).slice(0, 6).join(" ");

    const ids = clauses.map(fp);
    // Build adjacency: clause i -> clause i+1 (sequential causal chain)
    const graph = new Map<string, Set<string>>();
    for (let i = 0; i < ids.length - 1; i++) {
      const from = ids[i]!;
      const to = ids[i + 1]!;
      if (!from || !to) continue;
      let s = graph.get(from);
      if (!s) { s = new Set<string>(); graph.set(from, s); }
      s.add(to);
    }
    // Cycle detection via DFS.
    const VISITED = new Set<string>();
    const STACK = new Set<string>();
    let cycleNode: string | null = null;
    function dfs(n: string): boolean {
      VISITED.add(n);
      STACK.add(n);
      for (const m of graph.get(n) ?? []) {
        if (!VISITED.has(m)) { if (dfs(m)) return true; }
        else if (STACK.has(m)) { cycleNode = m; return true; }
      }
      STACK.delete(n);
      return false;
    }
    for (const n of graph.keys()) {
      if (!VISITED.has(n) && dfs(n)) {
        return {
          infected: true,
          evidence: `clause "${cycleNode}" appears as both premise and conclusion (cycle)`,
          cure: `Untangle the circular argument: provide an INDEPENDENT source for "${cycleNode}".`,
        };
      }
    }
    return { infected: false, evidence: "no cycle in causal graph" };
  },
};

export const SEED_VACCINES: Vaccine[] = [
  VAC_CITATIO_VIRIDIS,
  VAC_PERSONA_FICTUM,
  VAC_API_PHANTASMA,
  VAC_DEPENDS_IMAGINARIUM,
  VAC_TEMPUS_PERVERSUM,
  VAC_CONFIDENS_CARDINALIS,
  VAC_STRUCTURA_INVENITA,
  VAC_LOGICA_CIRCULARIS,
];

export function vaccineById(id: string): Vaccine | null {
  return SEED_VACCINES.find((v) => v.id === id) ?? null;
}

/** Dummy reference so the unused-vars lint doesn't complain about
 *  VaccineContext (it's used via destructuring in assays). */
export type _VC = VaccineContext;
export type _SC = SuspectClaim;
