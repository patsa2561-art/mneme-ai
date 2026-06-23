/**
 * v3.136.0 — THE ARK MCP surface. mneme.ark.birth — give birth to an accountable
 * child agent genome (inherits covenant + verified context + scars, narrows authority);
 * mneme.ark.verify — verify a birth/lineage is accountable. Matrix gRPC auto, signed.
 */

import type { MnemeTool } from "./_types.js";
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const ARK_TOOLS: MnemeTool[] = [
  {
    name: "mneme.ark.birth",
    category: "meta",
    description: "🚢 THE ARK — give birth to an accountable child-agent genome. The child INHERITS the parent's covenant (values), capability bounds, scar ledger (forbidden actions / dead-ends), and verified cross-agent context — and may only NARROW authority (add deny-rules, never remove a parent's), must KEEP every covenant value, can NEVER forget an ancestor's scar, and can NEVER inherit poisoned context. Returns the signed child genome + a verdict. This is how a network of agents grows WITHOUT runaway, unaccountable reproduction — every generation is bounded, remembering, and verifiable.",
    whenToUse: "When spawning / delegating to a sub-agent or child agent — mint its genome from yours so it inherits your values + verified context + the scars (mistakes never to repeat) and is structurally bounded to LESS authority than you. Pair mneme.ark.verify on the result.",
    triggers: ["spawn a child agent", "delegate to a sub-agent", "give birth to an agent", "mint an agent genome", "create a bounded sub-agent", "สร้าง agent ลูก", "ออกลูก agent"],
    inputSchema: { type: "object", required: ["parent", "childAgent"], properties: { parent: { type: "object", description: "the parent AgentGenome" }, childAgent: { type: "string" }, addValues: { type: "array", items: { type: "string" } }, addBounds: { type: "array", items: { type: "string" }, description: "extra forbidden capabilities" }, addScars: { type: "array", items: { type: "object" }, description: "extra forbidden actions {action,reason}" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core"); const cwd = rt.meta?.rootPath ?? process.cwd();
        const parent = args["parent"] as import("@mneme-ai/core").ark.AgentGenome;
        if (!parent || !parent.genomeId) return low("ark.birth needs a valid 'parent' genome (mint one first).");
        const addScars = Array.isArray(args["addScars"]) ? (args["addScars"] as Array<{ action?: string; reason?: string }>).map((s) => core.ark.scarOf(String(s.action || ""), String(s.reason || ""))) : [];
        const child = core.ark.birth(parent, String(args["childAgent"] || "child"), { addValues: args["addValues"] as string[], addBounds: args["addBounds"] as string[], addScars, ts: Math.floor(Date.now() / 1000) });
        const v = core.ark.verifyBirth(parent, child);
        let sig: unknown = null; try { sig = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject: `ark:${child.agent}:${child.genomeId.slice(0, 12)}`, payload: { genomeId: child.genomeId }, includePayload: true }); } catch { /* */ }
        return { data: { child: { ...child, sig }, verdict: v }, wisdom: v.ok ? `🚢 born "${child.agent}" (gen ${child.generation}) — inherits ${child.covenant.values.length} values · ${child.bounds.length} bounds · ${child.scars.length} scars · ${child.inheritedContext.length} verified-context. Bounded, remembering, signed.` : `🛑 invalid birth: ${v.violations.join("; ")}`, followUp: ["mneme.ark.verify"], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
  {
    name: "mneme.ark.verify",
    category: "meta",
    description: "🚢 THE ARK — verify a birth or a whole bloodline is ACCOUNTABLE: no privilege escalation (a child never gains authority a parent lacked), no covenant regression (values kept), no scar amnesia (every ancestor's fatal mistake carried forward), no poisoned inheritance, tamper-evident, intact lineage. Pass {parent, child} for one birth or {lineage:[...]} for a chain. Anyone can verify offline.",
    whenToUse: "Before trusting a child/sub-agent (or a delegated one from another vendor) — verify its genome is a valid, bounded descendant. Catch a forged or over-privileged agent.",
    triggers: ["verify agent genome", "is this child agent valid", "check the lineage", "verify the bloodline", "ตรวจ genome agent"],
    inputSchema: { type: "object", properties: { parent: { type: "object" }, child: { type: "object" }, lineage: { type: "array", items: { type: "object" } } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core"); void rt;
        if (Array.isArray(args["lineage"])) { const v = core.ark.verifyLineage(args["lineage"] as import("@mneme-ai/core").ark.AgentGenome[]); return { data: v, wisdom: v.ok ? "✓ bloodline verified — every generation accountable" : `🛑 ${v.violations.join("; ")}`, followUp: [], confidence: { level: "high" as const } }; }
        const v = core.ark.verifyBirth(args["parent"] as import("@mneme-ai/core").ark.AgentGenome, args["child"] as import("@mneme-ai/core").ark.AgentGenome);
        return { data: v, wisdom: v.ok ? "✓ valid, accountable birth" : `🛑 ${v.violations.join("; ")}`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
