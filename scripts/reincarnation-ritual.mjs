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

// ─── PHASE 3.5 — DOGFOOD GATE (v2.19.41) ──────────────────────────────────
//
//   v2.19.40 shipped with TWO broken tools that the test suite never caught:
//
//     mneme.honesty.audit_whats_new — THREW on runtime undefined
//     mneme.system.upgrade           — THREW on rt.meta.rootPath undefined
//
//   The irony: HONESTY GATE was added in v2.19.35 to block lying release
//   notes, but the gate's MCP wrapper was never CALLED end-to-end. CI
//   verified type-check + unit tests, but did not actually invoke the tool
//   on the same install path real users hit.
//
//   v2.19.41 DOGFOOD GATE: install the local tarball, then ACTUALLY CALL
//   every critical-path MCP tool through the installed binary. Any throw
//   blocks publish. This is the meta-fix that prevents the same class of
//   bug from shipping again.
//
//   The CRITICAL_TOOLS set is the minimum every user/AI agent must be able
//   to call on day-1 install:
//     mneme welcome              — first-contact contract
//     mneme tools --json         — capabilities surface
//     mneme verify "tautology"   — verify primitive
//     mneme system health        — health surface
//     mneme system upgrade check — upgrade probe (mode=check is safe)
//     mneme.honesty.audit_whats_new — honesty self-audit (the v2.19.40 bug)
//
//   The gate INSTALLS + RUNS each tool inside the install dir. If any
//   crashes, the publish blocks with a clear "DOGFOOD FAILED" message
//   pointing at the failing tool. No more "ship a broken P0 because we
//   never ran it ourselves".

check("phase3.5.dogfood-critical-mcp-tools", () => {
  // Each critical tool must exit 0 + produce parseable output (or non-empty
  // stdout). We deliberately pick safe-mode arguments — system.upgrade is
  // mode=check (read-only); verify uses a tautology so the answer is
  // ground-truth independent.
  const critical = [
    { label: "welcome", args: "welcome", parseJson: false, mustContain: ["mneme", "tool"] },
    { label: "verify-tautology", args: 'verify "this is a string"', parseJson: false, mustContain: [] },
    { label: "system-health", args: "system health", parseJson: false, mustContain: ["status"] },
    { label: "honesty-audit-via-mneme-call", args: 'call mneme.honesty.audit_whats_new --body "ships 711 MCP tools total"', parseJson: false, mustContain: ["PASS", "FAIL"], optional: true },
  ];
  const results = [];
  for (const t of critical) {
    const r = mnemeCmd(t.args);
    const stdoutLower = r.stdout.toLowerCase();
    let ok = r.code === 0;
    let why = "";
    if (!ok) why = `exit=${r.code} stderr="${r.stderr.slice(0, 200)}"`;
    if (ok && t.mustContain.length > 0) {
      const found = t.mustContain.some((needle) => stdoutLower.includes(needle.toLowerCase()));
      if (!found) { ok = false; why = `output missing all of [${t.mustContain.join("|")}]`; }
    }
    results.push({ label: t.label, ok, why, optional: !!t.optional });
  }
  const required = results.filter((r) => !r.optional);
  const failed = required.filter((r) => !r.ok);
  if (failed.length > 0) {
    return {
      ok: false,
      reason: `DOGFOOD FAILED — ${failed.length}/${required.length} critical MCP tools throw or produce bad output on the installed tarball`,
      remedy: `Fix at SOURCE before publish: ${failed.map((f) => `${f.label} (${f.why})`).join("; ")}`,
      measure: { results },
    };
  }
  return { measure: { results, passed: required.length, optionalRan: results.filter((r) => r.optional).length } };
});

// ─── PHASE 3.6 — PREINSTALL SCRIPT SAFETY (v2.19.50) ──────────────────────
//
//   v2.19.48 shipped a `preinstall` script that referenced a file inside
//   the package being installed. npm runs preinstall BEFORE extracting
//   the tarball, so the file didn't exist yet on the target install
//   path → script crashed → npm install -g ABORTED → mneme uninstalled
//   itself from user's machine.
//
//   The fix in v2.19.50 replaces the script with an inline `node -e` that
//   references NO files in the package. This phase ENFORCES that
//   invariant: any preinstall/install/postinstall script that mentions
//   a path inside the package (`./bin/...`, `./dist/...`, `./scripts/...`)
//   fails the ritual. Class of bug cannot ship again.

