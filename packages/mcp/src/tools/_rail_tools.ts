/**
 * v2.131.0 — THE CONTEXT RAIL MCP surface (the "Visa rail" of AI context).
 *   mneme.rail.traverse  — run a payload through the governed pipe (ingress|egress)
 *   mneme.policy.check   — the deterministic access gate (ALLOW|DENY)
 * Both self-attesting (Ed25519 _proof over the result hash).
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, subject: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject, payload: { dataHash: h }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

function loadPolicy(core: typeof import("@mneme-ai/core"), cwd: string): import("@mneme-ai/core").policy.PolicyRule {
  try { const p = resolve(cwd, "mneme.policy.json"); if (existsSync(p)) return core.policy.normalizePolicy(JSON.parse(readFileSync(p, "utf8"))); } catch { /* */ }
  return core.policy.defaultPolicy();
}

export const RAIL_TOOLS: MnemeTool[] = [
  {
    name: "mneme.rail.traverse",
    category: "forensics",
    description: "🛤 THE CONTEXT RAIL — the single governed pipe between a local workspace and a hosted model (the 'Visa rail' of AI context). direction='ingress' (local→model): policy-gate the payload, NEUTRALIZE any prompt-injection a file planted + wrap it as untrusted DATA, then BLIND secret literals + sensitive identifier names (the reverse map is returned for LOCAL use — never re-send it). direction='egress' (model→disk): screen the model's output for secret LEAKAGE (honeytoken/bloom/pattern/entropy) and meter the transaction. Returns verdict ALLOW|REDACT|BLOCK + the safe payload + a per-layer trace + byte savings + bound hashes. Self-attesting. HONEST: a deterministic composition of proven layers with a signed receipt — NOT a 100% guarantee against novel prompt-injection (the data/instruction boundary is the always-on catch-all) and NOT homomorphic encryption; the token-SAVINGS headline belongs to mneme.outline/scaffold/channel — the rail reports its own byte delta truthfully (can be ~0 or slightly negative).",
    whenToUse: "BEFORE sending local code/context to a model, call with direction='ingress' and send the returned safePayload (keep the map LOCAL to restore names in the reply). BEFORE writing a model's returned code to disk, call with direction='egress' and write the returned safePayload only if verdict≠BLOCK. The one call that makes a context exchange policy-cleared, injection-safe, name/secret-blinded, leak-screened, and metered.",
    triggers: ["context rail", "visa of ai context", "secure context gateway", "send to model safely", "ingress", "egress", "govern context"],
    inputSchema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["ingress", "egress"], description: "ingress = local→model; egress = model→disk." },
        payload: { type: "string", description: "the content to traverse the rail." },
        path: { type: "string", description: "(ingress) logical path for the policy gate, e.g. src/billing.ts." },
        agent: { type: "string", description: "agent id (for an allow-list policy)." },
        aggressive: { type: "boolean", description: "(ingress) mask ALL identifiers, not just sensitive ones." },
        canaries: { type: "array", items: { type: "string" }, description: "(egress) honeytoken canaries to trip on." },
        secrets: { type: "array", items: { type: "string" }, description: "(egress) org secret literals to bloom-fingerprint." },
        localVerified: { type: "boolean", description: "(egress) whether a local compile/test passed." },
      },
      required: ["direction", "payload"],
    },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const direction = args["direction"] === "egress" ? "egress" : "ingress";
        const payload = typeof args["payload"] === "string" ? args["payload"] as string : "";
        let rec: import("@mneme-ai/core").rail.RailReceipt;
        if (direction === "ingress") {
          rec = core.rail.traverseIngress(payload, {
            ...(typeof args["path"] === "string" ? { path: args["path"] as string } : {}),
            ...(typeof args["agent"] === "string" ? { agent: args["agent"] as string } : {}),
            policy: loadPolicy(core, cwd),
            blindMode: args["aggressive"] === true ? "aggressive" : "sensitive",
          });
        } else {
          rec = core.rail.traverseEgress(payload, {
            ...(Array.isArray(args["canaries"]) ? { canaries: (args["canaries"] as unknown[]).map(String) } : {}),
            ...(Array.isArray(args["secrets"]) ? { secrets: (args["secrets"] as unknown[]).map(String) } : {}),
            ...(typeof args["agent"] === "string" ? { agent: args["agent"] as string } : {}),
            localVerified: args["localVerified"] === true,
          });
        }
        const data = await attest(cwd, `rail.${direction}`, {
          direction: rec.direction, verdict: rec.verdict, allowed: rec.allowed,
          safePayload: rec.safePayload, ...(rec.map ? { map: rec.map } : {}),
          layers: rec.layers, savings: rec.savings, contentHash: rec.contentHash, safeHash: rec.safeHash,
          ...(rec.txDraft ? { txDraft: rec.txDraft } : {}), note: rec.note,
        });
        return {
          data,
          wisdom: rec.verdict === "BLOCK"
            ? `🛑 RAIL BLOCKED — ${rec.note} Do NOT proceed with this payload.`
            : rec.verdict === "REDACT"
            ? `🛡 RAIL CLEARED (transformed) — ${rec.note} Use the 'safePayload'${direction === "ingress" ? " and keep 'map' LOCAL to restore names in the reply" : ""}.`
            : `✓ RAIL CLEARED — ${rec.note} Use the 'safePayload'${direction === "ingress" ? "; 'map' restores names locally" : ""}.`,
          followUp: [], confidence: { level: "high" as const },
        };
      } catch (e) { return low((e as Error).message); }
    },
  },
  {
    name: "mneme.policy.check",
    category: "forensics",
    description: "📜 DYNAMIC POLICY ENFORCEMENT — the deterministic, fail-closed access gate the Context Rail consults before any local context crosses to a model. Tests a path / content / agent against the active mneme.policy.json (deny-path globs like .env / **/secrets/** / *.pem, deny-content patterns for secret/PII shapes, an optional agent allow-list, and a byte cap). Returns ALLOW|DENY + the exact violations (with the matched rule, for audit). Self-attesting. HONEST: this governs what the rail will RELAY, not OS file permissions — it is a deterministic relay gate, not a sandbox.",
    whenToUse: "Before relaying a specific file or payload to a model, confirm policy allows it (the rail does this automatically on ingress; call this directly to explain a block or to pre-flight a path). A DENY means do not send that content.",
    triggers: ["policy check", "is this file allowed", "mneme.policy.json", "deny env", "access policy", "can i send this to the model"],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "path to test against deny-globs." },
        content: { type: "string", description: "content to test against deny-patterns / size." },
        agent: { type: "string", description: "agent id to test against the allow-list." },
      },
    },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const d = core.policy.checkPolicy({
          ...(typeof args["path"] === "string" ? { path: args["path"] as string } : {}),
          ...(typeof args["content"] === "string" ? { content: args["content"] as string } : {}),
          ...(typeof args["agent"] === "string" ? { agent: args["agent"] as string } : {}),
        }, loadPolicy(core, cwd));
        const data = await attest(cwd, "policy.check", { verdict: d.verdict, allowed: d.allowed, reason: d.reason, violations: d.violations });
        return {
          data,
          wisdom: d.allowed ? `✓ ALLOW — ${d.reason}` : `🛑 DENY — ${d.reason}. Do not relay this to the model.`,
          followUp: [], confidence: { level: "high" as const },
        };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
