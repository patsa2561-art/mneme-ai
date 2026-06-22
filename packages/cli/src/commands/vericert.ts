/**
 * `mneme certify` (v3.120.0) — VERICERT: stamp an AI-worker deliverable with a
 * signed, offline-verifiable "Verified-by-Mneme" certificate (CERTIFIED /
 * CONDITIONAL / REJECTED) — the trust layer for the AI-worker economy.
 *
 *   mneme certify "the build always works and never fails"
 *   cat report.md | mneme certify -            # certify a file/stdin
 *   mneme certify verify --cert cert.json [--deliverable report.md]
 */

import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { vericert, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

export function registerVericertCommands(program: Command): void {
  const c = program
    .command("certify")
    .alias("vericert")
    .argument("[deliverable...]", "the AI-produced deliverable ('-' = stdin)")
    .description("🎗️ VERICERT — stamp an AI-worker deliverable (report / code / answer) with a signed, offline-verifiable certificate: CERTIFIED / CONDITIONAL / REJECTED. Runs every claim through the HPE verification stack; CERTIFIED only if NO known fault (CERTIFIED-precision 1.0 — never certifies a hallucinated deliverable). The trust layer the AI-worker gold rush is missing.")
    .option("--json", "JSON output (the full signed certificate)")
    .action((deliverable: string[] | undefined, opts: { json?: boolean }) => {
      let d = Array.isArray(deliverable) ? deliverable.join(" ") : String(deliverable ?? "");
      if (d === "-") { try { d = readFileSync(0, "utf8"); } catch { /* */ } }
      if (!d.trim()) { out("usage: mneme certify \"<deliverable>\"  (or pipe a file: cat report.md | mneme certify -)"); process.exitCode = 2; return; }
      const cert = vericert.certify(d, { ts: Date.now() });
      let receipt: unknown = null;
      try { receipt = notary.issueReceipt(process.cwd(), { kind: "claim-verdict", subject: `vericert:${cert.verdict}:${cert.certId.slice(0, 12)}`, payload: { certId: cert.certId }, includePayload: true }); } catch { /* */ }
      const signed = { ...cert, signed: receipt };
      if (opts.json) { out(JSON.stringify(signed, null, 2)); process.exitCode = cert.verdict === "REJECTED" ? 2 : 0; return; }
      const icon = cert.verdict === "CERTIFIED" ? "🎗️ ✓" : cert.verdict === "CONDITIONAL" ? "🎗️ ❔" : "🎗️ 🛑";
      out(`${icon} ${cert.verdict}  (score ${(cert.score * 100).toFixed(0)}% · ${cert.trusted}/${cert.claimsChecked} claims clean)`);
      out(`   certId: ${cert.certId.slice(0, 24)}…  ${receipt ? "· Ed25519-signed (verify offline)" : ""}`);
      for (const f of cert.faults) out(`   ${f.verdict === "BLOCK" ? "🛑" : "❔"} ${f.nerves.join(",")}: ${f.claim.slice(0, 70)}`);
      if (cert.verdict === "CERTIFIED") out(`   ✓ no known fault — safe to relay (CERTIFIED = no KNOWN fault, not a proof of truth).`);
      process.exitCode = cert.verdict === "REJECTED" ? 2 : 0;
    });

  c.command("verify")
    .description("verify a VERICERT certificate OFFLINE: tamper-evidence + (optionally) that it matches the deliverable + the Ed25519 signature.")
    .requiredOption("--cert <file>", "the certificate JSON ('-' for stdin)")
    .option("--deliverable <file>", "the original deliverable to re-check against")
    .option("--json", "JSON output")
    .action((o: { cert: string; deliverable?: string; json?: boolean }) => {
      let cert: vericert.Certificate & { signed?: unknown };
      try { cert = JSON.parse(o.cert === "-" ? readFileSync(0, "utf8") : readFileSync(o.cert, "utf8")); } catch { out("✗ could not read/parse cert"); process.exitCode = 2; return; }
      let deliverable: string | undefined;
      if (o.deliverable) { try { deliverable = readFileSync(o.deliverable, "utf8"); } catch { /* */ } }
      const body = vericert.verifyCertBody(cert, deliverable);
      let sigOk: boolean | null = null;
      try { if (cert.signed) sigOk = notary.verifyReceipt(cert.signed).valid; } catch { sigOk = false; }
      if (o.json) { out(JSON.stringify({ ...body, signatureValid: sigOk }, null, 2)); process.exitCode = body.ok ? 0 : 2; return; }
      out(`${body.ok ? "✓ VALID" : "🛑 INVALID"} — ${body.reason}`);
      if (sigOk !== null) out(`   Ed25519 signature: ${sigOk ? "✓ valid (offline)" : "🛑 invalid"}`);
      process.exitCode = body.ok ? 0 : 2;
    });
}