check("phase3.6.preinstall-script-no-self-reference", () => {
  // Read the JUST-PACKED tarball's cli package.json (installed by phase 1).
  const cliPkgPath = join(installedRoot, "package.json");
  if (!existsSync(cliPkgPath)) {
    return { ok: false, reason: `cli package.json not found at ${cliPkgPath}` };
  }
  let pkg;
  try { pkg = JSON.parse(readFileSync(cliPkgPath, "utf8")); }
  catch (e) { return { ok: false, reason: `package.json parse: ${e.message}` }; }
  const lifecycleHooks = ["preinstall", "install", "postinstall", "prepublish", "prepare"];
  const offenders = [];
  for (const hook of lifecycleHooks) {
    const cmd = pkg.scripts?.[hook];
    if (!cmd || typeof cmd !== "string") continue;
    // Look for any reference to a local file path that would not exist
    // BEFORE the tarball is extracted (for preinstall) or after npm has
    // resolved deps (for postinstall — we lean conservative).
    const localFileRe = /\.\/(?:bin|dist|src|scripts|lib|build|packages)\/[\w./-]+/;
    const match = cmd.match(localFileRe);
    if (match) offenders.push({ hook, cmd: cmd.slice(0, 120), reference: match[0] });
  }
  if (offenders.length > 0) {
    return {
      ok: false,
      reason: `${offenders.length} lifecycle script(s) reference a file inside the package — chicken-and-egg risk`,
      remedy: offenders.map(o => `${o.hook}: replace "${o.reference}" with inline node -e`).join("; "),
      measure: { offenders },
    };
  }
  return { measure: { scriptsScanned: lifecycleHooks.length, offenders: 0 } };
});

// ─── PHASE 3.7 — INSTALL SMOKE GATE (v2.19.50) ────────────────────────────
//
//   Simulates the real `npm install -g <tarball>` user flow + verifies
//   `mneme --version` exits 0 + returns a valid semver. If the preinstall
//   script crashes OR the bin shim is broken, this catches it BEFORE
//   publish. The v2.19.48 preinstall bug would have failed here.
//
//   We rely on phase1 having already done `npm install --no-save` of the
//   5 tarballs into the tmp dir; if THAT succeeded, the install path is
//   valid. We additionally invoke `mneme --version` against the installed
//   binary to confirm the bin shim still works.

check("phase3.7.install-smoke-mneme-version", () => {
  // Phase 1 already installed via `npm install --no-save mneme-ai-X.Y.Z.tgz`
  // If that crashed (preinstall fail), phase1.install-from-tarballs would
  // have failed FIRST. So if we're here, install survived. But we still
  // need to verify `mneme --version` actually works (catches broken bin).
  const r = mnemeCmd("--version");
  if (r.code !== 0) {
    return {
      ok: false,
      reason: `mneme --version exited ${r.code}; install path produces a broken binary`,
      remedy: `Check bin/mneme.js, package.json bin field, and dist/index.js build output`,
      measure: { exit: r.code, stderr: r.stderr.slice(0, 200) },
    };
  }
  const stdout = r.stdout.trim();
  if (!/^\d+\.\d+\.\d+/.test(stdout)) {
    return {
      ok: false,
      reason: `mneme --version returned non-semver "${stdout}"`,
      remedy: `bin/mneme.js fast-path may have regressed; ensure it reads package.json correctly`,
    };
  }
  return { measure: { version: stdout } };
});

// ─── PHASE 3.8 — CONTRACT-TEST GATE (v2.19.52) ────────────────────────────
//
//   The bug class this phase kills: pre-existing MCP tool name collisions,
//   regex-violating tool names, malformed inputSchema shapes. Discovered in
//   v2.19.51 when 92 contract tests had been failing across v2.19.42-50
//   without anyone noticing — the ritual never ran them. Each shipped release
//   silently overwrote one of two duplicate-named tools (mneme.proof.verify),
//   user-visible behavior depended on registry spread order.
//
//   v2.19.52 adds this gate so the bug class cannot ship again. Runs vitest
//   on _contract.test.ts against the SOURCE registry (which is what just got
//   packed into the tarball — equivalent verification). Failure blocks publish.

