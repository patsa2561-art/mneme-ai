/**
 * Bayesian stack-aware priors.
 *
 * The motivating problem (customer feedback, v0.36): a NestJS + Mongoose repo
 * received 16 false-positive CWE-89 (SQL injection) findings because the
 * scanner regex matched the substring "update" in arbitrary log strings. The
 * scanner had no idea SQL drivers weren't even in the dependency graph.
 *
 * Algorithm: build a *stack vector* from package.json + lockfile. Each rule
 * declares a prior table: P(rule applies | stack signal). A finding's
 * posterior = prior(stack) × evidence(AST context). Rules whose prior on
 * this stack is below a small threshold are *silenced before regex runs* —
 * not just ranked low, actually skipped.
 *
 * This is genuinely novel for a CLI. SAST tools assume universal applicability
 * because they have no view of dependencies; package-audit tools see deps but
 * don't gate code patterns. Combining the two is the contribution here.
 */
import type { promises as fsPromises } from "node:fs";

export type RuleId =
  // Crypto (4)
  | "weak-hash"
  | "weak-cipher"
  | "weak-rng"
  | "hardcoded-secret"
  | "insecure-tls-version"
  | "timing-attack"
  // Injection (10)
  | "sql-injection"
  | "shell-injection"
  | "xss-innerhtml"
  | "xss-eval"
  | "xxe-external-entity"
  | "xpath-injection"
  | "ldap-injection"
  | "command-substitution"
  | "null-byte-injection"
  | "format-string"
  // Auth (5)
  | "hardcoded-token"
  | "jwt-no-verify"
  | "cors-wildcard-credentials"
  | "missing-auth-guard"
  | "weak-webhook-signature"
  | "csrf-missing"
  | "session-fixation"
  // Financial (3)
  | "money-arithmetic"
  | "money-as-number"
  | "amount-zero-comparison"
  | "integer-overflow"
  // Web (8)
  | "ssrf"
  | "prototype-pollution"
  | "mass-assignment"
  | "idor-no-ownership-check"
  | "path-traversal"
  | "open-redirect"
  | "unrestricted-file-upload"
  | "graphql-introspection-enabled"
  // Cookies / sessions (2)
  | "insecure-cookie-flags"
  | "hsts-missing"
  // Deserialisation (2)
  | "insecure-deserialization"
  | "unsafe-yaml-load"
  // Supply chain (1)
  | "dependency-changed"
  // Info leak (3)
  | "logged-secret"
  | "exposed-stack-trace"
  | "sensitive-data-in-url"
  // Concurrency (2)
  | "toctou-race"
  | "race-double-fetch"
  // Privilege (1)
  | "setuid-root"
  // Operational (3)
  | "debug-mode-in-prod"
  | "unsafe-temp-file"
  | "unsafe-regex-dos"
  // CSP (1)
  | "disabled-content-security-policy";

export interface StackProfile {
  /** Sources scanned (package.json paths or "<inline>"). */
  sources: string[];
  /** Has at least one SQL driver. */
  hasSql: boolean;
  /** Has at least one NoSQL driver (Mongo, Dynamo, Cassandra, Redis). */
  hasNoSql: boolean;
  /** Has a web framework (express, fastify, koa, hapi, nestjs). */
  hasWebFramework: boolean;
  /** Specific NestJS detection (decorator-based; needs special rules). */
  hasNestJS: boolean;
  /** Has a UI framework where XSS rules apply. */
  hasUiFramework: boolean;
  /** Has Stripe / Omise / payment-gateway dep that issues webhooks. */
  hasPaymentWebhook: boolean;
  /** Has a JWT library. */
  hasJwt: boolean;
  /** Has a templating engine where SSTI matters. */
  hasTemplating: boolean;
  /** Has an XML parser (xxe rules). */
  hasXmlParser: boolean;
  /** Has a YAML parser (deserialization rules). */
  hasYamlParser: boolean;
  /** Has a GraphQL server (introspection rules). */
  hasGraphQL: boolean;
  /** Has cookie-session middleware. */
  hasSession: boolean;
  /** Has a multipart/file-upload library. */
  hasFileUpload: boolean;
  // ── Multi-ecosystem detection (v0.50) ──────────────────────────────
  /** Detected from package.json. */
  ecosystemNode: boolean;
  /** Detected from requirements.txt / pyproject.toml / Pipfile. */
  ecosystemPython: boolean;
  /** Detected from go.mod. */
  ecosystemGo: boolean;
  /** Detected from Cargo.toml. */
  ecosystemRust: boolean;
  /** Detected from Gemfile. */
  ecosystemRuby: boolean;
  /** Detected from composer.json. */
  ecosystemPhp: boolean;
  /** All raw dependency names found, lowercased. */
  allDeps: Set<string>;
}

