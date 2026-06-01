/**
 * v2.133.0 — ACTIVATION CORTEX MCP surface. `mneme.boot` is the session-start
 * handshake: it returns the task→tool decision table (WHEN to use which Mneme
 * tool) + live cortex recall, self-attested. The MCP server ALSO advertises a
 * compact form of this via the standardized `instructions` field on connect.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject: "boot", payload: { dataHash: h }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

function readCortexStore(cwd: string): { v: 1; entries: unknown[] } {
  try { const p = resolve(cwd, ".mneme", "cortex", "store.json"); if (!existsSync(p)) return { v: 1, entries: [] }; const j = JSON.parse(readFileSync(p, "utf8")); return j && Array.isArray(j.entries) ? j : { v: 1, entries: [] }; } catch { return { v: 1, entries: [] }; }
}

export const BOOT_TOOLS: MnemeTool[] = [
  {
    name: "mneme.boot",
    category: "meta",
    description: "⚡ ACTIVATION CORTEX — call this FIRST on session start. Mneme is the local trust & cost layer (truth · memory · context-safety · token-saving); it does NOT hook your host's file tools — it helps when you call it at the right moment. This returns: (1) a task→tool DECISION TABLE — for each common moment in a coding/agent session, the Mneme tool to reach for and why (e.g. 'about to read a big file → mneme.outline (~95% fewer tokens)', 'sending code to a model → mneme.rail ingress (blind secrets + neutralize injection)', 'user states a fact → mneme.verify'); (2) the four boundary capabilities; (3) live cortex recall (shared signed memory other agents + your past self left) when you pass a task. Self-attesting. These are SIGNALS, not commands — use judgment (the table is also advertised in the MCP `instructions` field on connect, and an opt-in SessionStart hook can inject it automatically).",
    whenToUse: "FIRST call of a session, and again when you start a distinctly new task (pass `task` to rank the table + recall relevant shared memory). It tells you how/when to use the rest of Mneme so its tools actually get used instead of sitting installed-but-idle.",
    triggers: ["boot", "activate mneme", "what can mneme do now", "session start", "how do i use mneme", "mneme capabilities", "decision table"],
    inputSchema: { type: "object", properties: { task: { type: "string", description: "the task at hand — ranks the decision table + recalls relevant shared memory." } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const version = (() => { try { return core.boot.renderBootInstructions("").length ? (process.env["npm_package_version"] ?? "?") : "?"; } catch { return "?"; } })();
        const task = typeof args["task"] === "string" ? args["task"] as string : undefined;
        let cortexFacts: { key: string; value: string }[] = [];
        if (task) {
          try { cortexFacts = core.cortex.recall(readCortexStore(cwd) as never, task, 8).map((h) => ({ key: h.entry.key, value: h.entry.value })); } catch { cortexFacts = []; }
        }
        const packet = core.boot.buildBootPacket({ version, healthy: true, ...(task ? { task, cortexFacts } : {}) });
        const data = await attest(cwd, {
          installCheck: packet.installCheck,
          capabilities: packet.capabilities,
          decisionTable: packet.decisionTable,
          cortexFacts: packet.cortexFacts,
          note: packet.note,
        });
        return {
          data,
          wisdom: `⚡ Mneme connected — ${packet.decisionTable.length} task→tool signals ready${cortexFacts.length ? ` + ${cortexFacts.length} shared-memory fact(s) for this task` : ""}. Use the decision table to know WHEN to reach for which tool (signals, not commands).`,
          followUp: ["mneme.cortex.recall", "mneme.outline.file", "mneme.rail.traverse"],
          confidence: { level: "high" as const },
        };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
