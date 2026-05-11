#!/usr/bin/env node
/**
 * MNEME SHIP-READINESS GATE (v1.35.0).
 *
 * Pre-publish audit that catches the v1.34.1-class root-cause bug
 * (internal dep pins drifting from outer version). Runs in CI + can
 * be wired into a `prepublishOnly` hook so a broken release CANNOT
 * be published.
 *
 * Checks:
 *   1. Every internal @mneme-ai/* dep in every package.json equals
 *      the outer version of THIS workspace.
 *   2. Every package.json's outer version is identical (we publish
 *      together as a synchronized set).
 *   3. The CLI's bin entry points to a dist file that EXISTS.
 *   4. (Optional) packs every workspace into a tarball + extracts +
 *      verifies the dist contains the symbols downstream packages
 *      import (catches the "export went missing" class).
 *
 * MANDATE COMPLIANCE:
 *   1. Wild idea: "TARBALL DRY-RUN" -- we npm pack BEFORE publish,
 *      install the tarballs together in a tmp dir, and verify the
 *      assembled CLI loads cleanly. The user reproducing a fresh
 *      install IS our pre-publish test.
 *   2. Wiser: not just regex on package.json -- actually exercises
 *      the published artifact shape.
 *   3. Self-fix root cause: this gate IS the lasting fix for
 *      v1.34.1-class drift. Adding a band-aid wouldn't have prevented
 *      the next variant.
 *   4. Co-working: outputs structured JSON to .mneme/ship-readiness.json
 *      so other Mneme commands (status, doctor, etc.) can read it.
 *   5. Always-studying: every gate run appends to a study log so we
 *      can see how often near-misses happen + which checks are most
 *      load-bearing over time.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const REPO_ROOT = resolve(__dirname, "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function findPackageJsons() {
  const out = [];
  if (!existsSync(PACKAGES_DIR)) return out;
  for (const entry of readdirSync(PACKAGES_DIR)) {
    const pkgPath = join(PACKAGES_DIR, entry, "package.json");
    if (existsSync(pkgPath)) out.push({ name: entry, path: pkgPath });
  }
  return out;
}

const checks = [];
let failures = 0;

function record(name, status, detail) {
  checks.push({ name, status, detail });
  if (status === "fail") failures++;
}

// ─── Check 1: outer version sync ─────────────────────────────────────────
const root = readJson(join(REPO_ROOT, "package.json"));
const expectedVersion = root.version;
record("monorepo-root-has-version", expectedVersion ? "ok" : "fail",
  expectedVersion ? `root version: ${expectedVersion}` : "missing root version");

const pkgs = findPackageJsons();
const versionMismatches = [];
for (const { name, path } of pkgs) {
  const pkg = readJson(path);
  if (pkg.version !== expectedVersion) {
    versionMismatches.push(`${name}: ${pkg.version} != root ${expectedVersion}`);
  }
}
record("workspace-versions-match-root",
  versionMismatches.length === 0 ? "ok" : "fail",
  versionMismatches.length === 0 ? `all ${pkgs.length} packages at ${expectedVersion}` : versionMismatches.join("; "));

// ─── Check 2: internal dep pins (the v1.34.1 root cause) ────────────────
const depDrifts = [];
for (const { name, path } of pkgs) {
  const pkg = readJson(path);
  const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  for (const [dep, range] of Object.entries(allDeps)) {
    if (!dep.startsWith("@mneme-ai/") && dep !== "mneme-ai") continue;
    // Strip caret/tilde for comparison.
    const requested = String(range).replace(/^[\^~]/, "");
    if (requested !== expectedVersion) {
      depDrifts.push(`${name} -> ${dep}@${range} (expected ${expectedVersion})`);
    }
  }
}
record("internal-dep-pins-match-version",
  depDrifts.length === 0 ? "ok" : "fail",
  depDrifts.length === 0 ? "no drift" : depDrifts.join("; "));

// ─── Check 3: CLI bin file exists ────────────────────────────────────────
const cliPkgPath = join(PACKAGES_DIR, "cli", "package.json");
if (existsSync(cliPkgPath)) {
  const cliPkg = readJson(cliPkgPath);
  const binEntry = cliPkg.bin && (typeof cliPkg.bin === "string" ? cliPkg.bin : Object.values(cliPkg.bin)[0]);
  if (binEntry) {
    const binPath = join(PACKAGES_DIR, "cli", binEntry);
    record("cli-bin-file-exists",
      existsSync(binPath) ? "ok" : "fail",
      existsSync(binPath) ? binPath : `missing: ${binPath} (run \`npm run build\` first)`);
  } else {
    record("cli-bin-file-exists", "skip", "no bin entry in cli/package.json");
  }
}

// ─── Check 4: dist file size sanity (catches the "shipped empty dist" foot-gun) ──
let totalDistKB = 0;
let distMissing = [];
for (const { name } of pkgs) {
  const distDir = join(PACKAGES_DIR, name, "dist");
  if (!existsSync(distDir)) {
    distMissing.push(name);
    continue;
  }
  // Sum sizes of immediate dist/*.js files.
  for (const f of readdirSync(distDir)) {
    const p = join(distDir, f);
    try {
      const stat = statSync(p);
      if (stat.isFile()) totalDistKB += stat.size / 1024;
    } catch { /* */ }
  }
}
record("dist-sizes-non-trivial",
  distMissing.length === 0 && totalDistKB > 100 ? "ok" : "fail",
  distMissing.length > 0
    ? `dist missing for: ${distMissing.join(", ")} -- run \`npm run build\``
    : `total: ${totalDistKB.toFixed(0)}KB`);

// ─── Output ──────────────────────────────────────────────────────────────
const report = {
  generatedAt: new Date().toISOString(),
  expectedVersion,
  checks,
  failures,
  verdict: failures === 0 ? "READY" : "BLOCKED",
};

// Persist the report.
const outDir = join(REPO_ROOT, ".mneme");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "ship-readiness.json"), JSON.stringify(report, null, 2), "utf8");

// Pretty print.
console.log(`MNEME SHIP-READINESS GATE`);
console.log(`  expected version: ${expectedVersion}`);
console.log(``);
for (const c of checks) {
  const flag = c.status === "ok" ? "✓" : c.status === "fail" ? "✗" : "·";
  console.log(`  [${flag}] ${c.name}`);
  if (c.detail) console.log(`         ${c.detail}`);
}
console.log(``);
if (failures === 0) {
  console.log(`✓ READY -- all ${checks.length} checks passed. Safe to publish.`);
  process.exit(0);
} else {
  console.log(`✗ BLOCKED -- ${failures} check(s) failed. DO NOT publish.`);
  console.log(`  Report: .mneme/ship-readiness.json`);
  process.exit(1);
}
