/**
 * `mneme truthproof` (v3.143.0) — THE PUBLIC HONESTY LEDGER.
 *
 * Turns the zero-drift TRUTH GATE into a VISIBLE, offline-verifiable moat:
 *   emit   — reconcile every public claim + emit a signed JSON + human markdown + badge
 *   verify — verify a pasted ledger OFFLINE (Ed25519, re-derives its own math)
 *   badge  — print the honest Truth-Gate badge (green ONLY when drift+refuted=0)
 *
 *   mneme truthproof emit --out docs/HONESTY-LEDGER.json --md docs/HONESTY-LEDGER.md --badge assets/honesty-badge.svg
 *   mneme truthproof verify --file docs/HONESTY-LEDGER.json
 */

import type { Command } from "commander";
import { readFileSync, writeFileSync } from "node:fs";
import { honestyLedger } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

function version(): string {
  try { return (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version; }
  catch { return "0.0.0"; }
}

export function registerLedgerCommands(program: Command): void {
  const c = program.command("truthproof")
    .description("🛡 PUBLIC HONESTY LEDGER — a signed, offline-verifiable record that every public Mneme claim currently passes its probe (zero drift). The badge cannot be faked green. Verify offline: `mneme truthproof verify`.");

  c.command("emit").description("reconcile every claim + emit a signed public ledger (JSON + markdown + badge)")
    .option("--out <file>", "write signed JSON ledger to file")
    .option("--md <file>", "write human markdown to file")
    .option("--badge <file>", "write the SVG badge to file")
    .option("--json", "print the signed receipt JSON to stdout")
    .action(async (o: { out?: string; md?: string; badge?: string; json?: boolean }) => {
      const { ledger, receipt } = await honestyLedger.buildHonestyLedger(process.cwd(), version());
      if (o.out) writeFileSync(o.out, JSON.stringify(receipt, null, 2) + "\n");
      if (o.md) writeFileSync(o.md, honestyLedger.ledgerMarkdown(ledger, receipt) + "\n");
      if (o.badge) writeFileSync(o.badge, honestyLedger.badgeSVG(ledger.summary) + "\n");
      if (o.json) { out(JSON.stringify(receipt, null, 2)); return; }
      const s = ledger.summary;
      out(`🛡 HONESTY LEDGER — mneme@${ledger.version}`);
      out(`   ${s.honest ? "🟢 ZERO-DRIFT" : "⚠ DRIFTING"} · ${s.pass}/${s.measured} claims pass · drift ${s.drift} · refuted ${s.refuted} · unmeasured ${s.unmeasured} · score ${s.score}/100`);
      out(`   signed ${receipt.issuerFingerprint} · receipt ${receipt.receiptId.slice(0, 16)}…`);
      if (o.out || o.md || o.badge) out(`   wrote: ${[o.out, o.md, o.badge].filter(Boolean).join(", ")}`);
      else out(`   (add --out/--md/--badge to write artifacts; --json for the signed receipt)`);
    });

  c.command("verify").description("verify a public honesty ledger OFFLINE (Ed25519 + re-derives its own math)")
    .option("--file <file>", "ledger receipt JSON file")
    .action((o: { file?: string }) => {
      let raw = "";
      try { raw = o.file ? readFileSync(o.file, "utf8") : readFileSync(0, "utf8"); }
      catch { out("⛔ provide --file <ledger.json> (or pipe the JSON on stdin)"); process.exitCode = 2; return; }
      let receipt: unknown;
      try { receipt = JSON.parse(raw); } catch { out("⛔ not valid JSON"); process.exitCode = 2; return; }
      const v = honestyLedger.verifyHonestyLedger(receipt);
      if (!v.valid) { out(`🔴 INVALID — ${v.reason}`); process.exitCode = 1; return; }
      out(`🟢 VALID${v.honest ? " · HONEST (zero drift)" : " · ⚠ DRIFTING"} — ${v.summary!.pass}/${v.summary!.measured} pass, drift ${v.summary!.drift}, refuted ${v.summary!.refuted} (score ${v.summary!.score}/100)`);
      if (!v.honest) process.exitCode = 1;
    });

  c.command("badge").description("print the honest Truth-Gate badge (SVG, or --shields for shields.io JSON)")
    .option("--shields", "emit shields.io endpoint JSON instead of SVG")
    .action(async (o: { shields?: boolean }) => {
      const { ledger } = await honestyLedger.buildHonestyLedger(process.cwd(), version());
      out(o.shields ? JSON.stringify(honestyLedger.badgeShields(ledger.summary)) : honestyLedger.badgeSVG(ledger.summary));
    });
}