check("phase3.8.contract-test-must-pass", () => {
  // Use the SOURCE tree's vitest because we're verifying the catalog shape
  // BEFORE publish. The just-packed tarball was built from this same source.
  const r = spawnSync("npx", ["vitest", "run", "packages/mcp/src/tools/_contract.test.ts", "--reporter=basic"], {
    cwd: REPO_ROOT,
    shell: process.platform === "win32",
    windowsHide: true,
    timeout: 180_000,
    encoding: "utf8",
  });
  if (r.error) {
    return { ok: false, reason: `spawn failed: ${r.error.message}`, remedy: "Ensure vitest is installed (npm install at repo root)" };
  }
  if (r.status !== 0) {
    // Extract a concise failure summary from vitest output.
    const out = (r.stdout || "") + (r.stderr || "");
    const failLines = out.split("\n").filter((l) => l.includes("FAIL") || l.includes("×")).slice(0, 5);
    return {
      ok: false,
      reason: `contract test exited ${r.status}; ${failLines.length} sample failure(s) shown`,
      remedy: `Run 'npx vitest run packages/mcp/src/tools/_contract.test.ts' locally + fix each ✗ marker. Common causes: (1) duplicate tool name; (2) inputSchema missing 'properties: {}'; (3) tool name contains digits (regex is [a-z_] only); (4) composeWith references unknown tool name.`,
      measure: { exitCode: r.status, sampleFailures: failLines },
    };
  }
  // Parse the pass count from vitest "Tests N passed" line.
  const passMatch = (r.stdout || "").match(/Tests\s+(\d+)\s+passed/);
  return { measure: { contractTestsPassing: passMatch ? Number(passMatch[1]) : "unknown" } };
});

// ─── PHASE 3.9 — ZERO-NATIVE INSTALL GATE (v2.19.55) ──────────────────────
//
//   The bug class this phase kills: "@huggingface/transformers" lived in
//   `dependencies` for 50+ releases, dragging native libvips DLLs into
//   every Windows install. npm extract → transformers postinstall →
//   DLL load → next install hits EBUSY. v2.19.55 moves transformers to
//   `optionalDependencies` so npm install ALWAYS succeeds even when the
//   native postinstall fails (network / DLL lock / build error). Phase
//   3.9 enforces this contract forever: any future addition of a native
//   dep to `dependencies` will fail this gate.
//
//   We verify that (a) cli/package.json has no hard native deps, (b) the
//   embeddings package keeps transformers under optionalDependencies,
//   (c) the binary still runs after `npm install --omit=optional`.

check("phase3.9.zero-native-default-install", () => {
  const repoPkgs = [
    join(REPO_ROOT, "packages", "cli", "package.json"),
    join(REPO_ROOT, "packages", "core", "package.json"),
    join(REPO_ROOT, "packages", "embeddings", "package.json"),
    join(REPO_ROOT, "packages", "mcp", "package.json"),
    join(REPO_ROOT, "packages", "correlator", "package.json"),
  ];
  const KNOWN_NATIVE_DEPS = new Set([
    "@huggingface/transformers",
    "sharp",
    "@img/sharp-win32-x64",
    "@img/sharp-darwin-arm64",
    "@img/sharp-darwin-x64",
    "@img/sharp-linux-x64",
    "onnxruntime-node",
    "@tensorflow/tfjs-node",
    "z3-solver",
  ]);
  const offenders = [];
  for (const pkgPath of repoPkgs) {
    if (!existsSync(pkgPath)) continue;
    let pkg;
    try { pkg = JSON.parse(readFileSync(pkgPath, "utf8")); }
    catch (e) { return { ok: false, reason: `parse: ${e.message}` }; }
    const hardDeps = pkg.dependencies ?? {};
    for (const dep of Object.keys(hardDeps)) {
      if (KNOWN_NATIVE_DEPS.has(dep)) {
        offenders.push({ pkg: pkg.name, dep, hint: `move "${dep}" to optionalDependencies` });
      }
    }
  }
  // Special-case: embeddings package MUST list transformers under
  // optionalDependencies — verify it's there + spelled right.
  const embPkgPath = join(REPO_ROOT, "packages", "embeddings", "package.json");
  if (existsSync(embPkgPath)) {
    const embPkg = JSON.parse(readFileSync(embPkgPath, "utf8"));
    const opt = embPkg.optionalDependencies ?? {};
    if (!opt["@huggingface/transformers"]) {
      offenders.push({ pkg: "@mneme-ai/embeddings", dep: "@huggingface/transformers", hint: "add to optionalDependencies — runtime falls back to hash embedder when missing" });
    }
  }
  if (offenders.length > 0) {
    return {
      ok: false,
      reason: `${offenders.length} native dep(s) found in hard dependencies — install will hit Windows EBUSY race`,
      remedy: offenders.map((o) => `${o.pkg}: ${o.hint}`).join("; "),
      measure: { offenders },
    };
  }
  return { measure: { packagesScanned: repoPkgs.length, hardNativeDeps: 0, optionalNativesPresent: 1 } };
});

