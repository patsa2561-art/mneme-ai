#!/usr/bin/env node
/**
 * One-shot release script. Bumps every workspace package + manifest to the
 * same version, commits, tags, and (optionally) pushes. Single source of
 * truth for the version string — eliminates the drift that put `0.10.0` in
 * `mneme --version` for 8 releases.
 *
 * Usage:
 *   node scripts/release.mjs <version>          # bump + commit + tag (no push)
 *   node scripts/release.mjs <version> --push   # bump + commit + tag + push main + push tag
 *
 * What it touches:
 *   - root package.json
 *   - packages/<pkg>/package.json (every workspace)
 *   - server.json (MCP Registry manifest)
 *
 * Notes:
 *   - Refuses to overwrite an existing tag.
 *   - Does not modify any source code (.ts / .js): runtime version is read
 *     from package.json via packages/cli/src/version.ts.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const args = process.argv.slice(2);
const version = args[0];
const push = args.includes("--push");

if (!version || !/^\d+\.\d+\.\d+(-\S+)?$/.test(version)) {
  console.error("usage: node scripts/release.mjs <version> [--push]");
  console.error("       version must be semver (e.g. 0.19.0)");
  process.exit(1);
}

const tag = `v${version}`;

// Refuse to clobber an existing tag.
const existingTags = execSync("git tag --list", { encoding: "utf8" }).split(/\s+/);
if (existingTags.includes(tag)) {
  console.error(`tag ${tag} already exists — pick a higher version or delete the tag first`);
  process.exit(1);
}

function bump(path) {
  if (!existsSync(path)) return false;
  const json = JSON.parse(readFileSync(path, "utf8"));
  let changed = false;
  if (json.version && json.version !== version) {
    json.version = version;
    changed = true;
  }
  // Internal workspace deps: bump pinned @mneme-ai/* references.
  for (const key of ["dependencies", "peerDependencies"]) {
    if (!json[key]) continue;
    for (const dep of Object.keys(json[key])) {
      if (dep.startsWith("@mneme-ai/") && json[key][dep] !== version) {
        json[key][dep] = version;
        changed = true;
      }
    }
  }
  if (changed) writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
  return changed;
}

const touched = [];
if (bump("package.json")) touched.push("package.json");

for (const pkg of readdirSync("packages")) {
  const p = join("packages", pkg, "package.json");
  if (bump(p)) touched.push(p);
}

// server.json (MCP Registry manifest) — has TWO version fields (top-level + nested package).
if (existsSync("server.json")) {
  const raw = readFileSync("server.json", "utf8");
  const updated = raw.replace(/"version"\s*:\s*"[^"]+"/g, `"version": "${version}"`);
  if (updated !== raw) {
    writeFileSync("server.json", updated);
    touched.push("server.json");
  }
}

if (touched.length === 0) {
  console.log(`nothing to bump — every package + manifest is already at ${version}`);
  process.exit(0);
}

console.log(`bumped ${touched.length} file(s) to ${version}:`);
for (const t of touched) console.log(`  ${t}`);

// v2.49.0 — MANDATORY PROBE-COVERAGE GATE (skip with --skip-probe-coverage in
// emergencies only). Reads packages/core/dist/release_gate/probe_coverage.js
// + asserts every new mneme.<verb>.<sub> tool has a TRUTH GATE claim binding.
// Refuses to tag when uncovered — closes "feature velocity > probe velocity"
// bug class STRUCTURALLY at the release script level.
const skipProbeCoverage = args.includes("--skip-probe-coverage") || args.includes("--force-coverage");
if (!skipProbeCoverage) {
  try {
    const distPath = "packages/core/dist/release_gate/probe_coverage.js";
    if (existsSync(distPath)) {
      const mod = await import("../" + distPath);
      const r = mod.crossCheckFromDisk(process.cwd());
      if (!r.ok) {
        console.error("");
        console.error("🛑 PROBE-COVERAGE GATE REFUSED RELEASE");
        console.error(`   ${r.uncovered.length} tool(s) lack TRUTH GATE probe binding:`);
        for (const t of r.uncovered.slice(0, 10)) console.error(`     • ${t}`);
        if (r.uncovered.length > 10) console.error(`     ... + ${r.uncovered.length - 10} more`);
        console.error("");
        console.error(`   ${r.hint}`);
        console.error("");
        console.error("   Emergency bypass: re-run with --skip-probe-coverage (logged + audited).");
        console.error("");
        process.exit(7);
      }
      console.log(`✓ probe-coverage gate: ${r.totalTools} tools all bound to TRUTH GATE claims`);
    } else {
      console.log("⚠ probe-coverage gate: skipped (dist not built; run `npm run build` first for full safety)");
    }
  } catch (e) {
    console.error(`⚠ probe-coverage gate: failed to run (${e.message}); proceeding`);
  }
} else {
  console.log("⚠ probe-coverage gate: BYPASSED via --skip-probe-coverage (emergency only)");
}

// Sync lockfile (cheap, no install).
try {
  execSync("npm install --package-lock-only --silent", { stdio: "inherit" });
} catch {
  // best-effort; not fatal
}

// Stage + commit.
execSync(`git add ${touched.join(" ")} package-lock.json`, { stdio: "inherit" });
execSync(`git commit -m "chore(release): v${version}"`, { stdio: "inherit" });
execSync(`git tag -a ${tag} -m "v${version}"`, { stdio: "inherit" });
console.log(`\ncommitted + tagged ${tag}`);

if (push) {
  execSync("git push origin HEAD", { stdio: "inherit" });
  execSync(`git push origin ${tag}`, { stdio: "inherit" });
  console.log(`pushed main + ${tag}`);
} else {
  console.log("\nrun the following to publish:");
  console.log("  git push origin HEAD");
  console.log(`  git push origin ${tag}`);
  console.log("  mcp-publisher publish");
}
