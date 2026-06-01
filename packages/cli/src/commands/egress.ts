/**
 * `mneme egress` (v2.118.0) — SOVEREIGN EGRESS GUARD. Scan an outbound AI
 * payload at the boundary: pattern-redact known secrets, trip on honeytoken
 * canaries (exfiltration), catch registered secrets via a Bloom filter — and
 * emit a SIGNED certificate a risk officer can audit offline. "Our code/secrets
 * never leak to the model — with proof."
 *
 *   mycmd-context | mneme egress scan                 # scan stdin
 *   mneme egress scan --file out.txt --json           # structured + signed
 *   mneme egress seed-canary                           # plant a tripwire token
 *
 * Zero config: canaries from .mneme/egress/canaries.txt, secret fingerprints
 * from .mneme/egress/secrets.txt (gitignored; never stored in the cert).
 */

import type { Command } from "commander";
import { existsSync, readFileSync, mkdirSync, appendFileSync, writeFileSync, openSync, readSync, closeSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";

/** Bounded-memory chunked file reader (one buffer at a time). Secrets/canaries
 *  are ASCII, so a rare UTF-8 split only affects non-ASCII glyphs in the echoed
 *  redacted output, never detection. */
function* readFileChunks(path: string, size = 65536): Generator<string> {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.allocUnsafe(size); let n: number;
    while ((n = readSync(fd, buf, 0, size, null)) > 0) yield buf.toString("utf8", 0, n);
  } finally { closeSync(fd); }
}

function writeJson(p: unknown): void { process.stdout.write(JSON.stringify(p, null, 2) + "\n"); }
function writeText(l: string): void { process.stdout.write(l + "\n"); }

type EgressR = { verdict: string; redactedPayload: string; secretsRedacted: number; canariesTripped: string[]; bloomHits: number; entropySuspects: number; residualRisk: number; findings: Array<{ kind: string; count: number }>; contentHash: string; note: string };
interface CoreE {
  egress: {
    scanEgress: (i: unknown) => EgressR;
    scanEgressChunked: (chunks: Iterable<string>, o?: unknown) => EgressR;
    buildSecretBloom: (s: string[], o?: unknown) => unknown;
  };
  notary?: { issueReceipt: (cwd: string, o: unknown) => unknown };
}
async function core(): Promise<CoreE | null> {
  try { const c = (await import("@mneme-ai/core")) as unknown as CoreE; if (c.egress) return c; } catch { /* */ }
  return null;
}
const CANARY_FILE = ".mneme/egress/canaries.txt";
const SECRETS_FILE = ".mneme/egress/secrets.txt";
function readLines(p: string): string[] { try { return existsSync(p) ? readFileSync(p, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : []; } catch { return []; } }
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let d = ""; let done = false; const fin = () => { if (!done) { done = true; resolve(d); } };
    process.stdin.setEncoding("utf8"); process.stdin.on("data", (c) => { d += c; if (d.length > 8_000_000) fin(); });
    process.stdin.on("end", fin); process.stdin.on("error", fin); setTimeout(fin, 4000);
  });
}

