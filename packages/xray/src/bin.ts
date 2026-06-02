#!/usr/bin/env node
/**
 * mneme-xray — run an X-Ray from the terminal.
 *   mneme-xray <path|https-git-url> [--json] [--no-sign]
 */
import { buildXRay } from "./engine.js";
import { sealXRay, verifyXRay } from "./sign.js";
import { xrayLeaksRaw } from "./privacy.js";
import { existsSync } from "node:fs";

async function main() {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith("--"));
  const asJson = args.includes("--json");
  const noSign = args.includes("--no-sign");
  if (!target) {
    process.stderr.write("usage: mneme-xray <path|https-git-url> [--json] [--no-sign]\n");
    process.exit(2);
  }

  const isUrl = /^https:\/\//.test(target);
  const report = await buildXRay(isUrl ? { gitUrl: target } : { repoPath: target });

  // privacy gate — never emit a report that leaks raw source
  const leak = xrayLeaksRaw(report);
  if (leak.leaks) {
    process.stderr.write(`✗ refusing to emit: report failed raw-free check (${leak.reasons.join("; ")})\n`);
    process.exit(1);
  }

  const repoRootForKey = isUrl ? process.cwd() : (existsSync(target) ? target : process.cwd());
  const signed = noSign ? { report, receipt: null } : sealXRay(repoRootForKey, report);

  if (asJson) {
    process.stdout.write(JSON.stringify(signed, null, 2) + "\n");
    return;
  }

  const r = report;
  const line = "─".repeat(58);
  process.stdout.write(`\n  REPO X-RAY · ${r.subject.repoName} @ ${r.subject.commitHash.slice(0, 12)}\n  ${line}\n`);
  process.stdout.write(`  GRADE ${r.summary.grade}   ${r.summary.headline}\n  ${line}\n`);
  for (const b of r.summary.bullets) process.stdout.write(`  ${b}\n`);
  process.stdout.write(`  ${line}\n  fingerprint ${r.fingerprint.slice(0, 24)}…\n`);
  if (!noSign) {
    const v = verifyXRay(signed);
    process.stdout.write(`  signed: ${v.valid ? "✓ Ed25519 receipt verifies offline" : "✗ " + v.reason}\n`);
  }
  process.stdout.write("\n");
}

main().catch((e) => {
  process.stderr.write(`✗ x-ray failed: ${(e as Error).message}\n`);
  process.exit(1);
});
