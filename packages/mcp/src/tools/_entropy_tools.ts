/**
 * v2.108.0 — AUDITED ENTROPY MCP surface. An AI agent that needs a secret /
 * key / seed gets one mixed from multiple health-checked sources (OS CSPRNG +
 * timing jitter + any sample it supplies), with a SIGNED provenance
 * attestation it can verify offline. Defense-in-depth + auditable. Total.
 */

import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function jitter(): Buffer { const a: number[] = []; let prev = Number(process.hrtime.bigint() & 0xffn); for (let i = 0; i < 4096 && a.length < 256; i++) { const t = Number(process.hrtime.bigint() & 0xffn); a.push((t ^ prev) & 0xff); prev = t; } return Buffer.from(a); }
function sha256(s: string): string { return createHash("sha256").update(s, "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const ENTROPY_TOOLS: MnemeTool[] = [
  {
    name: "mneme.entropy.gen",
    category: "memory",
    description: "🎲 AUDITED ENTROPY — generate a secret/key/seed by MIXING the OS CSPRNG + timing jitter + any sample you pass (a public randomness beacon, a sensor reading) through a cryptographic extractor (defense in depth: strong if ANY source has entropy). Returns the secret, per-source + output health, and a NOTARY provenance attestation that binds the secret's hash to its audited sources — WITHOUT containing the secret. NOT a claim of magic unhackability; `crypto`'s CSPRNG is already secure — the value is resilience + auditability + a fail-safe health check. Self-attesting.",
    whenToUse: "When you need a secret/key/seed and want it (a) resilient to a single bad RNG, (b) provably derived from audited sources. Pass `physical` for any extra entropy you have.",
    triggers: ["entropy gen", "generate a secret", "secure random key", "audited entropy"],
    inputSchema: { type: "object", properties: { bytes: { type: "number", description: "secret length (default 32)" }, physical: { type: "string", description: "any extra entropy sample to mix in" }, hashOnly: { type: "boolean", description: "return only the secret's hash, not the secret" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const sources: Array<{ id: string; data: string | Buffer }> = [{ id: "os-csprng", data: randomBytes(64) }, { id: "timing-jitter", data: jitter() }];
        if (typeof args["physical"] === "string" && (args["physical"] as string).length > 0) sources.push({ id: "physical", data: args["physical"] as string });
        const sec = core.entropy.generateSecret(cwd, sources, typeof args["bytes"] === "number" ? args["bytes"] as number : 32, Date.now());
        const data: Record<string, unknown> = { secret: args["hashOnly"] === true ? undefined : sec.secretHex, sourceIds: sec.sourceIds, sourceHealth: sec.sourceHealth, outputHealth: sec.outputHealth, attestation: sec.attestation };
        // self-attest the tool result too
        try { const h = sha256(canon({ sourceIds: sec.sourceIds, outputHealth: sec.outputHealth })); const r = core.notary.issueReceipt(cwd, { kind: "reasoning-trace", subject: `entropy-mcp:${h.slice(0, 16)}`, payload: { dataHash: h, tool: "entropy.gen" }, includePayload: true }); data._proof = { dataHash: h, receipt: r }; } catch { /* */ }
        return { data, wisdom: `🎲 ${sec.secretHex.length / 2}-byte secret · sources ${sec.sourceIds.join("+")} · output health ${sec.outputHealth.passed ? "✓" : "✗"}`, followUp: ["mneme.entropy.verify"], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
  {
    name: "mneme.entropy.verify",
    category: "memory",
    description: "🎲 AUDITED ENTROPY — verify a secret's provenance OFFLINE: the attestation's Ed25519 signature is valid AND sha256(secret) matches the signed hash — proving this exact secret was derived from the attested, health-checked sources, without the attestation ever revealing it. Total.",
    whenToUse: "Before trusting a secret someone (an agent / a teammate) handed you with an attestation — confirm its provenance.",
    triggers: ["entropy verify", "verify a secret's provenance"],
    inputSchema: { type: "object", required: ["secretHex", "attestation"], properties: { secretHex: { type: "string" }, attestation: { description: "the attestation receipt" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core"); void rt;
        const v = core.entropy.verifySecretAttestation(args["attestation"] as never, String(args["secretHex"] ?? ""));
        return { data: { bound: v.bound, valid: v.valid, reason: v.reason }, wisdom: v.bound ? "✓ secret provenance verified offline" : `✗ ${v.reason}`, followUp: [], confidence: { level: v.bound ? "high" as const : "low" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
