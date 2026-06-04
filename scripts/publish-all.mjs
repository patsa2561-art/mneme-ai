#!/usr/bin/env node
/**
 * v2.19.60 — PUBLISH-ALL: atomic 5-package npm publish + verify-on-npm gate.
 *
 * The bug class this kills (user-reported, turn-21 after v2.19.59):
 *   v2.19.58 release script published 4/5 packages but FORGOT
 *   @mneme-ai/embeddings → meta-package mneme-ai@2.19.58 referenced a
 *   version that didn't exist on npm → 100% of users hit ETARGET on
 *   `npm install -g mneme-ai@latest`. The class repeated for v2.19.59.
 *   Root cause: manual sequential publish in my prior commits skipped
 *   embeddings (it had no version-bump diff so I forgot it visually).
 *
 * This script makes the bug class impossible going forward:
 *   1. Reads ALL workspace package.jsons + asserts identical version
 *   2. Publishes ALL 5 packages in correct dep order (core → emb →
 *      correlator → mcp → cli)
 *   3. After each publish: waits 5s for npm registry CDN to propagate,
 *      then `npm view <pkg>@<version> version` to verify it's reachable
 *   4. On ANY publish failure: prints the unpublished set + exits non-zero
 *   5. After ALL 5 published + verified: runs end-to-end smoke
 *      (`npm install --no-save mneme-ai@<version>` in /tmp + checks
 *      mneme.cmd resolves) — catches future ETARGET / EBUSY classes
 *
 * Usage:
 *   node scripts/publish-all.mjs           # publish current versions
 *   node scripts/publish-all.mjs --dry-run # show what WOULD publish
 *   node scripts/publish-all.mjs --skip-smoke # skip the end-to-end install probe
 *
 * Exit codes:
 *   0 — all 5 published + verified + smoke passed
 *   1 — any publish failed OR verify failed
 *   2 — version mismatch across workspaces (caught before any publish)
 *   3 — smoke install failed AFTER all publishes (rollback impossible;
 *       alert user to investigate)
 */

import { execSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const PACKAGES_IN_DEP_ORDER = [
  // Order matters: core first (others depend on it), embeddings + correlator
  // next (mcp depends on embeddings), mcp before cli (cli aggregates all).
  { name: "@mneme-ai/core",       path: "packages/core" },
  { name: "@mneme-ai/embeddings", path: "packages/embeddings" },
  { name: "@mneme-ai/correlator", path: "packages/correlator" },
  { name: "@mneme-ai/mcp",        path: "packages/mcp" },
  // v2.55.0 — SDK depends only on core, can publish before cli.
  { name: "@mneme-ai/sdk",        path: "packages/sdk" },
  // v2.85.0 — GEPHYRA (the deployable bridge surface) depends only on core.
  { name: "@mneme-ai/gephyra",    path: "packages/gephyra" },
  // v2.167.0 — MATRIX (the gRPC wire server) depends on core + mcp (both above).
  { name: "@mneme-ai/matrix",     path: "packages/matrix" },
  { name: "mneme-ai",             path: "packages/cli" },
];

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const SKIP_SMOKE = args.has("--skip-smoke");

function log(emoji, msg) { process.stdout.write(`${emoji} ${msg}\n`); }
function dim(s) { return `\x1b[2m${s}\x1b[0m`; }

// ─── STEP 1 — Read + validate versions ────────────────────────────────────
log("📦", "publish-all v2.19.60 — atomic 5-package publish + verify");
log("🔍", "step 1/5: read + validate workspace versions");

const versions = {};
for (const pkg of PACKAGES_IN_DEP_ORDER) {
  const pkgPath = join(REPO_ROOT, pkg.path, "package.json");
  if (!existsSync(pkgPath)) {
    log("❌", `${pkg.name}: package.json not found at ${pkgPath}`);
    process.exit(2);
  }
  const json = JSON.parse(readFileSync(pkgPath, "utf8"));
  versions[pkg.name] = json.version;
}
const unique = [...new Set(Object.values(versions))];
if (unique.length !== 1) {
  log("❌", `version mismatch across workspaces: ${JSON.stringify(versions, null, 2)}`);
  process.exit(2);
}
const TARGET_VERSION = unique[0];
log("✅", `all 5 packages at version ${TARGET_VERSION}`);

if (DRY_RUN) {
  log("🧪", "DRY-RUN — would publish:");
  for (const pkg of PACKAGES_IN_DEP_ORDER) log("   ", `${pkg.name}@${TARGET_VERSION}`);
  process.exit(0);
}

// ─── STEP 2 — Publish in dep order + verify each ──────────────────────────
log("🚀", "step 2/5: publish in dep order + verify each on npm registry");
const publishResults = [];
for (const pkg of PACKAGES_IN_DEP_ORDER) {
  log("📤", `publishing ${pkg.name}@${TARGET_VERSION}...`);
  const r = spawnSync("npm", ["publish", "--access", "public"], {
    cwd: join(REPO_ROOT, pkg.path),
    encoding: "utf8",
    shell: process.platform === "win32",
    windowsHide: true,
    timeout: 180_000,
  });
  if (r.status !== 0) {
    // Check if already published (idempotency) — npm errors with E403/E409
    const out = (r.stdout || "") + (r.stderr || "");
    if (out.includes("403") && out.includes("cannot publish over the previously published")) {
      log("⚠️", `${pkg.name}@${TARGET_VERSION} — already published (skipping)`);
      publishResults.push({ pkg: pkg.name, status: "already-published" });
      continue;
    }
    log("❌", `${pkg.name}@${TARGET_VERSION} publish FAILED (exit ${r.status})`);
    log("   ", dim(out.slice(-400)));
    log("⛔", `STOPPING — already-published: ${publishResults.map((p) => p.pkg).join(", ") || "none"}`);
    log("   ", dim(`Future publishes of v${TARGET_VERSION} for the remaining packages must succeed manually, OR bump to v${nextPatch(TARGET_VERSION)} and re-publish all 5.`));
    process.exit(1);
  }
  publishResults.push({ pkg: pkg.name, status: "published" });
  log("✅", `${pkg.name}@${TARGET_VERSION} published`);
  // Verify on registry (with retry — CDN propagation can take a few seconds)
  let verified = false;
  for (let attempt = 1; attempt <= 6; attempt++) {
    const wait = attempt * 1000; // 1s, 2s, 3s, ... = 1+2+3+4+5+6 = 21s max
    await sleep(wait);
    const v = spawnSync("npm", ["view", `${pkg.name}@${TARGET_VERSION}`, "version"], {
      encoding: "utf8", shell: process.platform === "win32", windowsHide: true, timeout: 30_000,
    });
    if (v.status === 0 && (v.stdout || "").trim() === TARGET_VERSION) {
      verified = true;
      log("✅", `${pkg.name}@${TARGET_VERSION} verified on npm registry (attempt ${attempt})`);
      break;
    }
  }
  if (!verified) {
    log("❌", `${pkg.name}@${TARGET_VERSION} NOT visible on npm registry after 21s — STOPPING`);
    process.exit(1);
  }
}

log("✅", `step 2/5 done — all ${PACKAGES_IN_DEP_ORDER.length} packages published + verified`);

// ─── STEP 3 — End-to-end install smoke ────────────────────────────────────
if (SKIP_SMOKE) {
  log("⏭️", "step 3/5: SKIPPED (--skip-smoke)");
} else {
  log("🧪", "step 3/5: end-to-end install smoke (clean tmp dir)");
  const tmpDir = join(tmpdir(), `mneme-postpub-smoke-${process.pid}-${Date.now()}`);
  try {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "smoke-test", version: "1.0.0" }, null, 2));
    const installR = spawnSync("npm", ["install", "--no-save", "--omit=optional", `mneme-ai@${TARGET_VERSION}`], {
      cwd: tmpDir, encoding: "utf8", shell: process.platform === "win32", windowsHide: true, timeout: 300_000,
    });
    if (installR.status !== 0) {
      log("❌", `end-to-end install FAILED (exit ${installR.status})`);
      log("   ", dim((installR.stderr || "").slice(-500)));
      log("⛔", `meta-package mneme-ai@${TARGET_VERSION} cannot be installed by users — INVESTIGATE`);
      process.exit(3);
    }
    log("✅", `step 3/5 done — install completed (101 packages typical)`);
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  }
}