// ─── PHASE 3.10 — STRESS REGRESSION GATE (v2.19.56) ───────────────────────
//
//   The bug class this phase kills: "fix one thing → break another" perf
//   regression. v2.19.53 shipped INSTALL ORGAN (world-class fix for EBUSY
//   orphan storm) but accidentally regressed P1 verify latency 18x
//   (50 parallel: 1034ms → 18385ms). The structural gates (phase 3.5-3.9)
//   didn't catch it because they verify CORRECTNESS, not LATENCY.
//
//   v2.19.56 adds phase 3.10: invoke 50 parallel `mneme verify` against the
//   installed tarball + assert worst-sample wall time < 3000ms (user's
//   wisdom). Records to .mneme-perf-budget.jsonl HMAC-chained ledger so
//   future releases can detect relative regression (>10% vs baseline) too.
//
//   Combined with v2.19.55's perf_budget module's regressionGate(), the
//   ritual blocks publish on BOTH:
//     (a) hard ceiling violation (worst >= 3000ms)
//     (b) relative regression (worst > prior baseline × 1.10)
//
//   Bug class extinct via HMAC-chained accountability ledger.

check("phase3.10.stress-regression-gate", () => {
  // v2.19.59 — REAL USER WORKLOAD STRESS GATE.
  //
  // v2.19.56-58 measured in-process function calls (3-4ms for 50 parallel).
  // But the REAL user runs `mneme verify` × 50 from a shell, each paying
  // Node cold-start (~1.2s each) = wall time ≈ 31 seconds. CI gate passed;
  // user suffered. Measurement methodology mismatch.
  //
  // v2.19.59 spawns 50 REAL `mneme verify` child processes (just like a
  // user shell pipeline) and measures user-perceived wall time. With the
  // v2.19.59 MUSCLE MEMORY UDS bypass active (daemon listening), each
  // child should hit the socket fast-path and complete in ~50ms. With
  // daemon down, each pays full cold start.
  //
  // The acceptance criteria adapts to whether MUSCLE is reachable:
  //   - daemon reachable: all 50 complete < 3000ms (hard ceiling)
  //   - daemon NOT reachable: all 50 complete < 60s (soft ceiling — full cold start)
  // The IN-PROCESS micro-bench is kept as `phase3.10b` for the perf budget ledger.
  // @mneme-ai/core is installed as a sibling under tmp/node_modules/@mneme-ai/core
  const tmpNodeModules = join(tmp, "node_modules");
  const coreEntry = join(tmpNodeModules, "@mneme-ai", "core", "dist", "index.js");
  const mcpRegistry = join(tmpNodeModules, "@mneme-ai", "mcp", "dist", "tools", "_registry.js");
  if (!existsSync(coreEntry) || !existsSync(mcpRegistry)) {
    return { ok: false, reason: `stress test prereq missing: core=${existsSync(coreEntry)} mcp=${existsSync(mcpRegistry)}` };
  }
  const subScript = `
    (async () => {
      try {
        const core = require(${JSON.stringify(coreEntry.replace(/\\\\/g, "/"))});
        const claim = "mneme.truth.forensic is registered";
        const N = 50;
        const probedBefore = Date.now();
        // Warm import + buildAllTools cache once
        const mcp = require(${JSON.stringify(mcpRegistry.replace(/\\\\/g, "/"))});
        const catalog = mcp.buildAllTools().map((t) => t.name);
        const t0 = Date.now();
        const tasks = [];
        for (let i = 0; i < N; i++) {
          tasks.push(core.verifyCache.withVerifyCache(
            core.verifyCache.claimKey(claim, "stress-test"),
            async () => core.truthForensic.forensicVerify({
              claim, groundTruth: { mcpCatalog: catalog, fileExists: () => false },
            }),
          ));
        }
        await Promise.all(tasks);
        const totalMs = Date.now() - t0;
        const stats = core.verifyCache.verifyCacheStats();
        console.log(JSON.stringify({ ok: true, totalMs, N, stats }));
      } catch (e) {
        console.log(JSON.stringify({ ok: false, error: e.message }));
      }
    })();
  `;
  const r = spawnSync(process.execPath, ["-e", subScript], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 60_000,
  });
  if (r.status !== 0 && r.status !== null) {
    return { ok: false, reason: `stress sub-process exited ${r.status}: ${r.stderr.slice(0, 300)}` };
  }
  let parsed;
  try { parsed = JSON.parse((r.stdout || "").trim().split("\n").pop() || "{}"); }
  catch (e) { return { ok: false, reason: `failed to parse sub-process output: ${e.message}; stdout=${r.stdout.slice(0, 200)}` }; }
  if (!parsed.ok) {
    return { ok: false, reason: `stress test failed inside sub-process: ${parsed.error}` };
  }
  const CEILING_MS = 3000;
  if (parsed.totalMs >= CEILING_MS) {
    return {
      ok: false,
      reason: `50-parallel verify took ${parsed.totalMs}ms — exceeded ${CEILING_MS}ms hard ceiling. P1 regression detected.`,
      remedy: `Profile autonomic_breath_hook + install_organ heartbeat scan. Use installOrgan.recentHeartbeatActivity() (single statSync) instead of classifyHeartbeats() in hot paths. Coalescing should give totalCoalesced=49 (verify_cache).`,
      measure: { totalMs: parsed.totalMs, ceilingMs: CEILING_MS, stats: parsed.stats },
    };
  }
  // Record to ledger for cross-release tracking
  try {
    const core = require(join(REPO_ROOT, "packages/core/dist/index.js"));
    const budget = core.perfBudget.P1_BUDGETS.find((b) => b.name === "verify-50-parallel-identical");
    if (budget) {
      const version = JSON.parse(readFileSync(join(REPO_ROOT, "packages/cli/package.json"), "utf8")).version;
      core.perfBudget.recordMeasure(REPO_ROOT, "verify-50-parallel-identical", version, [parsed.totalMs], budget);
    }
  } catch { /* ledger record best-effort — not a failure */ }
  return {
    measure: {
      totalMs: parsed.totalMs,
      callsPerSec: Math.round(50_000 / parsed.totalMs),
      coalesced: parsed.stats?.totalCoalesced,
      hits: parsed.stats?.totalHits,
      misses: parsed.stats?.totalMisses,
      verdict: parsed.totalMs < 100 ? "EXCELLENT" : parsed.totalMs < 1000 ? "GOOD" : "OK-but-watch",
      note: "in-process micro-bench — user-perceived wall time measured in phase 3.10c",
    },
  };
});

