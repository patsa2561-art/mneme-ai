/**
 * `mneme canon` (v2.149.0) — the Accountability-Record Standard (CANON/1). Emit
 * + verify a versioned, Ed25519 offline-verifiable record of "an AI did/decided
 * X, here's the proof" that ANY party can check with the public key alone.
 *
 *   mneme canon emit --kind command-gate --subject "rm -rf /" --verdict BLOCK > rec.json
 *   mneme canon verify --record rec.json    # offline: conformance + body-binds-id + Ed25519 sig
 *   mneme canon spec                         # the published schema
 */

import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { canon, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

export function registerCanonCommands(program: Command): void {
  const c = program
    .command("canon")
    .description("📜 CANON — the Accountability-Record Standard: a versioned, Ed25519 OFFLINE-verifiable record of an AI decision/action that ANY auditor / insurer / regulator / competitor can emit + verify with the public key alone, without trusting Mneme. The neutral 'NVD/Visa-of-AI' format on the NOTARY spine; binds the payload by hash (proves what was decided without exposing it), chains by lineage. The moat: a model isn't a moat, but if the canonical FORMAT everyone accepts is yours, everyone speaks it.");

  c.command("emit")
    .description("emit a signed CANON/1 accountability record.")
    .requiredOption("--kind <k>", "command-gate | diff | claim-verdict | agent-action | value-event | siege | memory-capsule | other")
    .requiredOption("--subject <s>", "what the record is about")
    .requiredOption("--verdict <v>", "the decision (ALLOW/BLOCK/PASS/REFUTED/…)")
    .option("--payload <json>", "the underlying payload (bound by hash, not exposed)")
    .option("--lineage <id>", "prev record id (chain)")
    .action((opts: { kind: string; subject: string; verdict: string; payload?: string; lineage?: string }) => {
      let payload: unknown = undefined;
      try { payload = opts.payload ? JSON.parse(opts.payload) : undefined; } catch { payload = opts.payload; }
      const rec = canon.buildRecord({ kind: opts.kind, subject: opts.subject, verdict: opts.verdict, payload, lineage: opts.lineage ?? null, ts: Date.now() });
      // sign the recordId with NOTARY (Ed25519, offline-verifiable); embed issuer + sig
      try {
        const receipt = notary.issueReceipt(process.cwd(), { kind: "claim-verdict", subject: `canon:${rec.kind}:${rec.recordId.slice(0, 12)}`, payload: { recordId: rec.recordId }, includePayload: true }) as { signature?: string; publicKey?: string; pubkey?: string };
        rec.issuer = (receipt.publicKey ?? receipt.pubkey ?? "ed25519:notary");
        rec.sig = receipt.signature ?? null;
        // re-derive recordId now that issuer is set (issuer is part of the signed body)
        rec.recordId = createHash("sha256").update(canon.canonicalize(rec)).digest("hex");
      } catch { /* still emit unsigned-but-conformant */ }
      out(JSON.stringify(rec, null, 2));
    });

  c.command("verify")
    .description("verify a CANON record OFFLINE: conformance + version + body-binds-recordId (exit 2 if invalid).")
    .requiredOption("--record <file>", "the record JSON ('-' for stdin)")
    .option("--json", "JSON output")
    .action((opts: { record: string; json?: boolean }) => {
      let rec: canon.AccountabilityRecord;
      try { const raw = opts.record === "-" ? readFileSync(0, "utf8") : readFileSync(opts.record, "utf8"); rec = JSON.parse(raw); } catch { out("✗ could not read/parse record"); process.exitCode = 2; return; }
      const v = canon.verifyRecord(rec);
      if (opts.json) { out(JSON.stringify(v, null, 2)); process.exitCode = v.ok ? 0 : 2; return; }
      out(`${v.ok ? "✓ VALID" : "🛑 INVALID"} — ${v.reason}`);
      out(`   conformant=${v.conformant} · recordId-binds-body=${v.recordIdValid}`);
      process.exitCode = v.ok ? 0 : 2;
    });

  c.command("spec").description("print the published CANON spec (schema + version policy).").option("--json", "JSON").action((opts: { json?: boolean }) => {
    if (opts.json) { out(JSON.stringify(canon.SPEC, null, 2)); return; }
    out(`📜 CANON/${canon.CANON_VERSION} — required: ${canon.SPEC.required.join(", ")}`);
    out(`   kinds: ${canon.SPEC.kinds.join(" · ")}`);
    out(`   verify: ${canon.SPEC.verify}`);
    out(`   versions: ${canon.SPEC.versionPolicy}`);
  });
}
