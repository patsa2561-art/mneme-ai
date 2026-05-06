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
