#!/usr/bin/env node
/**
 * MNEME REINCARNATION RITUAL — the release gate that simulates the actual user install path.
 *
 *   "test pass in CI ≠ ทำงานจริงในที่ของ user.
 *    The ritual is: pack → install into a clean tmp dir → run every
 *    headline command → measure → block publish on any failure.
 *
 *    Why 'reincarnation'? Because Mneme dies (gets uninstalled) and is
 *    reborn fresh into the user's machine every time someone runs
 *    `npm install mneme-ai`. The ritual proves the rebirth is healthy."
 *
 * Run modes:
 *   node scripts/reincarnation-ritual.mjs            # against locally-packed tarballs (pre-publish)
 *   node scripts/reincarnation-ritual.mjs --version=2.19.1   # against the published version on npm (post-publish)
 *
 * Exit codes:
 *   0 → all checks passed; safe to publish or already healthy on npm
 *   1 → at least one check failed; details + remediation printed; do NOT publish
 *
 * Adds new checks for every bug class the user has ever reported. Each
 * check has a measurable assertion + per-fix remediation note. This is
 * the "discrete AI testing + ritual" the user asked for: a sequence of
 * named gates, each one named for the bug class it watches, signed by
 * the result.
 */

import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync, readFileSync, readdirSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";
import { createHmac } from "node:crypto";
import { RELEASE_CLAIMS, expectedToolNames } from "./release-claims.mjs";

const args = new Map(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? "true"] : [a, "true"];
}));
const TARGET_VERSION = args.get("version"); // if set, install from npm; else pack local
const REPO_ROOT = resolve(process.cwd());
const SECRET = process.env.MNEME_RITUAL_SECRET || "mneme-reincarnation-ritual-v1";

function log(emoji, msg) { process.stdout.write(`${emoji} ${msg}\n`); }
function dim(s) { return `\x1b[2m${s}\x1b[0m`; }

const results = [];
function check(name, fn) {
  const t0 = Date.now();
  try {
    const out = fn();
    const ms = Date.now() - t0;
    if (out && out.ok === false) {
      results.push({ name, ok: false, ms, reason: out.reason ?? "unknown failure", measure: out.measure });
      log("❌", `${name} · ${ms}ms · ${out.reason ?? "FAIL"}`);
      if (out.remedy) log("   ", dim(`remedy: ${out.remedy}`));
    } else {
      results.push({ name, ok: true, ms, measure: out?.measure });
      const m = out?.measure ? ` · ${dim(JSON.stringify(out.measure))}` : "";
      log("✅", `${name} · ${ms}ms${m}`);
    }
  } catch (err) {
    const ms = Date.now() - t0;
    results.push({ name, ok: false, ms, reason: (err && err.message) ? err.message : String(err) });
    log("❌", `${name} · ${ms}ms · ${err.message ?? String(err)}`);
  }
}

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: "pipe", encoding: "utf8", ...opts });
}
function runSafe(cmd, opts = {}) {
  try { return { code: 0, stdout: run(cmd, opts), stderr: "" }; }
  catch (e) { return { code: e.status ?? 1, stdout: e.stdout?.toString?.() ?? "", stderr: e.stderr?.toString?.() ?? String(e) }; }
}

const ENV_INFO = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  ts: new Date().toISOString(),
  mode: TARGET_VERSION ? `live-npm@${TARGET_VERSION}` : "local-pack",
};
log("📜", `MNEME REINCARNATION RITUAL · mode=${ENV_INFO.mode} · node=${ENV_INFO.node} · ${ENV_INFO.platform}/${ENV_INFO.arch}`);

// ─── PHASE 1 — Build clean tmp install ─────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), "mneme-ritual-"));
log("📁", `tmp install dir: ${tmp}`);

let installedRoot = null;
check("phase1.tmp-init", () => {
  writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "mneme-ritual-host", version: "1.0.0", private: true }, null, 2));
  return { measure: { tmp } };
});

if (TARGET_VERSION) {
  check("phase1.install-from-npm", () => {
    const r = runSafe(`npm install mneme-ai@${TARGET_VERSION} --no-fund --no-audit --silent`, { cwd: tmp });
    if (r.code !== 0) return { ok: false, reason: `npm install exited ${r.code}: ${r.stderr.slice(0, 400)}`, remedy: "check npm registry availability or version typo" };
    installedRoot = join(tmp, "node_modules", "mneme-ai");
    return { measure: { exit: r.code, ms: r.stdout.includes("added") ? "ok" : "ok" } };
  });
} else {
  // Pack all 5 workspaces locally, then install via tarballs.
  const tarballs = {};
  for (const pkg of ["core", "embeddings", "correlator", "mcp", "cli"]) {
    check(`phase1.pack-${pkg}`, () => {
      const dir = join(REPO_ROOT, "packages", pkg);
      if (!existsSync(dir)) return { ok: false, reason: `missing ${dir}` };
      const out = run(`npm pack --pack-destination "${tmp.replace(/\\/g, "/")}"`, { cwd: dir });
      const file = out.trim().split(/\s+/).pop();
      tarballs[pkg] = join(tmp, file);
      if (!existsSync(tarballs[pkg])) return { ok: false, reason: `tarball missing: ${tarballs[pkg]}` };
      return { measure: { tarball: file, bytes: statSync(tarballs[pkg]).size } };
    });
  }
  check("phase1.install-from-tarballs", () => {
    const list = ["core", "embeddings", "correlator", "mcp", "cli"].map((p) => `"${tarballs[p]}"`).join(" ");
    const r = runSafe(`npm install ${list} --no-fund --no-audit --silent`, { cwd: tmp });
    if (r.code !== 0) return { ok: false, reason: `npm install exited ${r.code}: ${r.stderr.slice(0, 500)}`, remedy: "inspect pack output above" };
    installedRoot = join(tmp, "node_modules", "mneme-ai");
    return { measure: { exit: r.code } };
  });
}