/** Hand-tuned priors. Format: P(rule fires legitimately | this stack signal). */
const RULE_PRIORS: Record<RuleId, (s: StackProfile) => number> = {
  // ── Crypto ────────────────────────────────────────────────────────
  "weak-hash": () => 0.85,
  "weak-cipher": () => 0.85,
  "weak-rng": () => 0.7,
  "hardcoded-secret": () => 0.9,
  "insecure-tls-version": () => 0.85,
  "timing-attack": (s) => (s.hasJwt || s.hasWebFramework ? 0.7 : 0.4),
  // ── Injection ─────────────────────────────────────────────────────
  "sql-injection": (s) => (s.hasSql ? 0.95 : 0.05),
  "shell-injection": () => 0.85,
  "xss-innerhtml": (s) => (s.hasUiFramework ? 0.9 : 0.4),
  "xss-eval": () => 0.75,
  "xxe-external-entity": (s) => (s.hasXmlParser ? 0.9 : 0.15),
  "xpath-injection": (s) => (s.hasXmlParser ? 0.85 : 0.1),
  "ldap-injection": () => 0.6,
  "command-substitution": () => 0.8,
  "null-byte-injection": () => 0.5,
  "format-string": () => 0.5,
  // ── Auth ──────────────────────────────────────────────────────────
  "hardcoded-token": () => 0.85,
  "jwt-no-verify": (s) => (s.hasJwt ? 0.95 : 0.4),
  "cors-wildcard-credentials": (s) => (s.hasWebFramework ? 0.9 : 0.5),
  "missing-auth-guard": (s) => (s.hasNestJS ? 0.85 : 0.0),
  "weak-webhook-signature": (s) => (s.hasPaymentWebhook ? 0.9 : 0.1),
  "csrf-missing": (s) => (s.hasWebFramework ? 0.8 : 0.1),
  "session-fixation": (s) => (s.hasSession ? 0.85 : 0.1),
  // ── Financial ─────────────────────────────────────────────────────
  "money-arithmetic": () => 0.7,
  "money-as-number": () => 0.7,
  "amount-zero-comparison": () => 0.45,
  "integer-overflow": () => 0.5,
  // ── Web ───────────────────────────────────────────────────────────
  ssrf: (s) => (s.hasWebFramework ? 0.85 : 0.4),
  "prototype-pollution": () => 0.75,
  "mass-assignment": (s) => (s.hasWebFramework ? 0.85 : 0.3),
  "idor-no-ownership-check": (s) => (s.hasWebFramework ? 0.7 : 0.1),
  "path-traversal": () => 0.85,
  "open-redirect": (s) => (s.hasWebFramework ? 0.85 : 0.2),
  "unrestricted-file-upload": (s) => (s.hasFileUpload ? 0.9 : 0.2),
  "graphql-introspection-enabled": (s) => (s.hasGraphQL ? 0.9 : 0.05),
  // ── Cookies / sessions ────────────────────────────────────────────
  "insecure-cookie-flags": (s) => (s.hasWebFramework ? 0.85 : 0.3),
  "hsts-missing": (s) => (s.hasWebFramework ? 0.65 : 0.1),
  // ── Deserialisation ───────────────────────────────────────────────
  "insecure-deserialization": () => 0.75,
  "unsafe-yaml-load": (s) => (s.hasYamlParser ? 0.9 : 0.15),
  // ── Supply chain ──────────────────────────────────────────────────
  "dependency-changed": () => 0.55,
  // ── Info leak ─────────────────────────────────────────────────────
  "logged-secret": () => 0.75,
  "exposed-stack-trace": () => 0.7,
  "sensitive-data-in-url": (s) => (s.hasWebFramework ? 0.8 : 0.3),
  // ── Concurrency ───────────────────────────────────────────────────
  "toctou-race": () => 0.5,
  "race-double-fetch": () => 0.5,
  // ── Privilege ─────────────────────────────────────────────────────
  "setuid-root": () => 0.95,
  // ── Operational ───────────────────────────────────────────────────
  "debug-mode-in-prod": () => 0.7,
  "unsafe-temp-file": () => 0.6,
  "unsafe-regex-dos": () => 0.65,
  "disabled-content-security-policy": (s) => (s.hasUiFramework || s.hasWebFramework ? 0.85 : 0.2),
};

