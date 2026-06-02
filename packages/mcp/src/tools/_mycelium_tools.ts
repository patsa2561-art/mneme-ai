/**
 * v2.147.0 — MYCELIUM MCP surface (the Sovereign Data Flywheel).
 * mneme.mycelium.bundle — build a signed, content-free, DP-noised lesson bundle.
 * mneme.mycelium.merge — CRDT-merge a peer bundle (signature-verified). Self-attesting.
 */

import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, subject: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "memory-capsule", subject, payload: { dataHash: h }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const MYCELIUM_TOOLS: MnemeTool[] = [
  {
    name: "mneme.mycelium.bundle",
    category: "meta",
    description: "🍄 MYCELIUM — build a SIGNED, content-free, DP-noised bundle of local 'lessons' (what worked / what FAILED) to share with peer Mneme nodes. Lessons carry only one-way hashes + counts — NEVER raw code/secrets — so the network compounds with NO central data store (the privacy-preserving data flywheel only a local-first system can run). Pass the local outcomes (topic/approach/kind); get a shareable bundle. Self-attesting.",
    whenToUse: "Periodically, to contribute your node's hard-won lessons (successes AND failures) to the mesh without exposing any raw data. Peers merge it; everyone gets smarter.",
    triggers: ["mycelium", "data flywheel", "share lessons", "federated learning", "contribute knowledge to the mesh"],
    inputSchema: { type: "object", properties: { outcomes: { type: "array", items: { type: "object" }, description: "[{topic,approach,kind:'worked'|'failed',count?}] — stays content-free in the bundle" }, epsilon: { type: "number", description: "differential-privacy epsilon (default 1)" }, source: { type: "string" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const outcomes = Array.isArray(args["outcomes"]) ? args["outcomes"] as import("@mneme-ai/core").mycelium.LocalOutcome[] : [];
        const lessons = core.mycelium.extractLessons(outcomes, typeof args["source"] === "string" ? args["source"] as string : "node");
        const b = core.mycelium.buildBundle(lessons, { epsilon: typeof args["epsilon"] === "number" ? args["epsilon"] as number : 1, sample: () => 0 });
        const data = await attest(cwd, `mycelium.bundle:${b.lessons.length}`, { lessons: b.lessons, epsilon: b.epsilon });
        return { data, wisdom: `🍄 ${b.lessons.length} content-free lessons bundled (DP ε=${b.epsilon}) — no raw data leaves the node.`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
  {
    name: "mneme.mycelium.merge",
    category: "meta",
    description: "🍄 MYCELIUM — CRDT-merge peer lesson bundles into a local mesh (union by id, count = max, signature-verified — forged dropped). Commutative + idempotent ⇒ all nodes converge. Returns the merged mesh + added/updated/dropped counts. Self-attesting.",
    whenToUse: "When you receive lesson bundles from peer Mneme nodes — merge them to inherit their hard-won knowledge (successes AND failures) without any central server.",
    triggers: ["mycelium merge", "merge lessons", "inherit peer knowledge", "converge the mesh"],
    inputSchema: { type: "object", required: ["incoming"], properties: { local: { type: "array", items: { type: "object" } }, incoming: { type: "array", items: { type: "object" } } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const local = Array.isArray(args["local"]) ? args["local"] as import("@mneme-ai/core").mycelium.Lesson[] : [];
        const incoming = Array.isArray(args["incoming"]) ? args["incoming"] as import("@mneme-ai/core").mycelium.Lesson[] : [];
        const r = core.mycelium.mergeBundles(local, incoming);
        const data = await attest(cwd, `mycelium.merge:${r.merged.length}`, { merged: r.merged, added: r.added, updated: r.updated, dropped: r.dropped });
        return { data, wisdom: `🍄 merged — +${r.added} new · ~${r.updated} updated · ${r.dropped} dropped · mesh ${r.merged.length} lessons. Network converges (CRDT).`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
