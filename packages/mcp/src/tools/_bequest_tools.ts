/**
 * v2.122.0 — BEQUEST (Second Brain Inheritance) MCP surface. Lets an agent
 * answer "how much org knowledge would be ORPHANED if a key person left, and
 * who should inherit it?" from the real git-derived atrophy signal. Self-
 * attesting (NOTARY _proof).
 */

import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(s, "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "memory-capsule", subject: "bequest:status", payload: { dataHash: h, tool: "bequest.status" }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const BEQUEST_TOOLS: MnemeTool[] = [
  {
    name: "mneme.bequest.status",
    category: "people",
    description: "🧬 SECOND BRAIN INHERITANCE — org knowledge-survival health. Reads the git-derived atrophy signal and reports inheritance completeness, ORPHANED knowledge (units whose survival = 1−∏(1−fluency) is below threshold — i.e. no living heir), and the minimum set of heirs to assign so the org survives. Self-attesting; $ only from a caller-supplied rate.",
    whenToUse: "When asked about key-person risk, knowledge inheritance, bus-factor, or 'what happens to our knowledge if X leaves'. Surface orphanedMass + the coverPlan (who to assign). Present figures as present-tense signals, not forecasts.",
    triggers: ["inheritance", "key person risk", "bus factor", "knowledge survival", "what if they leave", "orphaned knowledge", "succession"],
    inputSchema: { type: "object", properties: { budget: { type: "number", description: "max heirs to assign in the cover plan (default 5)" }, threshold: { type: "number", description: "survival below this = orphaned, 0..1 (default 0.5)" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const path = await import("node:path");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        if (!(await core.git.isGitRepo(cwd))) return low("not a git repo");
        const meta = await core.git.getRepoMeta(cwd);
        const s = new core.store.MnemeStore(path.join(meta.rootPath, ".mneme", "mneme.db"));
        try {
          if (s.countCommits() === 0) return low("memory empty — run `mneme index` first");
          const r = core.people.atrophy(s);
          const units = r.atRiskFiles.filter((f) => f.tier !== "safe").map((f) => ({ id: f.filePath, mass: f.totalTouches, holders: f.allKnowers.map((k) => ({ id: k.email, fluency: k.knowledge })) }));
          const byAuthor = new Map<string, Set<string>>();
          for (const f of r.atRiskFiles) { if (f.tier === "safe") continue; for (const k of f.allKnowers) { if (!byAuthor.has(k.email)) byAuthor.set(k.email, new Set()); byAuthor.get(k.email)!.add(f.filePath); } }
          const candidates = [...byAuthor.entries()].map(([id, set]) => ({ id, canCover: [...set] }));
          const rep = core.bequest.inheritanceReport(units, { orphanThreshold: typeof args["threshold"] === "number" ? args["threshold"] as number : 0.5 });
          const plan = core.bequest.minHeirCover(rep.orphans.map((u) => ({ id: u.id, mass: u.mass })), candidates, typeof args["budget"] === "number" ? args["budget"] as number : 5);
          const data = await attest(cwd, { completeness: rep.completeness, totalMass: rep.totalMass, orphanedMass: rep.orphanedMass, orphanCount: rep.orphans.length, unitCount: rep.unitCount, orphans: rep.orphans.slice(0, 10), coverPlan: plan });
          return {
            data,
            wisdom: rep.orphans.length === 0
              ? `🧬 Inheritance healthy — every at-risk unit has a living heir (completeness ${(rep.completeness * 100).toFixed(0)}%).`
              : `🧬 ${rep.orphans.length} orphaned knowledge unit(s) (no living heir) — completeness ${(rep.completeness * 100).toFixed(0)}%. Assign ${plan.chosen.length} heir(s) to cover ${(plan.coverageFraction * 100).toFixed(0)}% of orphaned mass.`,
            followUp: [],
            confidence: { level: "high" as const },
          };
        } finally { s.close(); }
      } catch (e) { return low((e as Error).message); }
    },
  },
];
