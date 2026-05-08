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
  // Crypto
  | "weak-hash"
  | "weak-cipher"
  | "weak-rng"
  | "hardcoded-secret"
  // Injection
  | "sql-injection"
  | "shell-injection"
  | "xss-innerhtml"
  | "xss-eval"
  // Auth
  | "hardcoded-token"
  | "jwt-no-verify"
  | "cors-wildcard-credentials"
  | "missing-auth-guard"
  | "weak-webhook-signature"
  // Financial
  | "money-arithmetic"
  | "money-as-number"
  | "amount-zero-comparison"
  // Web
  | "ssrf"
  | "prototype-pollution"
  | "mass-assignment"
  | "idor-no-ownership-check"
  // Supply chain
  | "dependency-changed"
  // Info leak
  | "logged-secret"
  | "exposed-stack-trace"
  // Concurrency
  | "toctou-race"
  // Privilege
  | "setuid-root";

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
  /** All raw dependency names found, lowercased. */
  allDeps: Set<string>;
}

/** Hand-tuned priors. Format: P(rule fires legitimately | this stack signal). */
const RULE_PRIORS: Record<RuleId, (s: StackProfile) => number> = {
  // SQL injection only matters with a SQL driver. Without one, even "real"
  // matches are almost certainly false positives (string templating in logs,
  // ORM query helpers, NoSQL filter objects that happen to spell "select").
  "sql-injection": (s) => (s.hasSql ? 0.95 : 0.05),
  "shell-injection": () => 0.85, // shell exec is universal
  "xss-innerhtml": (s) => (s.hasUiFramework ? 0.9 : 0.4),
  "xss-eval": () => 0.75,
  "weak-hash": () => 0.85,
  "weak-cipher": () => 0.85,
  "weak-rng": () => 0.7,
  "hardcoded-secret": () => 0.9,
  "hardcoded-token": () => 0.85,
  "jwt-no-verify": (s) => (s.hasJwt ? 0.95 : 0.4),
  "cors-wildcard-credentials": (s) => (s.hasWebFramework ? 0.9 : 0.5),
  "missing-auth-guard": (s) => (s.hasNestJS ? 0.85 : 0.0),
  "weak-webhook-signature": (s) => (s.hasPaymentWebhook ? 0.9 : 0.1),
  "money-arithmetic": () => 0.7,
  "money-as-number": () => 0.7,
  "amount-zero-comparison": () => 0.45,
  ssrf: (s) => (s.hasWebFramework ? 0.85 : 0.4),
  "prototype-pollution": () => 0.75,
  "mass-assignment": (s) => (s.hasWebFramework ? 0.85 : 0.3),
  "idor-no-ownership-check": (s) => (s.hasWebFramework ? 0.7 : 0.1),
  "dependency-changed": () => 0.55,
  "logged-secret": () => 0.75,
  "exposed-stack-trace": () => 0.7,
  "toctou-race": () => 0.5,
  "setuid-root": () => 0.95,
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

/**
 * Read every package.json under a path (workspaces-aware) and build the
 * stack profile. Falls back to scanning common workspace locations if no
 * top-level package.json is found.
 */
export async function detectStackProfile(rootPath: string): Promise<StackProfile> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const profile: StackProfile = {
    sources: [],
    hasSql: false,
    hasNoSql: false,
    hasWebFramework: false,
    hasNestJS: false,
    hasUiFramework: false,
    hasPaymentWebhook: false,
    hasJwt: false,
    hasTemplating: false,
    allDeps: new Set(),
  };

  const candidates = [
    path.join(rootPath, "package.json"),
    ...(await glob(rootPath, fs, ["packages", "apps", "services"], "package.json", 3)),
  ];

  for (const p of candidates) {
    try {
      const txt = await fs.readFile(p, "utf8");
      const pkg = JSON.parse(txt) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
      profile.sources.push(p);
      mergeDeps(profile, pkg.dependencies);
      mergeDeps(profile, pkg.devDependencies);
      mergeDeps(profile, pkg.peerDependencies);
    } catch {
      // file missing or invalid JSON — skip silently
    }
  }
  return profile;
}

/**
 * Build a profile from an inline dependency list. Used for tests +
 * for callers (CLI `--stack`) that pass deps directly.
 */
export function buildStackProfile(deps: string[]): StackProfile {
  const profile: StackProfile = {
    sources: ["<inline>"],
    hasSql: false,
    hasNoSql: false,
    hasWebFramework: false,
    hasNestJS: false,
    hasUiFramework: false,
    hasPaymentWebhook: false,
    hasJwt: false,
    hasTemplating: false,
    allDeps: new Set(),
  };
  const obj: Record<string, string> = {};
  for (const d of deps) obj[d] = "*";
  mergeDeps(profile, obj);
  return profile;
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
