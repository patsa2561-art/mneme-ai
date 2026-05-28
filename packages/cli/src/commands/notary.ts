/**
 * v2.79.0 — `mneme notary <action>`
 *
 * Portable proof-of-provenance receipts (Ed25519). Verify with a public key
 * alone — no Mneme, no network, no shared secret.
 *
 *   mneme notary pubkey            — show this repo's issuer public key + fingerprint
 *   mneme notary issue   --subject S [--kind K] [--payload JSON] [--no-payload] [--prev ID]
 *   mneme notary verify  <file|->  — verify a receipt OFFLINE (exit 0 valid, 1 invalid)
 */

import { writeSync, readFileSync } from "node:fs";
import * as core from "@mneme-ai/core";
import { parseJsonArg } from "../util/json_arg.js";

function out(s: string): void {
  try { writeSync(1, s); } catch { process.stdout.write(s); }
}

export interface NotaryOpts {
  cwd: string;
  action: string;
  subject?: string;
  kind?: string;
  payload?: string;
  noPayload?: boolean;
  prev?: string;
  file?: string;
  json?: boolean;
}

const KINDS = new Set(["claim-verdict", "protocol-hop", "memory-capsule", "reasoning-trace", "generic"]);

export async function notaryCommand(opts: NotaryOpts): Promise<number> {
  const { getIssuerKeyPair, issueReceipt, verifyReceipt } = core.notary;

  if (opts.action === "pubkey" || opts.action === "keygen") {
    const kp = getIssuerKeyPair(opts.cwd);
    if (opts.json) { out(JSON.stringify({ alg: "ed25519", fingerprint: kp.fingerprint, publicKeyB64: kp.publicKeyB64 }, null, 2) + "\n"); return 0; }
    out(`🪪 MNEME NOTARY — issuer public key (this repo)\n\n  alg:         ed25519\n  fingerprint: ${kp.fingerprint}\n  publicKey:   ${kp.publicKeyB64}\n\n  Share the public key. Anyone can verify your receipts offline with it.\n  The private key stays in .mneme/notary/issuer.key (never shared).\n`);
    return 0;
  }

  if (opts.action === "issue") {
    if (!opts.subject) { out("✗ issue requires --subject\n"); return 2; }
    const kind = opts.kind && KINDS.has(opts.kind) ? opts.kind as core.notary.ReceiptKind : "generic";
    let payload: unknown = undefined;
    if (opts.payload) {
      try { payload = parseJsonArg(opts.payload); } catch { out("✗ --payload is not valid JSON\n"); return 2; }
    }
    const r = issueReceipt(opts.cwd, {
      kind, subject: opts.subject, payload,
      includePayload: !opts.noPayload, prev: opts.prev ?? null,
    });
    out(JSON.stringify(r, null, 2) + "\n");
    return 0;
  }

  if (opts.action === "verify") {
    let raw: string;
    try {
      raw = opts.file && opts.file !== "-" ? readFileSync(opts.file, "utf8") : readFileSync(0, "utf8");
    } catch (e) {
      out(`✗ cannot read receipt: ${(e as Error).message}\n`); return 2;
    }
    let receipt: unknown;
    try { receipt = JSON.parse(raw); } catch { out("✗ receipt is not valid JSON\n"); return 2; }
    const v = verifyReceipt(receipt);
    if (opts.json) { out(JSON.stringify(v, null, 2) + "\n"); return v.valid ? 0 : 1; }
    if (v.valid) {
      out(`🟢 VALID — signature verifies offline against the embedded public key.\n  issuer:   ${v.issuerFingerprint}\n  kind:     ${v.kind}\n  subject:  ${v.subject}\n`);
      return 0;
    }
    out(`🔴 INVALID — ${v.reason}\n`);
    return 1;
  }

  out(`✗ Unknown notary action "${opts.action}". Try: pubkey | issue | verify\n`);
  return 2;
}
