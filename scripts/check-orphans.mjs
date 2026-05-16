#!/usr/bin/env node
/**
 * check-orphans.mjs — standalone CI gate that wraps wrapper_genesis.
 * Exits 0 if zero v2.18+ orphans, 1 otherwise.
 * Called by reincarnation-ritual.mjs via spawnSync.
 */
import { join } from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REPO_ROOT = process.cwd();
const coreSrcDir = join(REPO_ROOT, "packages/core/src");
const mcpToolsDir = join(REPO_ROOT, "packages/mcp/src/tools");
const distPath = join(REPO_ROOT, "packages/core/dist/wrapper_genesis/index.js");

if (!existsSync(coreSrcDir) || !existsSync(mcpToolsDir)) {
  console.log(JSON.stringify({ skipped: true, reason: "local source not present" }));
  process.exit(0);
}
if (!existsSync(distPath)) {
  console.log(JSON.stringify({ skipped: true, reason: "wrapper_genesis dist not built" }));
  process.exit(0);
}

const wg = await import(pathToFileURL(distPath).href);
const r = wg.scanForOrphans({ coreSrcDir, mcpToolsDir });
const enforced = r.orphans.filter((o) => wg.ENFORCE_FULL_COVERAGE.has(o.module));
const summary = {
  totalCoreExports: r.totalCoreExports,
  totalMcpTools: r.totalMcpTools,
  legacyOrphans: r.orphans.length - enforced.length,
  enforcedOrphans: enforced.length,
  enforcedList: enforced.slice(0, 10).map((o) => ({ module: o.module, symbol: o.symbol, suggested: o.suggestedMcpName })),
};
console.log(JSON.stringify(summary));
process.exit(enforced.length === 0 ? 0 : 1);
