#!/usr/bin/env node
/**
 * v2.75.0 — GENERATE the inline `node -e` preinstall from the tested
 * reaper source (packages/cli/bin/preinstall-mneme.cjs).
 *
 * WHY THIS EXISTS. The preinstall hook MUST be a self-contained inline
 * `node -e "..."` with ZERO references to package-internal files — npm can
 * run preinstall before the tarball is fully extracted, so a `node
 * bin/foo.cjs` reference crashes the install with "Cannot find module" and
 * uninstalls Mneme from PATH (the v2.19.48/49 incident, codified in
 * aurelian_v1950.test.ts + enforced by preinstall_trail.test.ts).
 *
 * But an inline mega-string is untestable and rots. So we keep ONE source
 * of truth — the .cjs (unit-tested + SUPER-QUAN probed) — and PROJECT it
 * into package.json's `scripts.preinstall` as an inline `node -e` body.
 * Strip the shebang + the `require.main` runner, append an explicit runner.
 *
 * Run: `node scripts/gen-preinstall-inline.mjs`  (writes packages/cli/package.json)
 * A drift-guard test regenerates in-memory and fails if the two diverge.
 *
 * Export `buildInlinePreinstall()` so the test can compute the expected
 * value without shelling out.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
export const CJS_PATH = resolve(REPO, "packages/cli/bin/preinstall-mneme.cjs");
export const PKG_PATH = resolve(REPO, "packages/cli/package.json");

/** Project the .cjs source into the inline `node -e` body string. Pure. */
export function buildInlineBody(cjsSource) {
  let body = cjsSource;
  body = body.replace(/^#![^\n]*\r?\n/, "");                        // drop shebang
  body = body.replace(/\n\/\* ── run on direct invoke[\s\S]*$/, "\n"); // drop require.main runner
  // Explicit runner: node -e has no `require.main === module`, so call it
  // directly and ALWAYS exit 0 — preinstall must never abort an install.
  body += "\ntry { runPreinstall(); } catch (_e) { /* never block install */ }\nprocess.exit(0);\n";
  return body;
}

/** The full `scripts.preinstall` value. Pure. */
export function buildInlinePreinstall(cjsSource) {
  return "node -e " + JSON.stringify(buildInlineBody(cjsSource));
}

/** Replace ONLY the preinstall line in package.json raw text (preserves
 *  all other formatting). Returns the new file text. Pure. */
export function splicePreinstall(pkgText, preinstallValue) {
  const lines = pkgText.split(/\n/);
  const idx = lines.findIndex((l) => /^\s*"preinstall":/.test(l));
  if (idx < 0) throw new Error("no preinstall line in package.json");
  const indent = (lines[idx].match(/^\s*/) || [""])[0];
  const hadComma = /,\s*$/.test(lines[idx]);
  lines[idx] = indent + JSON.stringify("preinstall") + ": " + JSON.stringify(preinstallValue) + (hadComma ? "," : "");
  return lines.join("\n");
}

function main() {
  const cjs = readFileSync(CJS_PATH, "utf8");
  const value = buildInlinePreinstall(cjs);
  const pkgText = readFileSync(PKG_PATH, "utf8");
  const next = splicePreinstall(pkgText, value);
  JSON.parse(next); // validate
  writeFileSync(PKG_PATH, next);
  console.log(`✅ regenerated inline preinstall (${value.length} chars) from ${CJS_PATH.replace(REPO, ".")}`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