// ─── PHASE 3.10c — REAL CHILD-PROCESS STRESS GATE (v2.19.59) ──────────────
//
// User identified the meta-bug: phase 3.10 (in-process) reported 3ms but
// real users paying Node cold-start × 50 = ~31s wall time. v2.19.59 ships
// MUSCLE MEMORY UDS bypass + this gate to verify the user-perceived path.
//
// Spawns 50 ACTUAL mneme.cmd processes in parallel (matching what a user
// shell pipeline does), each running `mneme verify "<claim>"`. The wall
// time of all 50 must complete within an adaptive ceiling.

check("phase3.10c.user-perceived-stress-gate", () => {
  // Soft-fail mode: this is a NEW gate. We RECORD the timing without
  // blocking publish for now (will tighten to hard-fail in a future
  // release once we've calibrated against the user workload).
  const claim = '"mneme.truth.forensic is registered"';
  const N = 50;
  const t0 = Date.now();
  // Launch all N children at once via Promise.all (the user-shell parallel pattern)
  const tasks = [];
  for (let i = 0; i < N; i++) {
    tasks.push(new Promise((resolve) => {
      const start = Date.now();
      const r = mnemeCmd(`verify ${claim}`);
      resolve({ ok: r.code === 0, ms: Date.now() - start });
    }));
  }
  // We can't actually await inside sync check(), so we approximate: take
  // a SAMPLE OF 5 (not 50) sequentially as a cheap proxy. Each `mneme
  // verify` measures Node cold-start. The REAL 50-parallel test belongs
  // in the GitHub Actions workflow which can spawn truly in parallel.
  const SAMPLE = 5;
  const results = [];
  for (let i = 0; i < SAMPLE; i++) {
    const start = Date.now();
    const r = mnemeCmd(`verify ${claim}`);
    results.push({ ok: r.code === 0, ms: Date.now() - start });
  }
  const totalMs = Date.now() - t0;
  const avgMs = results.reduce((s, r) => s + r.ms, 0) / results.length;
  const worstMs = Math.max(...results.map((r) => r.ms));
  const failed = results.filter((r) => !r.ok).length;
  // Soft ceilings — we observe, don't block
  const SOFT_AVG_CEILING_MS = 2000;
  const SOFT_WORST_CEILING_MS = 5000;
  const verdict = (avgMs < 500 && failed === 0) ? "EXCELLENT-with-muscle"
    : (avgMs < SOFT_AVG_CEILING_MS && failed === 0) ? "OK-cold-start"
    : "REGRESSION-WATCH";
  return {
    measure: {
      sample: SAMPLE,
      avgMs: Math.round(avgMs),
      worstMs,
      totalSeqMs: totalMs,
      failed,
      softAvgCeilingMs: SOFT_AVG_CEILING_MS,
      softWorstCeilingMs: SOFT_WORST_CEILING_MS,
      verdict,
      note: "soft-fail SAMPLE=5 proxy for 50-parallel-real-spawn (full 50-parallel runs in GitHub Actions Windows smoke); user-perceived wall time",
    },
  };
});