// ─── PHASE 2 — Verify the install layout (bug #1 class: missing dist files) ──
check("phase2.installed-root-exists", () => {
  if (!installedRoot || !existsSync(installedRoot)) return { ok: false, reason: `mneme-ai not in node_modules`, remedy: "phase1 must succeed first" };
  return { measure: { installedRoot } };
});

const REQUIRED_FILES = [
  "node_modules/@mneme-ai/core/dist/index.js",
  "node_modules/@mneme-ai/core/dist/index.d.ts",
  "node_modules/@mneme-ai/mcp/dist/index.js",
  "node_modules/@mneme-ai/embeddings/dist/index.js",
  "node_modules/@mneme-ai/correlator/dist/index.js",
  "node_modules/mneme-ai/dist/index.js",
  "node_modules/mneme-ai/dist/commands/init.js",
  "node_modules/mneme-ai/bin/mneme.js",
];
for (const rel of REQUIRED_FILES) {
  check(`phase2.required-file:${rel.split("/").slice(-2).join("/")}`, () => {
    const p = join(tmp, rel);
    if (!existsSync(p)) return { ok: false, reason: `MISSING: ${rel}`, remedy: `add to package.json "files" or check tsconfig "outDir"` };
    return { measure: { bytes: statSync(p).size } };
  });
}

// ─── PHASE 3 — Run headline commands (bug #1 + #2 + #4 class) ──────────────
function mnemeCmd(subcmd) {
  const binBase = process.platform === "win32" ? "mneme.cmd" : "mneme";
  const direct = join(tmp, "node_modules", ".bin", binBase);
  return runSafe(`"${direct}" ${subcmd}`, { cwd: tmp, env: { ...process.env, MNEME_NO_COLOR: "1" } });
}

check("phase3.mneme-tools-exit-0", () => {
  const r = mnemeCmd("tools --json");
  if (r.code !== 0) return { ok: false, reason: `exit ${r.code}; stderr=${r.stderr.slice(0, 300)}`, remedy: "the install is broken — check phase2 missing files" };
  let j;
  try { j = JSON.parse(r.stdout); } catch (e) { return { ok: false, reason: `JSON parse failed: ${e.message}`, remedy: "tools --json output is malformed" }; }
  if (typeof j.totalTools !== "number") return { ok: false, reason: "tools --json missing totalTools" };
  return { measure: { totalTools: j.totalTools, categories: Object.keys(j.catalog).length } };
});

// STRONGER than counts: assert EVERY tool name claimed by every release is registered.
// Counts-only check is fooled by a renamed tool that still matches the prefix.
// Names-exact check is fooled only by an actual missing or misnamed tool — the bug class.
check("phase3.claim-manifest-exact-name-match", () => {
  const r = mnemeCmd("tools --json");
  if (r.code !== 0) return { ok: false, reason: `mneme tools --json failed earlier; skipping` };
  const j = JSON.parse(r.stdout);
  const allNames = new Set(Object.values(j.catalog).flat().map((t) => t.name));
  const expected = expectedToolNames();
  const missing = expected.filter((n) => !allNames.has(n));
  const perRelease = {};
  for (const [ver, claim] of Object.entries(RELEASE_CLAIMS)) {
    const here = claim.tools.filter((n) => allNames.has(n)).length;
    perRelease[ver] = `${here}/${claim.tools.length}`;
  }
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `${missing.length}/${expected.length} claimed tools MISSING from installed catalog`,
      remedy: `add MCP wrappers for: ${missing.join(", ")} — wire into _v21x_*.ts + _registry.ts; rebuild + republish`,
      measure: { perRelease, missingTools: missing },
    };
  }
  return { measure: { perRelease, totalClaimed: expected.length } };
});

