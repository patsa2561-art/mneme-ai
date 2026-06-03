/**
 * TRUSTLESS MCP — the verifier surface. With MNEME_TRUSTLESS enabled, every tool
 * result carries an Ed25519 `_proof` over its data; `mneme.mcp.verify` lets the
 * calling model CHECK any such result OFFLINE (no network, no trusting Mneme)
 * instead of believing it. The A/B that proves the value is in trustlessGauntlet.
 */
import type { MnemeTool } from "./_types.js";

const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const TRUSTLESS_TOOLS: MnemeTool[] = [
  {
    name: "mneme.mcp.verify",
    category: "meta",
    description: "🔏 TRUSTLESS MCP — verify a proof-carrying tool result OFFLINE. Pass a result object that carries a `_proof` (Ed25519 over the SHA-256 of its data); returns valid/invalid + the reason + the issuer fingerprint. It catches a tampered `data`, a forged receipt, and a proof stolen from another result; a result with NO `_proof` is reported unverifiable (the status quo — you'd have to TRUST it). No network, no trusting Mneme — just the embedded public key. Enable proof-carrying results server-wide with MNEME_TRUSTLESS=1. HONEST: this attests PROVENANCE + INTEGRITY (who produced it + that it wasn't altered), NOT that the answer is semantically correct.",
    whenToUse: "When you receive an MCP tool result that carries a `_proof` and you want to confirm it is genuine + untampered before acting on it — especially for results that cross agents or that you'll persist. Run it on the whole result object.",
    triggers: ["verify tool result", "is this result genuine", "check _proof", "trustless mcp", "proof carrying", "did this result get tampered"],
    inputSchema: {
      type: "object",
      properties: {
        result: { type: "object", description: "the tool result object (must carry a `_proof` to be verifiable)." },
      },
      required: ["result"],
    },
    outputSchema: { type: "object" },
    handler: async (_rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const result = args["result"];
        if (result === null || typeof result !== "object") return low("expected { result: object }");
        const v = core.trustless.verifyToolResult(result);
        return {
          data: { valid: v.valid, reason: v.reason, ...(v.issuerFingerprint ? { issuerFingerprint: v.issuerFingerprint } : {}) },
          wisdom: v.valid ? `✓ result verified offline — genuine + untampered (issuer ${v.issuerFingerprint ?? "?"})` : `🛑 unverified — ${v.reason}`,
          followUp: [],
          confidence: { level: "high" as const },
        };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