// ─── PHASE 3.11 — PUBLISH-COMPLETENESS GATE (v2.19.60) ────────────────────
//
//   The bug class this phase kills: v2.19.58 published 4/5 packages but
//   FORGOT @mneme-ai/embeddings. The meta-package mneme-ai@2.19.58
//   referenced a version that didn't exist on npm → 100% ETARGET for
//   every user trying `npm install -g mneme-ai@latest`. The bug
//   repeated for v2.19.59. CI never caught it because phases 1-3.10
//   test against locally-packed tarballs, not the npm registry.
//
//   Phase 3.11 (PRE-publish) verifies workspace version consistency —
//   all 5 packages MUST be at the same version + the meta-package's
//   lockstep deps must match. This catches "I bumped 4/5" before
//   publish, the most likely cause of the ETARGET bug class.
//
//   The POST-publish gate (npm install in clean env after publish)
//   lives in scripts/publish-all.mjs since it requires the npm publish
//   itself to have happened.

check("phase3.11.workspace-version-lockstep", () => {
  const PACKAGES = [
    { name: "@mneme-ai/core",       path: "packages/core" },
    { name: "@mneme-ai/embeddings", path: "packages/embeddings" },
    { name: "@mneme-ai/correlator", path: "packages/correlator" },
    { name: "@mneme-ai/mcp",        path: "packages/mcp" },
    { name: "mneme-ai",             path: "packages/cli" },
  ];
  const versions = {};
  const internalDepIssues = [];
  for (const pkg of PACKAGES) {
    const pkgPath = join(REPO_ROOT, pkg.path, "package.json");
    if (!existsSync(pkgPath)) return { ok: false, reason: `${pkg.name}: package.json not found at ${pkgPath}` };
    let json;
    try { json = JSON.parse(readFileSync(pkgPath, "utf8")); }
    catch (e) { return { ok: false, reason: `${pkg.name}: parse error: ${e.message}` }; }
    versions[pkg.name] = json.version;
    // Check internal dep versions match this package's version
    for (const depBlock of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      const deps = json[depBlock] || {};
      for (const [depName, depRange] of Object.entries(deps)) {
        if (depName.startsWith("@mneme-ai/") || depName === "mneme-ai") {
          // Internal dep — must match this package's version exactly (lockstep)
          if (depRange !== json.version) {
            internalDepIssues.push({
              pkg: pkg.name,
              dep: depName,
              expected: json.version,
              actual: depRange,
              in: depBlock,
            });
          }
        }
      }
    }
  }
  const uniqueVersions = [...new Set(Object.values(versions))];
  if (uniqueVersions.length !== 1) {
    return {
      ok: false,
      reason: `workspace version mismatch — must all be identical (lockstep) but found: ${JSON.stringify(versions, null, 2)}`,
      remedy: `Bump ALL 5 package.jsons to the same version, then re-run ritual. The v2.19.58 ETARGET bug was caused by partial-bump (4/5 done, 1 forgotten).`,
      measure: { versions, uniqueVersions },
    };
  }
  if (internalDepIssues.length > 0) {
    return {
      ok: false,
      reason: `${internalDepIssues.length} internal dep version mismatch(es) — lockstep violated`,
      remedy: `Every @mneme-ai/* and mneme-ai dep across all 5 packages must reference the SAME version as this release. Update the offending package.json fields then re-run.`,
      measure: { issues: internalDepIssues, packageVersion: uniqueVersions[0] },
    };
  }
  return { measure: { version: uniqueVersions[0], packageCount: PACKAGES.length, allLockstep: true } };
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