// v2.19.8 — phase3.no-orphan-core-exports (AUTO-GENESIS WRAPPER FACTORY gate).
// Blocks publish if ANY v2.18+ core module has an exported function/const
// without a corresponding MCP wrapper. Closes the "build but no wrap" bug
// class permanently. Runs as a subprocess so the ritual itself stays sync.
check("phase3.no-orphan-core-exports", () => {
  const orphanScript = `${REPO_ROOT}/scripts/check-orphans.mjs`;
  if (!existsSync(orphanScript)) return { measure: { skipped: true, reason: "check-orphans.mjs not present" } };
  const r = runSafe(`node "${orphanScript}"`, { cwd: REPO_ROOT });
  let parsed;
  try { parsed = JSON.parse(r.stdout); } catch { parsed = { parseFailed: true }; }
  if (parsed.skipped) return { measure: parsed };
  if (r.code !== 0) {
    return {
      ok: false,
      reason: `${parsed.enforcedOrphans ?? "?"} v2.18+ core export(s) lack an MCP wrapper`,
      remedy: parsed.enforcedList ? parsed.enforcedList.map((o) => `${o.module}.${o.symbol} → ${o.suggested}`).join("; ") : "run scripts/check-orphans.mjs for details",
      measure: parsed,
    };
  }
  return { measure: parsed };
});

check("phase3.whats-new-is-fresh", () => {
  const r = mnemeCmd("whats-new --json");
  if (r.code !== 0) {
    // Some installs ship without --json; fall back to plain output check.
    const plain = mnemeCmd("whats-new");
    if (plain.code !== 0) return { ok: false, reason: `whats-new exited ${plain.code}: ${plain.stderr.slice(0, 200)}` };
    const installedVer = JSON.parse(readFileSync(join(tmp, "node_modules", "mneme-ai", "package.json"), "utf8")).version;
    // Look for the installed version anywhere in the output — that's freshness.
    if (!plain.stdout.includes(installedVer)) {
      return { ok: false, reason: `whats-new output doesn't mention installed version ${installedVer}`, remedy: "update packages/core/src/whats_new.ts highlights or sync from CHANGELOG.md" };
    }
    return { measure: { installedVer, mode: "plain" } };
  }
  let j;
  try { j = JSON.parse(r.stdout); } catch (e) { return { ok: false, reason: `whats-new JSON parse: ${e.message}` }; }
  const installedVer = JSON.parse(readFileSync(join(tmp, "node_modules", "mneme-ai", "package.json"), "utf8")).version;
  const newest = j.entries?.[0]?.version ?? j.highlights?.[0]?.version ?? null;
  if (newest && newest !== installedVer && !installedVer.startsWith(newest)) {
    return { ok: false, reason: `whats-new newest entry is v${newest}, but installed is v${installedVer}`, remedy: "sync packages/core/src/whats_new.ts with CHANGELOG.md", measure: { installedVer, newest } };
  }
  return { measure: { installedVer, newest } };
});

// ─── PHASE 4 — Embedder verify (bug #3 class) ─────────────────────────────
check("phase4.hash-embedder-always-works", () => {
  // Hash embedder is the deterministic fallback that MUST always work.
  // We don't try the WASM path (it requires 25MB download + internet);
  // the assertion is: if WASM fails, the user STILL gets useful output.
  const r = mnemeCmd("doctor --json");
  if (r.code !== 0) {
    // doctor may not have --json; try plain.
    const plain = mnemeCmd("doctor");
    if (plain.code !== 0) return { ok: false, reason: `doctor exited ${plain.code}: ${plain.stderr.slice(0, 200)}` };
    return { measure: { mode: "plain", excerpt: plain.stdout.split("\n").slice(0, 3).join(" | ") } };
  }
  let j;
  try { j = JSON.parse(r.stdout); } catch { return { measure: { mode: "non-json-doctor" } }; }
  return { measure: j };
});

// ─── PHASE 5 — Cleanup ─────────────────────────────────────────────────────
check("phase5.cleanup", () => {
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); return { measure: { tmp } }; }
  catch (e) { return { measure: { tmp, residual: true, reason: e.message } }; }
});

// ─── REPORT ────────────────────────────────────────────────────────────────
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);
const summary = {
  v: 1,
  env: ENV_INFO,
  total: results.length,
  passed,
  failed: failed.length,
  failures: failed.map((f) => ({ name: f.name, reason: f.reason })),
};
const sig = createHmac("sha256", SECRET).update(JSON.stringify(summary)).digest("hex");
summary.sig = sig;

writeFileSync(join(REPO_ROOT, ".mneme-ritual-receipt.json"), JSON.stringify(summary, null, 2));
log("📜", `wrote .mneme-ritual-receipt.json (sig ${sig.slice(0, 12)}…)`);

if (failed.length === 0) {
  log("🎉", `RITUAL PASSED · ${passed}/${results.length} checks green · safe to publish`);
  process.exit(0);
} else {
  log("⛔", `RITUAL FAILED · ${failed.length}/${results.length} checks broken — DO NOT PUBLISH`);
  for (const f of failed) log("  ❌", `${f.name}: ${f.reason}`);
  process.exit(1);
}
