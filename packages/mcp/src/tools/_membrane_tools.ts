/**
 * THE MEMBRANE — MCP surface. The capstone that fuses the three membrane pillars
 * (STELE capability · BOOT activation · AXIA value) into ONE signed packet an
 * agent fetches at session start, plus an offline verifier. Self-attesting.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import type { MnemeTool } from "./_types.js";

const req = createRequire(import.meta.url);
function coreVersion(): string { try { return (req("@mneme-ai/core/package.json") as { version?: string }).version ?? "?"; } catch { return "?"; } }
function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, subject: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject, payload: { dataHash: h }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const MEMBRANE_TOOLS: MnemeTool[] = [
  {
    name: "mneme.membrane.fuse",
    category: "meta",
    description: "🧬 THE MEMBRANE — the capstone that fuses Mneme's three pillars into ONE signed packet an AI agent crosses at session start: CAPABILITY (STELE — pass the merkle `root` you hold to get a 0-token confirmation or the O(delta) you lack), ACTIVATION (BOOT — the when→tool decision table + ≤2KB instructions), and VALUE (AXIA — the measured, hash-chained, offline-verifiable ledger of tokens SAVED + destructive ops GATED + secrets REDACTED, with USD only from a price you supply). One Ed25519 receipt verifies the whole packet offline. HONEST: the win is the FUSION + the proof — counts are facts of events, never 'attacks prevented', never an invented $ damage.",
    whenToUse: "FIRST call of a session (and when you suspect Mneme upgraded). Pass the merkle `root` you cached + any `axiaEvents` you've accumulated; fold the returned activation table + capability delta into context, cache the new root, and keep the signed packet as your value proof. One call = you know everything, know when to use it, and carry verifiable value.",
    triggers: ["membrane", "fuse pillars", "onboard mneme", "session start packet", "boot membrane", "capability + activation + value", "what is mneme and what has it saved"],
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "the STELE merkle root your agent currently holds (omit for the full surface)." },
        leaves: { type: "object", description: "optional name→leafHash map you cached, for a precise capability delta." },
        task: { type: "string", description: "optional task hint to lightly rank the activation table (never drops rows)." },
        axiaEvents: { type: "array", description: "the live AXIA value events you've gathered: [{kind:'tokens-saved'|'destructive-gated'|…, count, source}]." },
        cortexFacts: { type: "array", description: "optional recalled cortex facts: [{key,value}]." },
        pricePer1k: { type: "number", description: "your vendor's price per 1k tokens — only then is a USD figure reported." },
      },
    },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const packet = core.membrane.buildMembrane({
          version: coreVersion(),
          heldRoot: typeof args["root"] === "string" ? (args["root"] as string) : undefined,
          heldLeaves: args["leaves"] && typeof args["leaves"] === "object" ? (args["leaves"] as Record<string, string>) : undefined,
          task: typeof args["task"] === "string" ? (args["task"] as string) : undefined,
          axiaEvents: Array.isArray(args["axiaEvents"]) ? (args["axiaEvents"] as Array<Partial<import("@mneme-ai/core").axia.AxiaEvent>>) : undefined,
          cortexFacts: Array.isArray(args["cortexFacts"]) ? (args["cortexFacts"] as Array<{ key: string; value: string }>) : undefined,
          pricePer1k: typeof args["pricePer1k"] === "number" ? (args["pricePer1k"] as number) : undefined,
        });
        const signed = core.membrane.sealMembrane(cwd, packet);
        const cap = packet.capability;
        const wisdom = cap.upToDate
          ? `🧬 membrane fused — capability ✓ up to date (0 tokens), ${packet.activation.decisionTable.length} activation signals, value: ${packet.value.tokensSaved} tok saved · ${packet.value.totalEvents} gated/redacted/corrected events (signed).`
          : `🧬 membrane fused — capability: ${cap.added.length} new + ${cap.changed.length} changed (~${cap.deltaTokenEstimate} tok), ${packet.activation.decisionTable.length} activation signals, value: ${packet.value.tokensSaved} tok saved (signed).`;
        return { data: { packet, receipt: signed.receipt }, wisdom, followUp: ["mneme.membrane.verify"], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
  {
    name: "mneme.membrane.verify",
    category: "meta",
    description: "🧬 THE MEMBRANE — verify a sealed membrane OFFLINE: confirms the Ed25519 receipt is valid AND that the packet hashes to the receipt's payloadHash (so a tampered capability/activation/value is caught). No network, no trust in Mneme — just the embedded public key.",
    whenToUse: "When you receive a sealed membrane (from mneme.membrane.fuse or another agent's handoff) and want to confirm it is genuine + untampered before trusting its capability surface or value figures.",
    triggers: ["verify membrane", "is this membrane genuine", "check membrane signature", "membrane tamper check"],
    inputSchema: {
      type: "object",
      properties: {
        packet: { type: "object", description: "the membrane packet." },
        receipt: { type: "object", description: "the Ed25519 NOTARY receipt that sealed it." },
      },
      required: ["packet", "receipt"],
    },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const packet = args["packet"] as import("@mneme-ai/core").membrane.MembranePacket;
        const receipt = args["receipt"] as import("@mneme-ai/core").notary.NotaryReceipt;
        if (!packet || !receipt) return low("expected { packet, receipt }");
        const v = core.membrane.verifyMembrane({ packet, receipt });
        const data = await attest(cwd, "membrane.verify", { valid: v.valid, reason: v.reason });
        return { data, wisdom: v.valid ? "✓ membrane is genuine + untampered (verified offline)" : `🛑 membrane invalid — ${v.reason}`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
