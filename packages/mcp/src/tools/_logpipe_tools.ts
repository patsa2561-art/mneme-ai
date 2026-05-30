/**
 * v2.109.0 — LOGPIPE MCP surface. When an AI agent runs a shell command (its
 * Bash tool) it can hand the {command, output, exitCode} here; Mneme
 * deterministically extracts {intent, error-class, excerpt} and files it as a
 * SIGNED Cortex fact — so the next agent (any vendor) recalls "what happened
 * when X ran" and, on errors, the Shell Autopilot learns the fix. Total.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(s, "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, data: Record<string, unknown>): Promise<Record<string, unknown>> { try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "reasoning-trace", subject: `logpipe-mcp:${h.slice(0, 16)}`, payload: { dataHash: h, tool: "logpipe.absorb" }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; } }
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });
function cortexPath(cwd: string): string { return join(cwd, ".mneme", "cortex", "store.json"); }

export const LOGPIPE_TOOLS: MnemeTool[] = [
  {
    name: "mneme.logpipe.absorb",
    category: "memory",
    description: "📥 LOGPIPE — hand Mneme a {command, output, exitCode} you ran; it deterministically extracts {intent, error-class, excerpt} (terminal output is structured, so no hallucination) and files it as a SIGNED Cortex fact — recallable by any agent. If it was an error and you pass `fix`, it also teaches the Shell Autopilot the recovery, closing the loop ABSORB→AUTOPILOT. Self-attesting.",
    whenToUse: "After running a shell command (your Bash tool), absorb its result so the next agent + your future self inherit what happened; pass `fix` when you resolved an error so the recovery is learned machine-wide.",
    triggers: ["logpipe absorb", "remember this command result", "record terminal output"],
    inputSchema: { type: "object", required: ["cmd"], properties: { cmd: { type: "string" }, output: { type: "string" }, exitCode: { type: "number" }, fix: { type: "string", description: "the command that fixed this error (teaches the autopilot)" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const entry = core.logpipe.extractLogEntry(String(args["cmd"] ?? ""), String(args["output"] ?? ""), typeof args["exitCode"] === "number" ? args["exitCode"] as number : NaN);
        const f = core.logpipe.formatForCortex(entry);
        let store: unknown = { v: 1, entries: [] };
        try { if (existsSync(cortexPath(cwd))) store = JSON.parse(readFileSync(cortexPath(cwd), "utf8")); } catch { /* */ }
        const o = core.cortex.contribute(cwd, store as never, { agent: "logpipe", key: f.key, value: f.value, kind: f.kind }, Date.now());
        store = o.store; let taught = false;
        if (entry.hadError && typeof args["fix"] === "string" && (args["fix"] as string).length > 0) {
          const rk = core.shellAutopilot.recoveryKey(entry.signature);
          const o2 = core.cortex.contribute(cwd, store as never, { agent: "logpipe", key: rk, value: args["fix"] as string, kind: "fact" }, Date.now(), { update: true });
          store = o2.store; taught = true;
        }
        try { const dir = join(cwd, ".mneme", "cortex"); if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); writeFileSync(cortexPath(cwd), JSON.stringify(store, null, 2)); } catch { /* */ }
        const data = await attest(cwd, { intent: entry.intent, hadError: entry.hadError, errorClass: entry.errorClass, cortex: o.result.verdict, taughtAutopilot: taught });
        return { data, wisdom: `📥 ${entry.intent} → cortex (${o.result.verdict})${taught ? " · taught autopilot" : ""}`, followUp: entry.hadError ? ["mneme.shell.suggest"] : [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
