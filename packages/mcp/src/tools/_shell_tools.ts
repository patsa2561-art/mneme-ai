/**
 * v2.106.0 — SHELL AUTOPILOT MCP surface. When an AI agent runs a shell
 * command (via its Bash tool) that fails, it can ask Mneme for a recovery —
 * learned from this machine's own history, shared (signed) across vendors —
 * and teach Mneme what fixed it. The agent gets the same dark-data flywheel
 * the human terminal gets. Self-attesting; total.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(s, "utf8").digest("hex"); }
function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const k = Object.keys(v as Record<string, unknown>).sort();
  return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}";
}
async function attest(cwd: string, subject: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const dataHash = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "reasoning-trace", subject: `shell-mcp:${subject}:${dataHash.slice(0, 16)}`, payload: { dataHash, tool: subject }, includePayload: true }); return { ...data, _proof: { dataHash, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });
function storePath(cwd: string): string { return join(cwd, ".mneme", "cortex", "store.json"); }
function learnedMap(cwd: string): Record<string, string> {
  try { const p = storePath(cwd); if (!existsSync(p)) return {}; const j = JSON.parse(readFileSync(p, "utf8")); if (!j || !Array.isArray(j.entries)) return {};
    const sup = new Set<string>(); for (const e of j.entries) if (e?.supersedes) sup.add(e.supersedes);
    const out: Record<string, string> = {}; for (const e of j.entries) if (e && !sup.has(e.id) && typeof e.key === "string" && e.key.startsWith("shell.recovery:")) out[e.key.slice(15)] = e.value;
    return out; } catch { return {}; }
}

export const SHELL_TOOLS: MnemeTool[] = [
  {
    name: "mneme.shell.suggest",
    category: "memory",
    description: "🛟 SHELL AUTOPILOT — given a command that FAILED (+ its exit code and stderr), suggest a recovery. Learned recoveries proven on THIS machine (recalled from the signed cortex) beat the built-in deterministic rules. It NEVER runs anything — it returns a suggestion you decide on. Self-attesting.",
    whenToUse: "Right after a shell command you ran (via your Bash tool) exits non-zero — get a recovery before guessing.",
    triggers: ["shell suggest", "command failed what now", "recover from a failed command"],
    inputSchema: { type: "object", required: ["cmd"], properties: { cmd: { type: "string", description: "the failed command line" }, code: { type: "number", description: "exit code" }, stderr: { type: "string", description: "captured stderr (improves the match)" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const sug = core.shellAutopilot.suggestRecovery(String(args["cmd"] ?? ""), typeof args["code"] === "number" ? args["code"] as number : 1, typeof args["stderr"] === "string" ? args["stderr"] as string : undefined, learnedMap(cwd));
        const data = await attest(cwd, "suggest", { recovery: sug.recovery, source: sug.source, confidence: sug.confidence, reason: sug.reason, signature: sug.signature });
        return { data, wisdom: sug.recovery ? `↻ ${sug.recovery} (${sug.source})` : "no known recovery", followUp: ["mneme.shell.learn"], confidence: { level: sug.source === "learned" ? "high" as const : "medium" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
  {
    name: "mneme.shell.learn",
    category: "memory",
    description: "🧠 SHELL AUTOPILOT — teach Mneme that a recovery FIXED a failure. It's signed into the shared cortex, so the next time this failure happens — for YOU, the human, or any other agent/vendor on this machine — the proven recovery is suggested. The dark-data flywheel: the longer you work, the smarter the safety net. Self-attesting.",
    whenToUse: "After a command failed and you found the command that fixed it — record the pair so nobody (human or agent) has to rediscover it.",
    triggers: ["shell learn", "remember this fix", "this recovery worked"],
    inputSchema: { type: "object", required: ["cmd", "recovery"], properties: { cmd: { type: "string", description: "the command that FAILED" }, recovery: { type: "string", description: "the command that FIXED it" }, code: { type: "number" }, stderr: { type: "string" }, agent: { type: "string" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const sig = core.shellAutopilot.failureSignature(String(args["cmd"] ?? ""), typeof args["code"] === "number" ? args["code"] as number : 1, typeof args["stderr"] === "string" ? args["stderr"] as string : undefined);
        const key = core.shellAutopilot.recoveryKey(sig);
        let store: unknown = { v: 1, entries: [] };
        try { if (existsSync(storePath(cwd))) store = JSON.parse(readFileSync(storePath(cwd), "utf8")); } catch { /* */ }
        const out = core.cortex.contribute(cwd, store as never, { agent: String(args["agent"] ?? "agent"), key, value: String(args["recovery"] ?? ""), kind: "fact" }, Date.now(), { update: true });
        const dir = join(cwd, ".mneme", "cortex"); if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(storePath(cwd), JSON.stringify(out.store, null, 2));
        const data = await attest(cwd, "learn", { verdict: out.result.verdict, signature: sig });
        return { data, wisdom: `learned (${out.result.verdict}) — recalled for this failure on every agent`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
