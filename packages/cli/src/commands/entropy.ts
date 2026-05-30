/**
 * `mneme entropy` (v2.108.0) — audited multi-source secrets. Mixes the OS
 * CSPRNG + timing jitter + any physical/beacon sample you feed it, health-
 * checks them, and emits a secret with a SIGNED provenance attestation
 * (which sources, their health, the secret's hash — never the secret). Total.
 */

import type { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

function writeJson(p: unknown): void { process.stdout.write(JSON.stringify(p, null, 2) + "\n"); }
function writeText(l: string): void { process.stdout.write(l + "\n"); }

interface CoreEntropy {
  entropy: {
    generateSecret: (repo: string, sources: Array<{ id: string; data: string | Buffer; encoding?: string }>, outBytes: number, at: number) => { secretHex: string; sourceIds: string[]; sourceHealth: Array<{ id: string; passed: boolean; minEntropyBitsPerByte: number }>; outputHealth: { passed: boolean; minEntropyBitsPerByte: number }; attestation: unknown };
    verifySecretAttestation: (att: unknown, secretHex: string) => { valid: boolean; bound: boolean; reason: string };
    healthCheck: (b: string | Buffer) => { passed: boolean; monobit: number; minEntropyBitsPerByte: number };
  };
}
async function core(): Promise<CoreEntropy | null> {
  try { const c = (await import("@mneme-ai/core")) as unknown as CoreEntropy; if (c.entropy) return c; } catch { /* */ }
  return null;
}

/** Gather a (weak, supplementary) timing-jitter sample — defense in depth. */
function jitterSample(rounds = 4096): Buffer {
  const acc: number[] = [];
  let prev = Number(process.hrtime.bigint() & 0xffn);
  for (let i = 0; i < rounds; i++) {
    const t = Number(process.hrtime.bigint() & 0xffn);
    acc.push((t ^ prev) & 0xff); prev = t;
    if (acc.length >= 256) break;
  }
  return Buffer.from(acc);
}

export function registerEntropyCommands(program: Command): void {
  const e = program
    .command("entropy")
    .description("🎲 AUDITED ENTROPY — generate secrets/keys by MIXING every entropy source you have (OS CSPRNG + timing jitter + any physical/beacon sample), health-checked, with a SIGNED provenance attestation. Defense-in-depth + auditable; NOT a claim of magic unhackability.");

  e.command("gen")
    .description("Generate a secret from mixed, health-checked sources + a signed provenance attestation.")
    .option("--bytes <n>", "secret length in bytes", (v) => parseInt(v, 10), 32)
    .option("--physical <s>", "a physical/external sample to mix in (sensor reading, dice rolls, etc.)")
    .option("--beacon-file <f>", "file with public randomness-beacon bytes to mix in")
    .option("--hash-only", "print only the secret's hash + attestation (don't reveal the secret)")
    .option("--json", "JSON output.")
    .action(async (opts: { bytes?: number; physical?: string; beaconFile?: string; hashOnly?: boolean; json?: boolean }) => {
      const m = await core(); if (!m) { writeText("✗ core unavailable"); process.exitCode = 1; return; }
      const cwd = process.cwd();
      const sources: Array<{ id: string; data: string | Buffer; encoding?: string }> = [
        { id: "os-csprng", data: randomBytes(64) },
        { id: "timing-jitter", data: jitterSample() },
      ];
      if (opts.physical) sources.push({ id: "physical", data: opts.physical });
      if (opts.beaconFile && existsSync(opts.beaconFile)) { try { sources.push({ id: "beacon", data: readFileSync(opts.beaconFile) }); } catch { /* */ } }
      const sec = m.entropy.generateSecret(cwd, sources, opts.bytes ?? 32, Date.now());
      // persist the attestation (not the secret) for later verification
      try { const dir = join(cwd, ".mneme", "entropy"); if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "last_attestation.json"), JSON.stringify(sec.attestation, null, 2)); } catch { /* */ }
      if (opts.json) { writeJson({ secret: opts.hashOnly ? undefined : sec.secretHex, sourceIds: sec.sourceIds, sourceHealth: sec.sourceHealth, outputHealth: sec.outputHealth, attestation: sec.attestation }); return; }
      writeText(`🎲 secret (${(opts.bytes ?? 32)} bytes) — sources: ${sec.sourceIds.join(" + ")}`);
      if (!opts.hashOnly) writeText(`  ${sec.secretHex}`);
      writeText(`  output health: ${sec.outputHealth.passed ? "✓ passed" : "✗ failed"} · est. min-entropy ${sec.outputHealth.minEntropyBitsPerByte}/8 bits/byte`);
      for (const h of sec.sourceHealth) writeText(`    ${h.passed ? "✓" : "⚠"} ${h.id}: min-entropy ${h.minEntropyBitsPerByte}`);
      writeText(`  ✓ signed provenance attestation → .mneme/entropy/last_attestation.json (verify with: mneme entropy verify)`);
    });

  e.command("verify")
    .description("Verify a secret's provenance attestation offline (signature + that the secret matches, without the attestation ever containing it).")
    .requiredOption("--secret <hex>", "the secret (hex) to verify")
    .option("--attestation-file <f>", "attestation JSON (default: .mneme/entropy/last_attestation.json)")
    .option("--json", "JSON output.")
    .action(async (opts: { secret: string; attestationFile?: string; json?: boolean }) => {
      const m = await core(); if (!m) { writeText("✗ core unavailable"); process.exitCode = 1; return; }
      const path = opts.attestationFile || join(process.cwd(), ".mneme", "entropy", "last_attestation.json");
      if (!existsSync(path)) { writeText(`✗ no attestation at ${path}`); process.exitCode = 1; return; }
      let att: unknown; try { att = JSON.parse(readFileSync(path, "utf8")); } catch { writeText("✗ attestation not valid JSON"); process.exitCode = 1; return; }
      const v = m.entropy.verifySecretAttestation(att, opts.secret);
      if (opts.json) { writeJson(v); process.exitCode = v.bound ? 0 : 1; return; }
      writeText(v.bound ? `✓ VERIFIED — ${v.reason}` : `✗ NOT VERIFIED — ${v.reason}`);
      process.exitCode = v.bound ? 0 : 1;
    });

  e.command("health")
    .description("Health-check a byte sample (monobit / runs / min-entropy) — catches a stuck or degraded entropy source.")
    .requiredOption("--file <f>", "file to check")
    .option("--json", "JSON output.")
    .action(async (opts: { file: string; json?: boolean }) => {
      const m = await core(); if (!m) { writeText("✗ core unavailable"); process.exitCode = 1; return; }
      if (!existsSync(opts.file)) { writeText("✗ file not found"); process.exitCode = 1; return; }
      const h = m.entropy.healthCheck(readFileSync(opts.file));
      if (opts.json) { writeJson(h); process.exitCode = h.passed ? 0 : 1; return; }
      writeText(`${h.passed ? "✓ passed" : "✗ FAILED"} — monobit ${h.monobit.toFixed(3)} · est. min-entropy ${h.minEntropyBitsPerByte.toFixed(2)}/8`);
      process.exitCode = h.passed ? 0 : 1;
    });
}
