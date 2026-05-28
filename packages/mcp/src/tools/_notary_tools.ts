/**
 * v2.79.0 — NOTARY MCP tool surface.
 *
 *   mneme.notary.pubkey  — this repo's Ed25519 issuer public key + fingerprint
 *   mneme.notary.issue   — mint a signed proof-of-provenance receipt
 *   mneme.notary.verify  — verify a receipt OFFLINE with the embedded public key
 *
 * The TRUST FABRIC spine: portable, signed receipts that any third party
 * (vendor / auditor / court / insurer) verifies WITHOUT trusting Mneme.
 */

import type { MnemeTool } from "./_types.js";

export const notaryPubkeyTool: MnemeTool = {
  name: "mneme.notary.pubkey",
  category: "meta",
  description:
    "🪪 NOTARY — return this repo's Ed25519 issuer PUBLIC key + 16-hex fingerprint. Share it so anyone can verify your notarized receipts offline. The private key never leaves .mneme/notary/issuer.key.",
  whenToUse: "Before sharing notarized receipts with a third party — give them the public key (or fingerprint) so they can verify authenticity.",
  triggers: ["notary pubkey", "issuer public key", "notary identity"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const kp = core.notary.getIssuerKeyPair(cwd);
      return { data: { alg: "ed25519", fingerprint: kp.fingerprint, publicKeyB64: kp.publicKeyB64 }, wisdom: `issuer ${kp.fingerprint} (ed25519)`, followUp: [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "pubkey failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const notaryIssueTool: MnemeTool = {
  name: "mneme.notary.issue",
  category: "meta",
  description:
    "🪪 NOTARY — mint an Ed25519-signed proof-of-provenance receipt. kind ∈ claim-verdict | protocol-hop | memory-capsule | reasoning-trace | generic. Attests `subject` + optional `payload` (set hashOnly to omit the inline payload for privacy — only its hash is signed). Chain via `prev` (a previous receiptId). The receipt is self-describing: it embeds the issuer public key, so the returned JSON verifies offline anywhere.",
  whenToUse: "When a fact/decision/hop must survive leaving Mneme with a portable, unforgeable, attributable proof — e.g. attest a verify verdict before handing off to another vendor, or notarize a cross-protocol hop.",
  triggers: ["notary issue", "mint receipt", "sign a receipt", "notarize"],
  inputSchema: {
    type: "object",
    required: ["subject"],
    properties: {
      subject: { type: "string", description: "What the receipt attests (an id, a hash, a URL)." },
      kind: { type: "string", description: "claim-verdict | protocol-hop | memory-capsule | reasoning-trace | generic" },
      payload: { description: "Arbitrary JSON payload to attest (hashed into payloadHash)." },
      hashOnly: { type: "boolean", description: "Omit the inline payload — sign only its hash (privacy)." },
      prev: { type: "string", description: "Previous receiptId to chain onto." },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const kinds = new Set(["claim-verdict", "protocol-hop", "memory-capsule", "reasoning-trace", "generic"]);
      const kind = (typeof args["kind"] === "string" && kinds.has(args["kind"] as string) ? args["kind"] : "generic") as import("@mneme-ai/core").notary.ReceiptKind;
      const r = core.notary.issueReceipt(cwd, {
        kind,
        subject: String(args["subject"] ?? ""),
        payload: args["payload"],
        includePayload: args["hashOnly"] !== true,
        prev: typeof args["prev"] === "string" ? args["prev"] as string : null,
      });
      return { data: { receipt: r, receiptId: r.receiptId, issuer: r.issuerFingerprint }, wisdom: `receipt ${r.receiptId.slice(0, 12)}… signed by ${r.issuerFingerprint}`, followUp: ["mneme.notary.verify"], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "issue failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const notaryVerifyTool: MnemeTool = {
  name: "mneme.notary.verify",
  category: "meta",
  description:
    "🪪 NOTARY — verify a proof receipt OFFLINE using only its embedded public key (no Mneme, no network, no shared secret). Rejects tampering: a flipped payload, a forged subject, a broken receiptId, or a swapped-in foreign issuer key all fail. Optionally assert the issuer is one you trust via expectedIssuerFingerprint.",
  whenToUse: "Before trusting any notarized receipt handed to you by another agent/vendor — confirm the signature + (optionally) that it came from the issuer you expect.",
  triggers: ["notary verify", "verify receipt", "check this receipt"],
  inputSchema: {
    type: "object",
    required: ["receipt"],
    properties: {
      receipt: { description: "The receipt object (or JSON string)." },
      expectedIssuerFingerprint: { type: "string", description: "Optional: assert the issuer fingerprint you trust." },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    void rt;
    try {
      const core = await import("@mneme-ai/core");
      let receipt: unknown = args["receipt"];
      if (typeof receipt === "string") { try { receipt = JSON.parse(receipt); } catch { /* leave as string → fails verify */ } }
      const opts = typeof args["expectedIssuerFingerprint"] === "string" ? { expectedIssuerFingerprint: args["expectedIssuerFingerprint"] as string } : {};
      const v = core.notary.verifyReceipt(receipt, opts);
      return { data: v, wisdom: v.valid ? `🟢 VALID — issuer ${v.issuerFingerprint}` : `🔴 INVALID — ${v.reason}`, followUp: [], confidence: { level: v.valid ? "high" as const : "medium" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "verify failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const NOTARY_TOOLS: MnemeTool[] = [
  notaryPubkeyTool,
  notaryIssueTool,
  notaryVerifyTool,
];