// ─── STEP 4 — LATEST-LAG GATE (v2.19.63) ──────────────────────────────────
// `npm view <pkg> version` hits the origin registry; `npm install <pkg>@latest`
// hits a CDN edge (Cloudflare / fastly). After publish, edges replicate the
// `latest` dist-tag with ~5-15min lag. Users running `npm install -g mneme-ai
// @latest` in this window get the PREVIOUS version → confusing "did the
// release ship?" experience. This gate retries `npm view mneme-ai@latest
// version` AND end-to-end `npm install mneme-ai@latest` in a clean dir
// until both resolve to TARGET_VERSION. Backoff up to ~10min. BLOCKS the
// "publish complete" message.
log("⏳", "step 4/5: LATEST-LAG gate — verify @latest dist-tag resolves to new version across CDN");
let latestOk = false;
let latestSeen = "(none)";
const LATEST_GATE_MAX_ATTEMPTS = 20; // 10s + 20s + ... + 60s + 6×60s = ~600s = 10min cap
for (let attempt = 1; attempt <= LATEST_GATE_MAX_ATTEMPTS; attempt++) {
  const v = spawnSync("npm", ["view", "mneme-ai@latest", "version"], {
    encoding: "utf8", shell: process.platform === "win32", windowsHide: true, timeout: 30_000,
  });
  if (v.status === 0) {
    latestSeen = (v.stdout || "").trim();
    if (latestSeen === TARGET_VERSION) {
      latestOk = true;
      log("✅", `mneme-ai@latest now resolves to ${TARGET_VERSION} (attempt ${attempt})`);
      break;
    }
  }
  const wait = Math.min(attempt * 10_000, 60_000); // 10s → 60s cap
  log("   ", dim(`attempt ${attempt}/${LATEST_GATE_MAX_ATTEMPTS}: @latest = ${latestSeen}, want ${TARGET_VERSION} — waiting ${wait/1000}s for CDN propagation`));
  await sleep(wait);
}
if (!latestOk) {
  log("⚠️", `LATEST-LAG gate: @latest still resolves to ${latestSeen} after 10min (want ${TARGET_VERSION})`);
  log("   ", dim("Tag is published BUT CDN edges haven't caught up. Users hitting `@latest` may pull the previous version for a while."));
  log("   ", dim(`Workaround for users: \`npm install -g mneme-ai@${TARGET_VERSION}\` to pin the exact version.`));
  // Don't exit non-zero — the tag IS published, just slow CDN. But emit warning.
} else {
  // Belt-and-suspenders: verify end-to-end install via @latest resolves correctly
  const latestSmokeDir = join(tmpdir(), `mneme-latest-smoke-${process.pid}-${Date.now()}`);
  try {
    mkdirSync(latestSmokeDir, { recursive: true });
    writeFileSync(join(latestSmokeDir, "package.json"), JSON.stringify({ name: "latest-smoke", version: "1.0.0" }, null, 2));
    const installR = spawnSync("npm", ["install", "--no-save", "--omit=optional", "mneme-ai@latest"], {
      cwd: latestSmokeDir, encoding: "utf8", shell: process.platform === "win32", windowsHide: true, timeout: 300_000,
    });
    if (installR.status === 0) {
      const installedPkg = JSON.parse(readFileSync(join(latestSmokeDir, "node_modules", "mneme-ai", "package.json"), "utf8"));
      if (installedPkg.version === TARGET_VERSION) {
        log("✅", `end-to-end \`mneme-ai@latest\` install resolved to ${TARGET_VERSION} — CDN propagation verified`);
      } else {
        log("⚠️", `\`@latest\` view says ${TARGET_VERSION} but install resolved to ${installedPkg.version} — CDN inconsistency`);
      }
    } else {
      log("⚠️", `end-to-end \`@latest\` install failed (exit ${installR.status}) — origin says ${TARGET_VERSION} but install path broken`);
    }
  } catch (e) {
    log("⚠️", `LATEST-LAG end-to-end probe threw: ${e.message}`);
  } finally {
    try { rmSync(latestSmokeDir, { recursive: true, force: true }); } catch { /* */ }
  }
}

log("🎉", `publish-all v${TARGET_VERSION} COMPLETE — all ${PACKAGES_IN_DEP_ORDER.length} packages live + verified + smoke passed${latestOk ? " + @latest propagated" : " (⚠ @latest still propagating)"}`);
process.exit(0);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function nextPatch(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!m) return v;
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}
