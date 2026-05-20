/**
 * v2.19.86 — `mneme honesty` CLI (IDEA #3).
 *
 * Mint + verify Mneme Honesty Certificates from the local pulse ledger.
 * Vendors take the emitted SVG and drop it on their landing page; anyone
 * with the same Mneme install (or a future federated trust graph) can
 * re-verify the HMAC signature.
 *
 * Subcommands:
 *   mint   --vendor <v> [--window-days 30] [--valid-days 30] [--output cert.svg]
 *   verify --svg <path>      OR     --cert '<json>'
 *   list                      shows mint history for this machine
 */

import { resolve } from "node:path";
import { writeFileSync, readFileSync, existsSync } from "node:fs";

export interface HonestyCommandOptions {
  cwd: string;
  mode: "mint" | "verify" | "list";
  vendor?: string;
  windowDays?: number;
  validDays?: number;
  output?: string;
  svgPath?: string;
  certJson?: string;
  json?: boolean;
}

const BANNER = "🏆 MNEME HONESTY";

export async function honestyCommand(opts: HonestyCommandOptions): Promise<void> {
  const core = await import("@mneme-ai/core");
  const repoRoot = resolve(opts.cwd);

  if (opts.mode === "mint") {
    if (!opts.vendor) { process.stderr.write("honesty mint requires --vendor\n"); process.exit(1); return; }
    const windowDays = opts.windowDays ?? 30;
    const events = core.worldPulse.readPulseEvents(repoRoot);
    const agg = core.worldPulse.aggregatePulse(events, { windowHours: windowDays * 24 });
    const score = core.honestyCert.computeHonestyScore(agg, opts.vendor, { windowDays });
    const cert = core.honestyCert.mintCert(repoRoot, score, { validDays: opts.validDays });
    const svg = core.honestyCert.renderCertSvg(cert);
    if (opts.output) {
      writeFileSync(opts.output, svg, "utf8");
    }
    if (opts.json) {
      process.stdout.write(JSON.stringify({ ok: true, cert, score, svg, outputPath: opts.output ?? null }, null, 2) + "\n");
      return;
    }
    process.stdout.write(`${BANNER} — certificate minted\n\n`);
    process.stdout.write(`  vendor:    ${cert.vendor}\n`);
    process.stdout.write(`  tier:      ${cert.band.toUpperCase()}\n`);
    process.stdout.write(`  honesty:   ${(cert.honestyPct * 100).toFixed(1)}%  (raw)\n`);
    process.stdout.write(`  WilsonLB:  ${(cert.wilsonLowerBound * 100).toFixed(1)}%  (Wilson 95% lower bound)\n`);
    process.stdout.write(`  samples:   ${cert.sampleSize}\n`);
    process.stdout.write(`  window:    ${cert.windowDays} days\n`);
    process.stdout.write(`  expires:   ${cert.validUntil.slice(0, 10)}\n`);
    process.stdout.write(`  cert id:   ${cert.certId}\n`);
    process.stdout.write(`  issuer:    ${cert.issuer}\n`);
    if (opts.output) {
      process.stdout.write(`\n  📜 SVG written to: ${opts.output}\n`);
      process.stdout.write(`  Drop the SVG into any landing page — it self-verifies via the embedded payload.\n`);
    } else {
      process.stdout.write(`\n  (pass --output cert.svg to write the embeddable badge)\n`);
    }
    return;
  }

  if (opts.mode === "verify") {
    let result: ReturnType<typeof core.honestyCert.verifyCert>;
    if (opts.svgPath) {
      if (!existsSync(opts.svgPath)) { process.stderr.write(`SVG not found: ${opts.svgPath}\n`); process.exit(1); return; }
      const svg = readFileSync(opts.svgPath, "utf8");
      result = core.honestyCert.verifyCertSvg(repoRoot, svg);
    } else if (opts.certJson) {
      try {
        const cert = JSON.parse(opts.certJson) as Parameters<typeof core.honestyCert.verifyCert>[1];
        result = core.honestyCert.verifyCert(repoRoot, cert);
      } catch {
        process.stderr.write("--cert must be a valid JSON object\n"); process.exit(1); return;
      }
    } else {
      process.stderr.write("honesty verify requires --svg <path> or --cert '<json>'\n"); process.exit(1); return;
    }
    if (opts.json) { process.stdout.write(JSON.stringify(result, null, 2) + "\n"); }
    else {
      const badge = result.valid ? "✅ VALID" : "❌ INVALID";
      process.stdout.write(`${BANNER} — verify\n\n  ${badge}   reason: ${result.reason}\n`);
      if (result.cert) {
        process.stdout.write(`  vendor:    ${result.cert.vendor}\n`);
        process.stdout.write(`  tier:      ${result.cert.band.toUpperCase()}\n`);
        process.stdout.write(`  honesty:   ${(result.cert.honestyPct * 100).toFixed(1)}%\n`);
      }
      if (result.expiresInDays != null) process.stdout.write(`  expires in: ${result.expiresInDays} days\n`);
    }
    if (!result.valid) process.exit(2);
    return;
  }

  if (opts.mode === "list") {
    const certs = core.honestyCert.listCerts(repoRoot);
    if (opts.json) { process.stdout.write(JSON.stringify({ certs }, null, 2) + "\n"); return; }
    process.stdout.write(`${BANNER} — ${certs.length} certs minted on this machine\n\n`);
    for (const c of certs) {
      const valid = Date.parse(c.validUntil) > Date.now() ? "✓" : "⨯";
      process.stdout.write(`  ${valid} ${c.certId.padEnd(20)} ${c.vendor.padEnd(12)} ${c.band.toUpperCase().padEnd(11)} ${(c.honestyPct * 100).toFixed(0).padStart(3)}%  exp ${c.validUntil.slice(0, 10)}\n`);
    }
    return;
  }
}