export function registerEgressCommands(program: Command): void {
  const eg = program.command("egress").description("🛡 SOVEREIGN EGRESS GUARD — scan outbound AI payloads at the boundary (pattern-redact secrets + honeytoken tripwire + Bloom secret-membership), emit a SIGNED certificate. 'Code/secrets never leak — with proof.'");

  eg.command("scan")
    .description("Scan an outbound payload (stdin / --file / --text). Verdict ALLOW | REDACT | BLOCK + signed cert. Exit 2 on BLOCK (CI-gate).")
    .option("--text <t>", "payload inline (else stdin).")
    .option("--file <p>", "read payload from a file.")
    .option("--stream", "stream --file in bounded memory (for very large payloads).")
    .option("--no-entropy", "disable the Shannon-entropy structural layer (layer 4).")
    .option("--json", "JSON output (redacted payload + signed cert).")
    .action(async (opts: { text?: string; file?: string; stream?: boolean; entropy?: boolean; json?: boolean }) => {
      const m = await core(); if (!m) { writeText("✗ core unavailable"); process.exitCode = 1; return; }
      const cwd = process.cwd();
      const canaries = readLines(join(cwd, CANARY_FILE));
      const secrets = readLines(join(cwd, SECRETS_FILE));
      const secretBloom = secrets.length > 0 ? m.egress.buildSecretBloom(secrets, { m: 1 << 16, k: 5 }) : undefined;
      const entropy = opts.entropy === false ? { enabled: false } : undefined; // commander: --no-entropy ⇒ entropy=false
      let r: EgressR;
      if (opts.stream && opts.file && existsSync(opts.file)) {
        r = m.egress.scanEgressChunked(readFileChunks(opts.file), { canaries, secretBloom, entropy });
      } else {
        let payload = typeof opts.text === "string" ? opts.text : "";
        if (!payload && opts.file) { try { if (existsSync(opts.file)) payload = readFileSync(opts.file, "utf8"); } catch { /* */ } }
        if (!payload) payload = await readStdin();
        r = m.egress.scanEgress({ payload, canaries, secretBloom, entropy });
      }
      let receipt: unknown = null;
      try { receipt = m.notary?.issueReceipt(cwd, { kind: "claim-verdict", subject: `egress:${r.verdict}`, payload: { verdict: r.verdict, contentHash: r.contentHash, secretsRedacted: r.secretsRedacted, canariesTripped: r.canariesTripped.length, bloomHits: r.bloomHits, residualRisk: r.residualRisk }, includePayload: true }); } catch { /* */ }
      if (opts.json) { writeJson({ verdict: r.verdict, secretsRedacted: r.secretsRedacted, canariesTripped: r.canariesTripped.length, bloomHits: r.bloomHits, entropySuspects: r.entropySuspects, residualRisk: r.residualRisk, findings: r.findings, contentHash: r.contentHash, redactedPayload: r.redactedPayload, signed: receipt, note: r.note }); }
      else {
        const icon = r.verdict === "BLOCK" ? "🛑" : r.verdict === "REDACT" ? "✂️" : "✓";
        writeText(`${icon} EGRESS ${r.verdict} — ${r.secretsRedacted} secret(s) redacted · ${r.canariesTripped.length} canary tripwire(s) · ${r.bloomHits} registered-secret hit(s) · ${r.entropySuspects} suspected (entropy) · residual risk ${r.residualRisk}`);
        for (const f of r.findings) writeText(`   • ${f.kind}: ${f.count}`);
        if (r.verdict === "BLOCK") writeText(`   🛑 HONEYTOKEN TRIPPED — an org canary appeared in an outbound payload. This is an exfiltration signal; DO NOT send.`);
        if (receipt) writeText(`   ✓ signed egress certificate (binds payload hash ${r.contentHash.slice(0, 12)}… — verify offline with the NOTARY public key)`);
      }
      if (r.verdict === "BLOCK") process.exitCode = 2;
    });

  eg.command("seed-canary")
    .description("Plant a deterministic honeytoken canary into .mneme/egress/canaries.txt — if it ever appears in an outbound payload, the guard BLOCKs (exfiltration tripwire).")
    .option("--label <l>", "human label for the canary", "default")
    .action(async (opts: { label?: string }) => {
      const cwd = process.cwd();
      const token = `mneme-canary-${(opts.label ?? "default").replace(/[^a-z0-9_-]/gi, "")}-${randomBytes(6).toString("hex")}`;
      try {
        const p = join(cwd, CANARY_FILE);
        if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
        appendFileSync(p, token + "\n");
        // best-effort: keep canaries out of git
        try { const gi = join(cwd, ".gitignore"); const cur = existsSync(gi) ? readFileSync(gi, "utf8") : ""; if (!cur.includes(".mneme/egress/")) writeFileSync(gi, cur + (cur.endsWith("\n") || cur === "" ? "" : "\n") + ".mneme/egress/\n"); } catch { /* */ }
        writeText(`🪤 canary planted: ${token}`);
        writeText(`   Place it in a decoy config/secret. If it ever crosses egress, the guard BLOCKs + signs an alert.`);
      } catch (e) { writeText(`✗ ${(e as Error).message}`); process.exitCode = 1; }
    });
}
