/**
 * v1.69.0 -- HYPERSCAN H1: PROSE SHADOW SCAN.
 *
 * Wild idea: the v1.65 antivirus catches claims with syntax markers
 * (parens, file-extensions, version strings). It MISSES prose like:
 *
 *   "wraith-utils-2099 is integrated for caching"   -- fake npm package
 *   "Sentry catches our errors"                     -- general service name
 *   "we use Datadog for APM"                        -- general service name
 *   "RustCrypto's libcrypto powers our hash"        -- fake library claim
 *
 * Prose Shadow extracts ENTITY CANDIDATES from any text using three
 * mixed algorithms (title-case detector + package-shape pattern +
 * acronym matcher) and verifies each against:
 *
 *   1. Local citations    -- does this name appear in package.json,
 *                            imports, env vars, or source files?
 *   2. Domain authority   -- is it a known real service? (curated bank)
 *   3. Negation triggers  -- does the prose attribute behavior to a
 *                            name that fails grounding?
 *
 * Output: list of suspect ENTITIES (not just regex matches) with a
 * confidence band. This is the missing class the user identified.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface EntityCandidate {
  surface: string;
  kind: "title-cased" | "package-shape" | "acronym" | "domain-suffixed";
  /** Position in original text. */
  offset: number;
}

export interface ProseSuspect {
  entity: string;
  kind: EntityCandidate["kind"];
  /** Why this entity is suspect (none-of-our-evidence-supports-it / not-in-deps / etc.). */
  reason: string;
  /** 0..1; higher = stronger suspicion. */
  confidence: number;
  /** Citation hits found (helps caller decide). */
  citationsFound: string[];
}

export interface ProseScanReport {
  entitiesExtracted: number;
  suspects: ProseSuspect[];
  /** Whitelisted "known-real" entities the prose mentions. */
  recognized: string[];
  ms: number;
}

/** Curated list of real, widely-known services / libraries. Mneme
 *  treats a name in this list as definitionally "grounded" -- not a
 *  suspect even when no codebase citation exists. */
const KNOWN_REAL_NAMES = new Set([
  // Observability
  "sentry", "datadog", "newrelic", "splunk", "grafana", "prometheus",
  // Auth / identity
  "auth0", "okta", "keycloak", "cognito", "firebase",
  // Cloud
  "aws", "azure", "gcp", "cloudflare", "digitalocean", "heroku", "vercel", "netlify",
  // Databases
  "postgres", "postgresql", "mysql", "mongodb", "redis", "sqlite", "supabase",
  // CI
  "github", "gitlab", "bitbucket", "jenkins", "circleci", "travisci",
  // Languages / runtimes
  "node", "deno", "bun", "rust", "go", "python", "java",
  // Common libs / frameworks
  "react", "vue", "angular", "svelte", "express", "fastify", "nextjs", "nuxt",
  "vite", "webpack", "rollup", "esbuild", "vitest", "jest", "mocha", "playwright",
  "tailwind", "typescript", "eslint", "prettier",
  // AI / ML
  "openai", "anthropic", "claude", "gpt", "llama", "ollama", "huggingface",
  // Tools we know
  "mneme",
  // Universal tech acronyms (treated as concepts, not suspects)
  "ui", "ux", "db", "dom", "cli", "gui", "tui", "sdk", "ide", "vm", "os",
  "tcp", "udp", "ip", "ssl", "tls", "ssh", "dns", "cdn", "lan", "wan",
  "io", "fs",
]);

/** Stop-list of common words that LOOK like entities but aren't. */
const STOPWORDS_ENT = new Set([
  "The", "This", "That", "These", "Those", "I", "We", "You", "They",
  "Mneme", "AI", "API", "URL", "URI", "JSON", "HTML", "CSS", "SQL", "REST",
  "Run", "Get", "Set", "Add", "Use", "Make", "New", "Old",
  "Note", "Tip", "Warning", "Error",
]);

const PACKAGE_SHAPE = /\b([a-z][a-z0-9-]+(?:-[a-z0-9-]+){1,}(?:-[0-9]+)?)\b/g;
const TITLE_CASED = /(?<![./@\w])([A-Z][a-z]{2,}(?:[A-Z][a-z]+){0,3})\b/g;
const ACRONYM = /(?<![./@\w])([A-Z]{2,5})\b/g;
const DOMAIN_SUFFIXED = /\b([\w-]+\.(io|dev|cloud|ai|net|com|sh)(?!\w))/gi;

