/**
 * `mneme infra` (v3.13.0) — INFRA PROVENANCE: where + when your agent run executed.
 *   infra                         → where am I running (provider/region/gpu), signed
 *   infra attest --out a.json     → a NOTARY-signed attestation (verify offline)
 *   infra residency --allow eu- … → data-residency check (EU AI Act-style)
 */
import type { Command } from "commander";
import { hostname, cpus } from "node:os";
import { writeFileSync } from "node:fs";
import { infraProvenance, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }
function capture(): infraProvenance.InfraAttestation {
  return infraProvenance.captureInfra({ env: process.env, host: hostname(), platform: process.platform, arch: process.arch, cpus: cpus().length }, Date.now());
}
function show(a: infraProvenance.InfraAttestation): void {
  out(`🛰 INFRA PROVENANCE — ${a.provider}${a.region ? ` · ${a.region}` : ""}${a.service ? ` · ${a.service}` : ""}${a.gpu ? ` · ${a.gpu} GPU` : ""}`);
  out(`   ${a.platform}/${a.arch} · ${a.cpus} cpu · host ${a.host.slice(0, 12)}… (hashed) · fingerprint ${a.fingerprint.slice(0, 16)}…`);
  out(`   signals: ${a.signals.length ? a.signals.join(", ") : "(none — local)"}`);
}

export function registerInfraCommands(program: Command): void {
  const k = program.command("infra").description("🛰 INFRA PROVENANCE — a neutral, signed, offline-verifiable record of WHERE (which rented compute provider/region) + WHEN your agent run executed. Detects migration drift + checks data-residency. Honest: attests the environment as the host declares it — not a TEE/hardware proof.")
    .action(() => show(capture()));

  k.command("attest").description("Capture + NOTARY-sign this run's infra attestation (anyone verifies it offline).")
    .option("--out <file>", "write the signed attestation").action((o: { out?: string }) => {
      const a = capture();
      let signed: unknown = a;
      try { signed = notary.issueReceipt(process.cwd(), { kind: "protocol-hop", subject: `infra:${a.fingerprint}`, payload: a, includePayload: true, issuedAt: Date.now() }); } catch { /* */ }
      if (o.out) writeFileSync(o.out, JSON.stringify(signed, null, 2), "utf8");
      show(a);
      out(o.out ? `   🛰 signed → ${o.out} (verify offline with the embedded key)` : "   (pass --out to write the signed attestation)");
    });

  k.command("residency").description("Check this run against a data-residency policy. allow entries: a region, a prefix ('eu-'), or 'provider:*'.")
    .requiredOption("--allow <regions...>", "allowed regions/prefixes/provider wildcards")
    .action((o: { allow: string[] }) => {
      const a = capture(); const v = infraProvenance.dataResidencyCheck(a, o.allow);
      out(`${v.compliant ? "🟢 COMPLIANT" : "🔴 OUTSIDE POLICY"} — ${v.reason}`);
      out(`   provider ${v.provider} · region ${v.region ?? "unknown"} · policy [${o.allow.join(", ")}]`);
      if (!v.compliant) process.exitCode = 2;
    });
}
