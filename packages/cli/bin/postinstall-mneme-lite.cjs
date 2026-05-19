#!/usr/bin/env node
/**
 * v2.19.69 — MNEME_LITE postinstall pruner (Gap 3 workaround #2 — npm 10
 *            global `--omit=optional` bug).
 *
 *   npm 10.x silently ignores `--omit=optional` for global installs:
 *
 *     npm install -g mneme-ai --omit=optional          # 467MB on disk
 *     NPM_CONFIG_OMIT=optional npm install -g mneme-ai # 467MB on disk
 *
 *   This script gives the user a working alternative: set `MNEME_LITE=1` in
 *   the environment when installing.  npm still downloads + extracts the
 *   optional `@huggingface/transformers` tree (we cannot influence that
 *   from a package.json), but THIS postinstall hook then removes it from
 *   disk before npm hands control back.  Net result:
 *
 *     MNEME_LITE=1 npm install -g mneme-ai
 *       -> 467MB downloaded + extracted
 *       -> ~462MB removed from disk by this hook (transformers + sharp + libvips)
 *       -> ~5MB final on-disk footprint
 *       -> 0 native DLL handles → EBUSY structurally extinct post-install
 *
 *   The mneme runtime gracefully falls back through the embedder chain
 *   (OpenAI → Ollama → bundled WASM SKIPPED → hash) — every Mneme tool
 *   continues to work, just at deterministic hash quality (★★) until the
 *   user installs Ollama or adds an OpenAI key.
 *
 *   Idempotent + non-fatal:
 *     - Re-running after prune is a no-op (paths gone, fs.rmSync swallows
 *       ENOENT with { force: true }).
 *     - Any prune failure is logged but never breaks the install: the
 *       fallback is "user keeps the 467MB tree", not "install aborts".
 *     - Silent on the happy path (no env var set) so the default install
 *       UX is unchanged.
 *
 *   Logs a one-line summary on the prune path so AI agents inspecting
 *   the install output can confirm the lite mode took effect.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const LITE = String(process.env.MNEME_LITE || "").trim();
if (LITE !== "1" && LITE.toLowerCase() !== "true" && LITE.toLowerCase() !== "yes") {
  // No-op for the default install path — keeps behaviour pristine for the
  // 99% of users who want the bundled WASM embedder.
  process.exit(0);
}

// We're inside `<install-prefix>/lib/node_modules/mneme-ai/bin/` on POSIX
// or `<install-prefix>/node_modules/mneme-ai/bin/` on Windows.  The optional
// tree lives at `<install-prefix>/.../mneme-ai/node_modules/<target>`.
const here = __dirname;
const mnemeRoot = path.resolve(here, "..");
const sub = (p) => path.join(mnemeRoot, "node_modules", p);

// Targets — every directory that pulls in native binaries through the
// `@huggingface/transformers` optional dep tree.  Kept conservative on
// purpose: anything outside this list might be a transitive dep some
// other Mneme module actually uses, so we only delete the known-safe set.
const PRUNE_TARGETS = [
  "@huggingface",
  "@img",
  "sharp",
  // onnxruntime-* drag a ~80MB native runtime even on Linux/macOS when
  // transformers is present.  Safe to remove in lite mode because
  // transformers itself is gone — nothing else in Mneme uses ORT.
  "onnxruntime-common",
  "onnxruntime-node",
  "onnxruntime-web",
];

function dirSizeBytes(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dirPath, ent.name);
      try {
        if (ent.isDirectory()) total += dirSizeBytes(full);
        else if (ent.isFile()) total += fs.statSync(full).size;
      } catch { /* skip permission errors */ }
    }
  } catch { /* skip unreadable dirs */ }
  return total;
}

function fmtMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1) + "MB";
}

let prunedBytes = 0;
const prunedNames = [];
const skippedNames = [];

for (const name of PRUNE_TARGETS) {
  const target = sub(name);
  if (!fs.existsSync(target)) {
    skippedNames.push(name);
    continue;
  }
  const sizeBefore = dirSizeBytes(target);
  try {
    fs.rmSync(target, { recursive: true, force: true });
    prunedBytes += sizeBefore;
    prunedNames.push(`${name} (${fmtMB(sizeBefore)})`);
  } catch (err) {
    // Don't fail the install over a single stuck dir; just report.
    process.stderr.write(
      `[mneme-lite] could not prune ${name}: ${err && err.message ? err.message : err}\n`,
    );
    skippedNames.push(`${name} (locked)`);
  }
}

const summary =
  `[mneme-lite] MNEME_LITE=${LITE} → pruned ${prunedNames.length}/${PRUNE_TARGETS.length} ` +
  `optional-dep directories, ${fmtMB(prunedBytes)} freed.\n` +
  (prunedNames.length > 0 ? `[mneme-lite] removed: ${prunedNames.join(", ")}\n` : "") +
  (skippedNames.length > 0 ? `[mneme-lite] skipped: ${skippedNames.join(", ")}\n` : "") +
  `[mneme-lite] mneme runtime will fall back through OpenAI → Ollama → hash embedder (bundled WASM skipped).\n`;
process.stdout.write(summary);

// Always exit 0 — we never want this script to abort the install.
process.exit(0);
