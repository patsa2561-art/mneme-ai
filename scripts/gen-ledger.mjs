#!/usr/bin/env node
/**
 * Canonical PUBLIC HONESTY LEDGER generator — regenerates the signed ledger + human
 * markdown + badge from the BUILT core, so docs/HONESTY-LEDGER.* and the README badge
 * always reflect the current release. Run as part of every ship: `npm run ledger`.
 *
 * Requires the workspace to be built first (uses packages/core/dist).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

const core = await import(pathToFileURL(join(root, "packages/core/dist/honesty_ledger/index.js")).href);
const { ledger, receipt } = await core.buildHonestyLedger(root, version);

writeFileSync(join(root, "docs/HONESTY-LEDGER.json"), JSON.stringify(receipt, null, 2) + "\n");
writeFileSync(join(root, "docs/HONESTY-LEDGER.md"), core.ledgerMarkdown(ledger, receipt) + "\n");
writeFileSync(join(root, "assets/honesty-badge.svg"), core.badgeSVG(ledger.summary) + "\n");

const s = ledger.summary;
const v = core.verifyHonestyLedger(receipt);
if (!v.valid || !v.honest) {
  console.error(`⛔ LEDGER NOT HONEST — valid=${v.valid} honest=${v.honest} drift=${s.drift} refuted=${s.refuted}`);
  process.exit(1);
}
console.log(`🛡 honesty ledger regenerated @${version}: ${s.pass}/${s.measured} pass, drift ${s.drift}, refuted ${s.refuted}, score ${s.score}/100 — signed ${receipt.issuerFingerprint}`);
