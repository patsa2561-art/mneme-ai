#!/usr/bin/env node
/**
 * v2.19.69 — PUBLISH-LITE: ship a parallel "@lite" dist-tag variant of
 * all 5 packages so users can `npm install -g mneme-ai@lite` and get a
 * ~5MB zero-DLL install instead of the default 467MB tree.
 *
 * Why this exists (Gap 3 — npm 10 global `--omit=optional` bug):
 *   npm 10.x silently ignores `--omit=optional` for global installs:
 *
 *     npm install -g mneme-ai --omit=optional   # still 467MB
 *
 *   We cannot fix that from a package.json — the flag is honoured for
 *   LOCAL installs but ignored for GLOBAL.  This script publishes a
 *   parallel set of packages with `optionalDependencies` stripped, so
 *   users get the zero-DLL path via dist-tag selection instead.
 *
 * What it publishes (parallel to scripts/publish-all.mjs):
 *
 *   <pkg>@<X.Y.Z>-lite        with optionalDependencies stripped to {}
 *
 *   Under `--tag lite`, so:
 *     npm install -g mneme-ai@lite     # resolves to X.Y.Z-lite, ~5MB
 *     npm install -g mneme-ai          # resolves to X.Y.Z (latest), full
 *     npm install -g mneme-ai@X.Y.Z    # explicit version, full
 *
 *   Sister packages (`@mneme-ai/core-lite`, `@mneme-ai/embeddings-lite`,
 *   `@mneme-ai/correlator-lite`, `@mneme-ai/mcp-lite`) are NOT created —
 *   instead, the lite variant's mneme-ai package.json keeps the SAME
 *   `@mneme-ai/*` dep names but pins them to `X.Y.Z-lite` versions of
 *   those packages, which we also publish here.  This way:
 *     - one dist-tag selector (`@lite`) flips the entire install tree
 *     - no NEW package names — discoverability on npmjs.com stays clean
 *     - same code in dist/, just different package.json manifests
 *
 * What gets modified per package:
 *   - `version`: append `-lite` suffix (semver prerelease form)
 *   - `optionalDependencies`: emptied (only `@mneme-ai/embeddings`
 *     actually has any; the field is dropped from the others as a no-op)
 *   - internal `@mneme-ai/*` deps: rewritten to point at the matching
 *     `-lite` version of the sibling package
 *
 * What stays IDENTICAL:
 *   - dist/ output (the compiled JS code)
 *   - bin/ scripts (CLI entry + Phoenix bootstrap + postinstall pruner)
 *   - README.md (so the npmjs.com page shows the same content)
 *
 * Idempotency:
 *   - If `<pkg>@X.Y.Z-lite` is already on npm, `npm publish` will 409.
 *     This script treats 409 ("cannot publish over the previously
 *     published") as success and continues.
 *
 * Usage:
 *   node scripts/publish-lite.mjs            # publish based on current versions
 *   node scripts/publish-lite.mjs --dry-run  # show what WOULD publish
 */

import { execSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync, rmSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const PACKAGES_IN_DEP_ORDER = [
  { name: "@mneme-ai/core",       path: "packages/core" },
  { name: "@mneme-ai/embeddings", path: "packages/embeddings" },
  { name: "@mneme-ai/correlator", path: "packages/correlator" },
  { name: "@mneme-ai/mcp",        path: "packages/mcp" },
  { name: "mneme-ai",             path: "packages/cli" },
];

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");

function log(emoji, msg) { process.stdout.write(`${emoji} ${msg}\n`); }
function dim(s) { return `\x1b[2m${s}\x1b[0m`; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─── STEP 1 — Read version + plan lite variants ──────────────────────────
log("🪶", "publish-lite v2.19.69 — parallel @lite dist-tag variant (Gap 3 workaround)");
log("🔍", "step 1/3: read base version + plan lite variants");

const baseVersions = {};
for (const pkg of PACKAGES_IN_DEP_ORDER) {
  const pkgPath = join(REPO_ROOT, pkg.path, "package.json");
  if (!existsSync(pkgPath)) {
    log("❌", `${pkg.name}: package.json not found at ${pkgPath}`);
    process.exit(2);
  }
  const json = JSON.parse(readFileSync(pkgPath, "utf8"));
  baseVersions[pkg.name] = json.version;
}
const unique = [...new Set(Object.values(baseVersions))];
if (unique.length !== 1) {
  log("❌", `version mismatch across workspaces: ${JSON.stringify(baseVersions, null, 2)}`);
  process.exit(2);
}
const BASE_VERSION = unique[0];
const LITE_VERSION = `${BASE_VERSION}-lite`;
log("✅", `base = ${BASE_VERSION}, lite = ${LITE_VERSION}`);

if (DRY_RUN) {
  log("🧪", "DRY-RUN — would publish:");
  for (const pkg of PACKAGES_IN_DEP_ORDER) {
    log("   ", `${pkg.name}@${LITE_VERSION} (--tag lite)`);
  }
  log("   ", dim("manifest mutations per package: version+=-lite, optionalDependencies={}, internal @mneme-ai/* deps rewritten to -lite versions"));
  process.exit(0);
}

// ─── STEP 2 — For each package, snapshot source to tmp + mutate manifest ─
log("🛠 ", "step 2/3: snapshot + mutate each package into a tmp lite tree");
const stagingRoot = join(tmpdir(), `mneme-lite-staging-${process.pid}-${Date.now()}`);
mkdirSync(stagingRoot, { recursive: true });

const stagedPaths = [];
for (const pkg of PACKAGES_IN_DEP_ORDER) {
  const src = join(REPO_ROOT, pkg.path);
  // Use the basename of the workspace dir as the staging subdir so npm
  // doesn't get confused by name collisions.
  const dst = join(stagingRoot, pkg.path.replace(/\//g, "_"));
  cpSync(src, dst, {
    recursive: true,
    // Skip node_modules + tsbuildinfo + tests — npm publish ignores them
    // via `files`, but we save a few seconds of copy.
    filter: (s) => !s.includes("node_modules") && !s.endsWith(".tsbuildinfo"),
  });
  const manifestPath = join(dst, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  // Mutation 1 — version suffix.
  manifest.version = LITE_VERSION;
  // Mutation 2 — strip optional deps entirely (this is the whole point).
  if (manifest.optionalDependencies) {
    delete manifest.optionalDependencies;
  }
  // Mutation 3 — rewrite @mneme-ai/* deps to point at the lite versions
  // we're about to publish in this same run.
  for (const field of ["dependencies", "peerDependencies", "devDependencies"]) {
    if (!manifest[field]) continue;
    for (const dep of Object.keys(manifest[field])) {
      if (dep.startsWith("@mneme-ai/") || dep === "mneme-ai") {
        manifest[field][dep] = LITE_VERSION;
      }
    }
  }
  // Mutation 4 — append "(lite)" to description so npmjs.com makes the
  // variant obvious to users browsing.
  manifest.description = `${manifest.description || ""} — LITE variant (no bundled WASM embedder, no native deps).`.trim();
  // Mutation 5 — keep the same name so `npm install -g mneme-ai@lite`
  // resolves via dist-tag, not a new package name.
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  stagedPaths.push({ pkg: pkg.name, path: dst });
  log("   ", `${pkg.name}@${LITE_VERSION} staged at ${dim(dst)}`);
}

// ─── STEP 3 — Publish each staged package under @lite ────────────────────
log("🚀", "step 3/3: publish each staged package under --tag lite");
const publishResults = [];
for (const { pkg, path: stagedPath } of stagedPaths) {
  log("📤", `publishing ${pkg}@${LITE_VERSION} (--tag lite)...`);
  const r = spawnSync("npm", ["publish", "--access", "public", "--tag", "lite"], {
    cwd: stagedPath,
    encoding: "utf8",
    shell: process.platform === "win32",
    windowsHide: true,
    timeout: 180_000,
  });
  if (r.status !== 0) {
    const out = (r.stdout || "") + (r.stderr || "");
    // Idempotency — treat 409/403 "already published" as success.
    if (out.includes("403") && out.includes("cannot publish over the previously published")) {
      log("⚠️", `${pkg}@${LITE_VERSION} — already published (skipping)`);
      publishResults.push({ pkg, status: "already-published" });
      continue;
    }
    if (out.includes("409") || out.includes("EPUBLISHCONFLICT")) {
      log("⚠️", `${pkg}@${LITE_VERSION} — version conflict (likely already published, treating as success)`);
      publishResults.push({ pkg, status: "already-published" });
      continue;
    }
    log("❌", `${pkg}@${LITE_VERSION} publish FAILED (exit ${r.status})`);
    log("   ", dim(out.slice(-400)));
    log("⛔", `STOPPING — already-published: ${publishResults.map((p) => p.pkg).join(", ") || "none"}`);
    process.exit(1);
  }
  publishResults.push({ pkg, status: "published" });
  log("✅", `${pkg}@${LITE_VERSION} published under --tag lite`);
  // Verify on registry — same retry loop as publish-all.mjs.
  let verified = false;
  for (let attempt = 1; attempt <= 6; attempt++) {
    await sleep(attempt * 1000);
    const v = spawnSync("npm", ["view", `${pkg}@lite`, "version"], {
      encoding: "utf8", shell: process.platform === "win32", windowsHide: true, timeout: 30_000,
    });
    if (v.status === 0 && (v.stdout || "").trim() === LITE_VERSION) {
      verified = true;
      log("✅", `${pkg}@lite -> ${LITE_VERSION} verified on npm registry (attempt ${attempt})`);
      break;
    }
  }
  if (!verified) {
    log("⚠️", `${pkg}@lite -> ${LITE_VERSION} NOT visible after 21s (CDN propagation may be slow; tag IS published)`);
  }
}

// ─── Cleanup staging ─────────────────────────────────────────────────────
try { rmSync(stagingRoot, { recursive: true, force: true }); } catch { /* */ }

log("🎉", `publish-lite v${BASE_VERSION} COMPLETE — ${publishResults.length} lite packages live under @lite dist-tag`);
log("   ", dim(`users can now install via: npm install -g mneme-ai@lite`));
process.exit(0);