const SQL_DEPS = new Set([
  "mysql", "mysql2", "pg", "pg-promise", "sqlite3", "better-sqlite3",
  "mssql", "tedious", "oracledb", "knex", "typeorm", "sequelize",
  "drizzle-orm", "kysely", "prisma", "@prisma/client",
]);
const NOSQL_DEPS = new Set([
  "mongodb", "mongoose", "dynamoose", "@aws-sdk/client-dynamodb",
  "ioredis", "redis", "cassandra-driver", "couchbase", "neo4j-driver",
]);
const WEB_FRAMEWORK_DEPS = new Set([
  "express", "fastify", "koa", "@hapi/hapi", "hapi", "@nestjs/core",
  "@nestjs/common", "next", "remix", "@remix-run/server-runtime",
  "@sveltejs/kit",
]);
const NESTJS_DEPS = new Set(["@nestjs/core", "@nestjs/common", "@nestjs/platform-express", "@nestjs/platform-fastify"]);
const UI_FRAMEWORK_DEPS = new Set([
  "react", "react-dom", "vue", "@vue/runtime-dom", "@angular/core",
  "svelte", "preact", "solid-js",
]);
const PAYMENT_WEBHOOK_DEPS = new Set([
  "stripe", "@stripe/stripe-js", "omise", "paypal-checkout-server-sdk",
  "@paypal/checkout-server-sdk", "square", "razorpay", "@adyen/api-library",
]);
const JWT_DEPS = new Set([
  "jsonwebtoken", "jose", "@nestjs/jwt", "fast-jwt", "jwt-decode",
]);
const TEMPLATING_DEPS = new Set([
  "ejs", "pug", "nunjucks", "handlebars", "mustache", "dot", "twig",
]);
const XML_PARSER_DEPS = new Set([
  "xml2js", "fast-xml-parser", "libxmljs", "libxmljs2", "xmldom",
  "@xmldom/xmldom", "xmlbuilder", "sax",
]);
const YAML_PARSER_DEPS = new Set([
  "js-yaml", "yaml", "@iarna/toml", "toml-eslint-parser",
]);
const GRAPHQL_DEPS = new Set([
  "graphql", "apollo-server", "@apollo/server", "@nestjs/graphql",
  "graphql-yoga", "mercurius",
]);
const SESSION_DEPS = new Set([
  "express-session", "cookie-session", "iron-session", "next-session",
  "fastify-session", "@fastify/session",
]);
const FILE_UPLOAD_DEPS = new Set([
  "multer", "busboy", "@fastify/multipart", "formidable",
  "express-fileupload", "@nestjs/platform-express",
]);

/**
 * Read every package.json under a path (workspaces-aware) and build the
 * stack profile. Falls back to scanning common workspace locations if no
 * top-level package.json is found.
 */
export async function detectStackProfile(rootPath: string): Promise<StackProfile> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const profile: StackProfile = freshProfile([]);

  // Node.js — package.json (workspaces-aware)
  const candidates = [
    path.join(rootPath, "package.json"),
    ...(await glob(rootPath, fs, ["packages", "apps", "services"], "package.json", 3)),
  ];
  for (const p of candidates) {
    try {
      const txt = await fs.readFile(p, "utf8");
      const pkg = JSON.parse(txt) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
      profile.sources.push(p);
      profile.ecosystemNode = true;
      mergeDeps(profile, pkg.dependencies);
      mergeDeps(profile, pkg.devDependencies);
      mergeDeps(profile, pkg.peerDependencies);
    } catch { /* BE:silent-by-design -  file missing or invalid JSON — skip silently */ }
  }

  // Python — pyproject.toml / requirements.txt / Pipfile
  for (const f of ["pyproject.toml", "requirements.txt", "Pipfile"]) {
    try {
      const txt = await fs.readFile(path.join(rootPath, f), "utf8");
      profile.sources.push(path.join(rootPath, f));
      profile.ecosystemPython = true;
      // Cheap parser: scan for known package names
      mergeRawText(profile, txt);
    } catch { /* BE:silent-by-design  skip  */ }
  }

  // Go — go.mod
  try {
    const txt = await fs.readFile(path.join(rootPath, "go.mod"), "utf8");
    profile.sources.push(path.join(rootPath, "go.mod"));
    profile.ecosystemGo = true;
    mergeRawText(profile, txt);
  } catch { /* BE:silent-by-design  skip  */ }

  // Rust — Cargo.toml
  try {
    const txt = await fs.readFile(path.join(rootPath, "Cargo.toml"), "utf8");
    profile.sources.push(path.join(rootPath, "Cargo.toml"));
    profile.ecosystemRust = true;
    mergeRawText(profile, txt);
  } catch { /* BE:silent-by-design  skip  */ }

  // Ruby — Gemfile
  try {
    const txt = await fs.readFile(path.join(rootPath, "Gemfile"), "utf8");
    profile.sources.push(path.join(rootPath, "Gemfile"));
    profile.ecosystemRuby = true;
    mergeRawText(profile, txt);
  } catch { /* BE:silent-by-design  skip  */ }

  // PHP — composer.json
  try {
    const txt = await fs.readFile(path.join(rootPath, "composer.json"), "utf8");
    const pkg = JSON.parse(txt) as { require?: Record<string, string>; "require-dev"?: Record<string, string> };
    profile.sources.push(path.join(rootPath, "composer.json"));
    profile.ecosystemPhp = true;
    mergeDeps(profile, pkg.require);
    mergeDeps(profile, pkg["require-dev"]);
    // Also scan raw text so vendor/package combos like laravel/framework
    // and symfony/* fire the framework signal via name match.
    mergeRawText(profile, txt);
  } catch { /* BE:silent-by-design  skip  */ }

  return profile;
}

