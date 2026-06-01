/**
 * `mneme pce` (v2.139.0) — Proof-Carrying Edit (💎2). Attach a SIGNED certificate
 * to an AI's diff that statically proves what it touches + introduces, so a
 * reviewer/CI trusts the analysis offline without re-running it or trusting the
 * author. Tampering with the diff OR the cert is caught.
 *
 *   git diff | mneme pce --scope "src/**" --forbid network,childProcess
 *   mneme pce --diff change.patch --json > passport.json
 *   git diff | mneme pce verify --passport passport.json --scope "src/**"
 *
 * Exit 2 on BLOCK (out-of-scope · secret added · forbidden primitive) — CI-gate.
 */

import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { pce, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }
function readDiff(file?: string): string {
  try {
    if (file && file !== "-" && existsSync(file)) return readFileSync(file, "utf8");
    return readFileSync(0, "utf8"); // stdin
  } catch { return ""; }
}
function splitList(v?: string): string[] { return typeof v === "string" && v.trim() ? v.split(",").map((s) => s.trim()).filter(Boolean) : []; }

export function registerPceCommands(program: Command): void {
  const cmd = program
    .command("pce")
    .description("💎 PCE — Proof-Carrying Edit. Attach a SIGNED certificate to an AI's diff that statically PROVES what it does/doesn't do — which paths it touches, whether it stays inside a declared --scope, the dangerous primitives it introduces (eval/childProcess/fsDelete/network/dynamicImport), add/delete balance, and secret literals. A reviewer/CI verifies it OFFLINE (trusts the analysis, not the author); tampering with the diff OR the cert is caught. Exit 2 on BLOCK. HONEST: static lexical+structural analysis — proves declared checkable properties, NOT total runtime safety.")
    .argument("[action]", "omit to certify; 'verify' to check a passport")
    .option("--diff <file>", "unified diff file (default: stdin)")
    .option("--scope <globs>", "comma-separated allowed path globs (e.g. \"src/**,test/**\")")
    .option("--forbid <names>", "comma-separated primitives to BLOCK: eval,childProcess,fsDelete,network,dynamicImport")
    .option("--passport <file>", "(verify) the passport JSON to check against the diff")
    .option("--json", "JSON output")
    .action((action: string | undefined, opts: { diff?: string; scope?: string; forbid?: string; passport?: string; json?: boolean }) => {
      const diff = readDiff(opts.diff);
      const analysisOpts = { declaredScope: splitList(opts.scope), forbidPrimitives: splitList(opts.forbid) };

      if (action === "verify") {
        if (!opts.passport || !existsSync(opts.passport)) { out("✗ --passport <file> required for verify"); process.exitCode = 2; return; }
        let passport: pce.Passport;
        try { const j = JSON.parse(readFileSync(opts.passport, "utf8")); passport = (j.passport ?? j) as pce.Passport; } catch { out("✗ could not parse passport JSON"); process.exitCode = 2; return; }
        const v = pce.verifyPassport(diff, passport, analysisOpts);
        if (opts.json) { out(JSON.stringify(v, null, 2)); } else { out(`${v.ok ? "✓ VERIFIED" : "🛑 INVALID"} — ${v.reason}`); }
        process.exitCode = v.ok ? 0 : 2; return;
      }

      const passport = pce.buildPassport(diff, analysisOpts);
      const cwd = process.cwd();
      let receipt: unknown = null;
      try { receipt = notary.issueReceipt(cwd, { kind: "claim-verdict", subject: `pce:${passport.verdict}:${passport.diffHash.slice(0, 12)}`, payload: { diffHash: passport.diffHash, verdict: passport.verdict, propsHash: undefined }, includePayload: true }); } catch { /* */ }

      if (opts.json) { out(JSON.stringify({ passport, signed: receipt }, null, 2)); process.exitCode = passport.verdict === "BLOCK" ? 2 : 0; return; }
      const icon = passport.verdict === "PASS" ? "🟢" : passport.verdict === "REVIEW" ? "🟡" : "🛑";
      const p = passport.properties;
      out(`${icon} PCE ${passport.verdict} — ${p.touchedPaths.length} file(s), net ${p.netLines >= 0 ? "+" : ""}${p.netLines} lines`);
      for (const path of p.touchedPaths.slice(0, 20)) out(`   • ${path}`);
      const intro = Object.entries(p.introducedPrimitives).filter(([, v]) => v).map(([k]) => k);
      if (intro.length) out(`   primitives introduced: ${intro.join(", ")}`);
      if (p.secretsAdded) out(`   ⚠ secret-looking literal added`);
      if (!p.inScope) out(`   ⚠ out of scope: ${p.outOfScopePaths.join(", ")}`);
      for (const r of passport.reasons) out(`   → ${r}`);
      out(`   diffHash ${passport.diffHash.slice(0, 16)}… ${receipt ? "· signed (verify offline with the NOTARY public key)" : ""}`);
      process.exitCode = passport.verdict === "BLOCK" ? 2 : 0;
    });
  void cmd;
}