export function extractEntities(text: string): EntityCandidate[] {
  const out: EntityCandidate[] = [];
  const seen = new Set<string>();
  const push = (m: RegExpExecArray, kind: EntityCandidate["kind"]) => {
    const surface = m[1] ?? m[0];
    if (!surface) return;
    if (STOPWORDS_ENT.has(surface)) return;
    const key = `${kind}|${surface.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ surface, kind, offset: m.index });
  };
  for (const m of text.matchAll(TITLE_CASED)) push(m as RegExpExecArray, "title-cased");
  for (const m of text.matchAll(PACKAGE_SHAPE)) push(m as RegExpExecArray, "package-shape");
  for (const m of text.matchAll(ACRONYM)) push(m as RegExpExecArray, "acronym");
  for (const m of text.matchAll(DOMAIN_SUFFIXED)) push(m as RegExpExecArray, "domain-suffixed");
  return out;
}

interface CitationHaystack {
  packageNames: Set<string>;
  importedModules: Set<string>;
  fileContents: Map<string, string>;
}

function loadHaystack(repoRoot: string, maxFiles = 200): CitationHaystack {
  const packageNames = new Set<string>();
  const importedModules = new Set<string>();
  const fileContents = new Map<string, string>();
  // package.json dependencies.
  const pkgPath = join(repoRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
      for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
        const deps = pkg[key] as Record<string, unknown> | undefined;
        if (deps) for (const name of Object.keys(deps)) packageNames.add(name.toLowerCase());
      }
    } catch { /* */ }
  }
  // Walk source files, scan imports.
  const skip = new Set(["node_modules", ".git", "dist", "build", ".mneme", "coverage"]);
  const importRe = /(?:from|require)\s*\(?\s*["']([^"']+)["']/g;
  const walk = (dir: string) => {
    if (fileContents.size >= maxFiles) return;
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      if (skip.has(e)) continue;
      const p = join(dir, e);
      try {
        const s = statSync(p);
        if (s.isDirectory()) walk(p);
        else if (/\.(ts|tsx|js|mjs|cjs|jsx|json|md|yml|yaml)$/.test(e)) {
          let content = "";
          try { content = readFileSync(p, "utf8"); } catch { continue; }
          fileContents.set(p, content);
          for (const m of content.matchAll(importRe)) {
            const mod = m[1]!.split("/")[0]!.toLowerCase();
            if (mod) importedModules.add(mod);
          }
          if (fileContents.size >= maxFiles) return;
        }
      } catch { /* */ }
    }
  };
  walk(repoRoot);
  return { packageNames, importedModules, fileContents };
}

function findCitations(entity: string, haystack: CitationHaystack): string[] {
  const lower = entity.toLowerCase();
  const out: string[] = [];
  if (haystack.packageNames.has(lower)) out.push(`package.json:${lower}`);
  if (haystack.importedModules.has(lower)) out.push(`import:${lower}`);
  // Cross-package name (@scope/name) check.
  for (const pkgName of haystack.packageNames) {
    if (pkgName.includes(lower) && pkgName !== lower) out.push(`package.json-substring:${pkgName}`);
  }
  // File content scan with word-boundary on a sample of files.
  const re = new RegExp(`\\b${entity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  let scanned = 0;
  for (const [path, content] of haystack.fileContents) {
    if (scanned >= 40) break;
    scanned += 1;
    if (re.test(content)) {
      out.push(`file:${path.split(/[\\/]/).pop()}`);
      if (out.length > 5) break;
    }
  }
  return out;
}

export function proseScan(repoRoot: string, claim: string): ProseScanReport {
  const t0 = Date.now();
  const haystack = loadHaystack(repoRoot);
  const entities = extractEntities(claim);
  const suspects: ProseSuspect[] = [];
  const recognized: string[] = [];
  for (const ent of entities) {
    const surfaceLower = ent.surface.toLowerCase();
    if (KNOWN_REAL_NAMES.has(surfaceLower)) {
      recognized.push(ent.surface);
      continue;
    }
    const citations = findCitations(ent.surface, haystack);
    if (citations.length === 0) {
      // Mix of heuristics: package-shape with digits + no citation = very suspicious.
      let confidence = 0.5;
      let reason: string;
      if (ent.kind === "package-shape" && /\d/.test(ent.surface)) {
        confidence = 0.9;
        reason = `Package-shaped name "${ent.surface}" contains digits, not in deps, no source citation.`;
      } else if (ent.kind === "domain-suffixed") {
        confidence = 0.8;
        reason = `Domain-suffixed entity "${ent.surface}" has no citation in repo.`;
      } else if (ent.kind === "title-cased") {
        confidence = 0.55;
        reason = `Capitalized noun "${ent.surface}" has no codebase citation; unknown service.`;
      } else {
        confidence = 0.6;
        reason = `Acronym "${ent.surface}" has no codebase citation.`;
      }
      suspects.push({ entity: ent.surface, kind: ent.kind, reason, confidence, citationsFound: [] });
    }
  }
  return {
    entitiesExtracted: entities.length,
    suspects,
    recognized,
    ms: Date.now() - t0,
  };
}