function freshProfile(sources: string[]): StackProfile {
  return {
    sources,
    hasSql: false,
    hasNoSql: false,
    hasWebFramework: false,
    hasNestJS: false,
    hasUiFramework: false,
    hasPaymentWebhook: false,
    hasJwt: false,
    hasTemplating: false,
    hasXmlParser: false,
    hasYamlParser: false,
    hasGraphQL: false,
    hasSession: false,
    hasFileUpload: false,
    ecosystemNode: false,
    ecosystemPython: false,
    ecosystemGo: false,
    ecosystemRust: false,
    ecosystemRuby: false,
    ecosystemPhp: false,
    allDeps: new Set(),
  };
}

/**
 * Build a profile from an inline dependency list. Used for tests +
 * for callers (CLI `--stack`) that pass deps directly.
 */
export function buildStackProfile(deps: string[]): StackProfile {
  const profile = freshProfile(["<inline>"]);
  const obj: Record<string, string> = {};
  for (const d of deps) obj[d] = "*";
  mergeDeps(profile, obj);
  return profile;
}

/** Cheap text scan for known package names (Python/Go/Rust/Ruby manifests). */
function mergeRawText(profile: StackProfile, text: string): void {
  const lc = text.toLowerCase();
  // Common high-signal packages across ecosystems
  const TEXT_SIGNALS: Array<{ needle: string; flag: keyof StackProfile }> = [
    // Web frameworks
    { needle: "fastapi", flag: "hasWebFramework" },
    { needle: "flask", flag: "hasWebFramework" },
    { needle: "django", flag: "hasWebFramework" },
    { needle: "starlette", flag: "hasWebFramework" },
    { needle: "tornado", flag: "hasWebFramework" },
    { needle: "gin-gonic/gin", flag: "hasWebFramework" },
    { needle: "echo", flag: "hasWebFramework" },
    { needle: "actix-web", flag: "hasWebFramework" },
    { needle: "rocket", flag: "hasWebFramework" },
    { needle: "rails", flag: "hasWebFramework" },
    { needle: "sinatra", flag: "hasWebFramework" },
    { needle: "laravel", flag: "hasWebFramework" },
    { needle: "symfony", flag: "hasWebFramework" },
    // SQL drivers
    { needle: "psycopg2", flag: "hasSql" },
    { needle: "psycopg", flag: "hasSql" },
    { needle: "sqlalchemy", flag: "hasSql" },
    { needle: "mysql-connector", flag: "hasSql" },
    { needle: "pymysql", flag: "hasSql" },
    { needle: "lib/pq", flag: "hasSql" },
    { needle: "diesel", flag: "hasSql" },
    { needle: "sqlx", flag: "hasSql" },
    { needle: "activerecord", flag: "hasSql" },
    // NoSQL
    { needle: "pymongo", flag: "hasNoSql" },
    { needle: "motor", flag: "hasNoSql" },
    { needle: "mongoid", flag: "hasNoSql" },
    // JWT
    { needle: "pyjwt", flag: "hasJwt" },
    { needle: "golang-jwt", flag: "hasJwt" },
    { needle: "jsonwebtoken", flag: "hasJwt" },
    // XML
    { needle: "lxml", flag: "hasXmlParser" },
    { needle: "xml.etree", flag: "hasXmlParser" },
    { needle: "encoding/xml", flag: "hasXmlParser" },
    { needle: "nokogiri", flag: "hasXmlParser" },
    // YAML
    { needle: "pyyaml", flag: "hasYamlParser" },
    { needle: "gopkg.in/yaml", flag: "hasYamlParser" },
    { needle: "serde_yaml", flag: "hasYamlParser" },
    // GraphQL
    { needle: "graphql", flag: "hasGraphQL" },
    { needle: "graphene", flag: "hasGraphQL" },
    { needle: "strawberry", flag: "hasGraphQL" },
  ];
  for (const { needle, flag } of TEXT_SIGNALS) {
    if (lc.includes(needle)) (profile as unknown as Record<string, unknown>)[flag] = true;
  }
}

