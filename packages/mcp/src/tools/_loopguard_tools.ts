/**
 * v2.110.0 — LOOPGUARD MCP surface. The killer for AI agents: an agent silently
 * burns time + tokens retrying a failing approach (the classic tool-loop). This
 * tool is a BOOLEAN the agent can ask itself — "have I tried this failing thing
 * too many times?" — computed DETERMINISTICALLY from the LOGPIPE event ledger
 * (no mind-reading, no LLM). On a thrash it surfaces the recovery already known
 * to the COGNITIVE CORTEX, so the agent breaks the loop with knowledge instead
 * of blind retries. `resume` reconstructs where a prior session left off. Total.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(s, "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, tool: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "reasoning-trace", subject: `loopguard:${h.slice(0, 16)}`, payload: { dataHash: h, tool }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

/* eslint-disable @typescript-eslint/no-explicit-any */
function loadEvents(core: any, cwd: string): any[] {
  try { const p = join(cwd, core.loopguard.LOOPGUARD_LEDGER); if (!existsSync(p)) return []; return core.loopguard.parseLedger(readFileSync(p, "utf8")); } catch { return []; }
}
function recallFor(core: any, cwd: string): (sig: string) => string | null {
  let view = new Map<string, { value: string }>();
  try { const p = join(cwd, ".mneme", "cortex", "store.json"); const store = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : { v: 1, entries: [] }; view = core.cortex.activeView(store); } catch { /* */ }
  return (sig: string) => { try { const e = view.get(core.shellAutopilot.recoveryKey(sig)); return e && typeof e.value === "string" && e.value.length > 0 ? e.value : null; } catch { return null; } };
}

export const LOOPGUARD_TOOLS: MnemeTool[] = [
  {
    name: "mneme.loopguard.check",
    category: "memory",
    description: "🔁 LOOPGUARD — ask Mneme 'am I thrashing?' Detects DETERMINISTICALLY when the same failure-signature has repeated ≥threshold times with no success in between (objective tool-loop detection, not mind-reading) and, on a thrash, surfaces the recovery the Cortex already knows. Use this to STOP retrying a failing approach blind. Self-attesting.",
    whenToUse: "When you've hit the same error more than twice, OR before another retry of a command that keeps failing — call this to find out if you're in a loop and what's already known to fix it, instead of burning more tokens.",
    triggers: ["am i stuck", "loop check", "thrashing", "keep failing", "loopguard"],
    inputSchema: { type: "object", properties: { threshold: { type: "number", description: "repeats before it counts as a thrash (default 3)" }, windowMinutes: { type: "number", description: "trailing window in minutes (default 15)" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const events = loadEvents(core, cwd);
        const threshold = typeof args["threshold"] === "number" ? (args["threshold"] as number) : 3;
        const windowMs = (typeof args["windowMinutes"] === "number" ? (args["windowMinutes"] as number) : 15) * 60_000;
        const v = core.loopguard.detectStuck(events, { threshold, windowMs });
        const fix = v.stuck ? recallFor(core, cwd)(v.signature) : null;
        const data = await attest(cwd, "loopguard.check", { stuck: v.stuck, signature: v.signature, command: v.command, repeats: v.repeats, reason: v.reason, knownRecovery: fix, events: events.length });
        return {
          data,
          wisdom: v.stuck ? `🔁 STOP — you've thrashed on \`${v.command}\` ${v.repeats}×.${fix ? ` Known recovery: ${fix}` : " No learned recovery yet — try a genuinely different approach."}` : `✓ not in a loop (${events.length} events).`,
          followUp: v.stuck ? ["mneme.shell.suggest", "mneme.cortex.recall"] : [],
          confidence: { level: "high" as const },
        };
      } catch (e) { return low((e as Error).message); }
    },
  },
  {
    name: "mneme.loopguard.resume",
    category: "memory",
    description: "⏸▶ RESUME — reconstruct, DETERMINISTICALLY, where a session left off (from the LOGPIPE ledger): last command, last UNRESOLVED error, repeated failures, and the known next move. For an agent resuming work, or a human returning to the terminal. Self-attesting.",
    whenToUse: "At the start of a session, or after a context switch, to inherit exactly where things stood — last command, the open error, and the recalled fix — without re-deriving it.",
    triggers: ["resume", "where did i leave off", "session summary", "what was i doing"],
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object" },
    handler: async (rt) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const events = loadEvents(core, cwd);
        const r = core.loopguard.summarizeSession(events, recallFor(core, cwd));
        const data = await attest(cwd, "loopguard.resume", { headline: r.headline, lastCommand: r.lastCommand, lastError: r.lastError, resolved: r.resolved, suggestion: r.suggestion, stuck: r.stuck.stuck, repeatedFailures: r.repeatedFailures.slice(0, 5) });
        return { data, wisdom: `▶ ${r.headline}`, followUp: r.lastError && !r.resolved ? ["mneme.shell.suggest"] : [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
