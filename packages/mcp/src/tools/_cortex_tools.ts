/**
 * v2.104.0 — THE COGNITIVE CORTEX MCP surface — the Sovereign Memory Bus.
 *
 * This is HOW every AI agent — Grok / GPT / Gemini / Claude / Codex / a
 * local model — shares one signed, drift-guarded memory through a clean
 * cross-vendor protocol (no kernel hacks, no process injection): they call
 * these MCP tools. Mneme is the LOGIC GATEKEEPER: a contribution that
 * contradicts established shared memory is QUARANTINED, never silently
 * overwritten, so the mesh can't be poisoned. Every entry is Ed25519-signed
 * and every tool result is NOTARY-self-attested, so any vendor verifies both
 * the shared facts AND the tool's own output offline.
 *
 * Persisted to .mneme/cortex/store.json. Every handler is total (108-error
 * rule): the shared brain of all agents must never crash the host.
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
  try { const core = await import("@mneme-ai/core"); const dataHash = sha256(canon(data)); const receipt = core.notary.issueReceipt(cwd, { kind: "reasoning-trace", subject: `cortex-mcp:${subject}:${dataHash.slice(0, 16)}`, payload: { dataHash, tool: subject }, includePayload: true }); return { ...data, _proof: { dataHash, receipt } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

function storePath(cwd: string): string { return join(cwd, ".mneme", "cortex", "store.json"); }
async function readStore(cwd: string): Promise<{ v: 1; entries: unknown[] }> {
  try { const p = storePath(cwd); if (!existsSync(p)) return { v: 1, entries: [] }; const j = JSON.parse(readFileSync(p, "utf8")); return j && Array.isArray(j.entries) ? j : { v: 1, entries: [] }; } catch { return { v: 1, entries: [] }; }
}
function writeStore(cwd: string, store: unknown): void { try { const dir = join(cwd, ".mneme", "cortex"); if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); writeFileSync(storePath(cwd), JSON.stringify(store, null, 2)); } catch { /* */ } }

