/**
 * v2.118.0 — SOVEREIGN EGRESS GUARD MCP surface. Before an AI agent (or a
 * relaying tool) sends context to an EXTERNAL model, it hands the payload here;
 * Mneme pattern-redacts known secrets, trips on honeytoken canaries, catches
 * registered secrets via a Bloom filter, and returns the SAFE (redacted)
 * payload + a SIGNED egress certificate. On BLOCK (a canary tripped = exfil
 * signal) the agent MUST NOT send. The enterprise "code never leaks, with
 * proof" gate — self-attesting, auditable offline by a risk officer.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(s, "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject: `egress:${String((data as { verdict?: string }).verdict)}`, payload: { dataHash: h, tool: "egress.guard" }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });
function readLines(p: string): string[] { try { return existsSync(p) ? readFileSync(p, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : []; } catch { return []; } }

export const EGRESS_TOOLS: MnemeTool[] = [
  {
    name: "mneme.egress.guard",
    category: "forensics",
    description: "🛡 SOVEREIGN EGRESS GUARD — BEFORE you send context to an external model, hand it here. Mneme pattern-redacts known secrets (AWS/GH/OpenAI/PEM/JWT/…), trips on org HONEYTOKEN canaries (exfiltration → BLOCK), catches registered secrets via a Bloom filter (custom keys with no regex), and returns the SAFE `redactedPayload` + a SIGNED egress certificate. On verdict BLOCK, DO NOT send. The 'code/secrets never leak, with proof' gate — self-attesting + auditable offline. Token-savings note: send the redacted payload, not the raw.",
    whenToUse: "BEFORE relaying any local context (code, logs, config) to a hosted model / another agent. Send the returned `redactedPayload`; if `verdict` is BLOCK, refuse and surface the canary tripwire (an agent/tool is exfiltrating).",
    triggers: ["egress", "is this safe to send", "redact before sending", "leak check", "exfiltration"],
    inputSchema: { type: "object", required: ["payload"], properties: { payload: { type: "string", description: "the outbound context about to be sent to an external model" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const canaries = readLines(join(cwd, ".mneme", "egress", "canaries.txt"));
        const secrets = readLines(join(cwd, ".mneme", "egress", "secrets.txt"));
        const secretBloom = secrets.length > 0 ? core.egress.buildSecretBloom(secrets, { m: 1 << 16, k: 5 }) : undefined;
        const r = core.egress.scanEgress({ payload: String(args["payload"] ?? ""), canaries, secretBloom });
        const data = await attest(cwd, { verdict: r.verdict, redactedPayload: r.redactedPayload, secretsRedacted: r.secretsRedacted, canariesTripped: r.canariesTripped.length, bloomHits: r.bloomHits, residualRisk: r.residualRisk, findings: r.findings, contentHash: r.contentHash, note: r.note });
        return {
          data,
          wisdom: r.verdict === "BLOCK"
            ? `🛑 EGRESS BLOCKED — a honeytoken canary appeared in the outbound payload (exfiltration signal). Do NOT send.`
            : `🛡 EGRESS ${r.verdict} — ${r.secretsRedacted} secret(s) redacted, ${r.bloomHits} registered-secret hit(s). Send the redactedPayload, signed cert attached.`,
          followUp: [],
          confidence: { level: "high" as const },
        };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