function mergeDeps(profile: StackProfile, deps?: Record<string, string>): void {
  if (!deps) return;
  for (const name of Object.keys(deps)) {
    const lc = name.toLowerCase();
    profile.allDeps.add(lc);
    if (SQL_DEPS.has(lc)) profile.hasSql = true;
    if (NOSQL_DEPS.has(lc)) profile.hasNoSql = true;
    if (WEB_FRAMEWORK_DEPS.has(lc)) profile.hasWebFramework = true;
    if (NESTJS_DEPS.has(lc)) {
      profile.hasNestJS = true;
      profile.hasWebFramework = true;
    }
    if (UI_FRAMEWORK_DEPS.has(lc)) profile.hasUiFramework = true;
    if (PAYMENT_WEBHOOK_DEPS.has(lc)) profile.hasPaymentWebhook = true;
    if (JWT_DEPS.has(lc)) profile.hasJwt = true;
    if (TEMPLATING_DEPS.has(lc)) profile.hasTemplating = true;
    if (XML_PARSER_DEPS.has(lc)) profile.hasXmlParser = true;
    if (YAML_PARSER_DEPS.has(lc)) profile.hasYamlParser = true;
    if (GRAPHQL_DEPS.has(lc)) profile.hasGraphQL = true;
    if (SESSION_DEPS.has(lc)) profile.hasSession = true;
    if (FILE_UPLOAD_DEPS.has(lc)) profile.hasFileUpload = true;
  }
}

/** Return the prior P(rule applies | this stack).
 *
 *  Special case: if the stack profile has zero detected dependencies, we
 *  treat the stack as *unknown* (rather than known-empty) and clamp every
 *  prior up to ≥ 0.6. The intent: the stack-aware optimisation should
 *  silently improve precision when we have signal, never *reduce* recall
 *  when we don't.
 */
export function priorForRule(rule: RuleId, profile: StackProfile): number {
  const fn = RULE_PRIORS[rule];
  if (!fn) return 0.5;
  const raw = fn(profile);
  const unknownStack = profile.allDeps.size === 0;
  if (unknownStack) return Math.max(raw, 0.6);
  return raw;
}

/** Return a one-line reason string for why a rule was silenced (UI hint). */
export function silenceReason(rule: RuleId, profile: StackProfile): string | undefined {
  if (rule === "sql-injection" && !profile.hasSql) {
    return "no SQL driver in deps (mysql/pg/sqlite/prisma/typeorm/sequelize) — silenced";
  }
  if (rule === "missing-auth-guard" && !profile.hasNestJS) {
    return "rule is NestJS-specific; @nestjs/core not in deps — silenced";
  }
  if (rule === "jwt-no-verify" && !profile.hasJwt) {
    return "no JWT library in deps — prior reduced (rule still fires on hard matches)";
  }
  if (rule === "weak-webhook-signature" && !profile.hasPaymentWebhook) {
    return "no payment-gateway dep — prior reduced";
  }
  return undefined;
}

/** Default min-posterior threshold below which findings are dropped. */
export const DEFAULT_MIN_POSTERIOR = 0.3;

// ─── Internal: light glob (no external deps) ──────────────────────────

async function glob(
  rootPath: string,
  fs: typeof fsPromises,
  topDirs: string[],
  fileName: string,
  maxDepth: number,
): Promise<string[]> {
  const path = await import("node:path");
  const out: string[] = [];
  for (const top of topDirs) {
    const startDir = path.join(rootPath, top);
    await walk(startDir, fileName, maxDepth, out, fs, path);
  }
  return out;
}

async function walk(
  dir: string,
  fileName: string,
  depthLeft: number,
  out: string[],
  fs: typeof fsPromises,
  path: typeof import("node:path"),
): Promise<void> {
  if (depthLeft < 0) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, fileName, depthLeft - 1, out, fs, path);
    } else if (e.isFile() && e.name === fileName) {
      out.push(full);
    }
  }
}