export const CORTEX_TOOLS: MnemeTool[] = [
  {
    name: "mneme.cortex.contribute",
    category: "memory",
    description: "🧠 COGNITIVE CORTEX (Sovereign Memory Bus) — contribute a fact/decision/context/warning to the SHARED memory every agent reads. The gatekeeper signs it (Ed25519) and returns a verdict: ACCEPTED (new) / DUPLICATE (another agent already agrees) / UPDATED (you declared `update:true` to supersede) / QUARANTINED (it CONTRADICTS established memory — refused, so the mesh isn't poisoned; pass `update:true` only when you genuinely mean to change it). Self-attesting result.",
    whenToUse: "After you learn or decide something other agents (or your future self / a different vendor) will need — write it once to the shared cortex instead of letting it die in your context window.",
    triggers: ["cortex contribute", "share memory", "write to shared memory", "remember for all agents"],
    inputSchema: { type: "object", required: ["key", "value"], properties: { key: { type: "string", description: "Stable key (e.g. 'db.url', 'decision.auth')." }, value: { type: "string", description: "The fact/decision text." }, agent: { type: "string", description: "Your agent id (claude/gpt/grok/gemini/…)." }, kind: { type: "string", description: "fact | decision | context | warning" }, update: { type: "boolean", description: "Declare a supersede of an existing conflicting value." } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const store = await readStore(cwd);
        const out = core.cortex.contribute(cwd, store as never, { agent: String(args["agent"] ?? "unknown"), key: String(args["key"] ?? ""), value: String(args["value"] ?? ""), kind: args["kind"] as never }, Date.now(), { update: args["update"] === true });
        if (out.result.verdict !== "QUARANTINED" && out.result.entry) writeStore(cwd, out.store);
        const data = await attest(cwd, "contribute", { verdict: out.result.verdict, reason: out.result.reason, conflictsWith: out.result.conflictsWith, entryId: out.result.entry?.id ?? null });
        return { data, wisdom: `cortex: ${out.result.verdict} — ${out.result.reason}`, followUp: ["mneme.cortex.recall"], confidence: { level: out.result.verdict === "QUARANTINED" ? "low" as const : "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
  {
    name: "mneme.cortex.recall",
    category: "memory",
    description: "🧠 COGNITIVE CORTEX — recall shared memory relevant to a query (the live, signed facts every agent has contributed). Returns the matching facts most-relevant-first, each with its signing agent. Self-attesting result. This is how an agent gets CLEAN, verified context another agent (any vendor) established — without losing the loop.",
    whenToUse: "BEFORE starting work or answering — pull what the shared cortex already knows about the task so you don't re-derive, contradict, or drift from what other agents established.",
    triggers: ["cortex recall", "read shared memory", "what do we know about", "recall context"],
    inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string", description: "What you want to recall (free text)." }, limit: { type: "number", description: "Max hits (default 10)." } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const store = await readStore(cwd);
        const hits = core.cortex.recall(store as never, String(args["query"] ?? ""), typeof args["limit"] === "number" ? args["limit"] as number : 10);
        const facts = hits.map((h) => ({ key: h.entry.key, value: h.entry.value, agent: h.entry.agent, kind: h.entry.kind, score: h.score }));
        const data = await attest(cwd, "recall", { count: facts.length, facts });
        return { data, wisdom: `cortex recall: ${facts.length} fact(s)${facts[0] ? ` · top: ${facts[0].key}` : ""}`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
  {
    name: "mneme.cortex.handoff",
    category: "memory",
    description: "🤝 COGNITIVE CORTEX — build a SIGNED context capsule (the live shared memory) to hand to a receiving agent so it starts with clean, verified context instead of a cold window. The capsule is Ed25519-signed; the receiver verifies it offline. Self-attesting result.",
    whenToUse: "Before handing a task to another agent / vendor (or a fresh session) — give them the signed cortex capsule so they inherit everything the mesh knows, drift-free.",
    triggers: ["cortex handoff", "hand off context", "pass context to another agent"],
    inputSchema: { type: "object", properties: { toAgent: { type: "string", description: "Receiving agent id." } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const store = await readStore(cwd);
        const cap = core.cortex.handoff(cwd, store as never, String(args["toAgent"] ?? "agent"), Date.now());
        const data = await attest(cwd, "handoff", { toAgent: cap.toAgent, factCount: cap.facts.length, capsule: cap });
        return { data, wisdom: `cortex handoff → ${cap.toAgent}: ${cap.facts.length} signed fact(s)`, followUp: ["mneme.cortex.verify"], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
  {
    name: "mneme.cortex.reconcile",
    category: "memory",
    description: "🪄 COGNITIVE CORTEX — RECONCILE a conflict by PROOF, not by vote. When two agents disagree on a value, this consults Mneme's truth kernel: if exactly one claim is verifiably FALSE, the other WINS (signed resolution). If neither can be proven false, it stays UNRESOLVED and returns a signed belief-diff for a human / trusted agent to settle (never auto-decides an opinion — the Padgett rule). The first shared memory that heals agent contradictions by verifiable truth — works for every vendor (the verdict is signed + offline-verifiable). Self-attesting.",
    whenToUse: "When `cortex contribute` returned QUARANTINED (a conflict) and you want it settled — let proof decide where it can, and get a signed belief-diff where it can't.",
    triggers: ["cortex reconcile", "resolve conflict by proof", "settle a disagreement"],
    inputSchema: { type: "object", required: ["valueA", "valueB"], properties: { valueA: { type: "string" }, agentA: { type: "string" }, valueB: { type: "string" }, agentB: { type: "string" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const r = await core.cortex.reconcile(cwd, { agent: String(args["agentA"] ?? "A"), value: String(args["valueA"] ?? "") }, { agent: String(args["agentB"] ?? "B"), value: String(args["valueB"] ?? "") }, Date.now());
        const data = await attest(cwd, "reconcile", { resolution: r.resolution, winner: r.winner, loser: r.loser, verdicts: r.verdicts, reason: r.reason });
        return { data, wisdom: `cortex reconcile: ${r.resolution}${r.winner ? ` — winner "${r.winner.value}" by proof` : " — no auto-decide (signed belief-diff)"}`, followUp: [], confidence: { level: r.resolution === "proof" ? "high" as const : "medium" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
  {
    name: "mneme.cortex.verify",
    category: "memory",
    description: "✅ COGNITIVE CORTEX — verify OFFLINE that a shared-memory entry (or a handoff capsule's entry) is genuine: Ed25519 signature valid AND it binds the exact (agent,key,value). This is how any vendor confirms a shared fact wasn't forged or tampered before trusting it. Pure crypto, no network.",
    whenToUse: "Before acting on a high-stakes shared fact / inherited capsule — verify its signature so you trust what the mesh told you.",
    triggers: ["cortex verify", "verify shared fact", "is this memory genuine"],
    inputSchema: { type: "object", required: ["entry"], properties: { entry: { description: "A cortex entry (with its receipt) to verify." } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const v = core.cortex.verifyEntry(args["entry"] as never);
        return { data: { bound: v.bound, valid: v.valid, reason: v.reason }, wisdom: v.bound ? "✓ shared fact verified offline" : `✗ ${v.reason}`, followUp: [], confidence: { level: v.bound ? "high" as const : "low" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
