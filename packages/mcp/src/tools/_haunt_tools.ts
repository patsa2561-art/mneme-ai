/**
 * v2.141.0 — HAUNT MCP surface ("Code Haunting" / Git Telepathy).
 * mneme.haunt.investigate — given a file (+ optional line range + symptom),
 * gather real git facts and return the haunting report (who/when/why + missing
 * safeguards + related team knowledge). Self-attesting. HONEST: a candidate to
 * look at from real history, never a proven cause; UNKNOWN with no history.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, subject: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject, payload: { dataHash: h }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const HAUNT_TOOLS: MnemeTool[] = [
  {
    name: "mneme.haunt.investigate",
    category: "forensics",
    description: "👻 CODE HAUNTING (Git Telepathy) — when a region acts up (an alert, a slow function, a failing endpoint), surface the ghost of the commit that last touched it: who changed it, when, the INTENT they recorded ('temporary fix' / 'แก้ขัดไปก่อน' — detected in EN + TH), the safeguards it lacks for the symptom (no cache / no timeout / await-in-loop), and the team knowledge already shared about that area (pulled from the Cortex). One report instead of a manual git-blame dig. Self-attesting. HONEST: it surfaces + correlates REAL git facts + recorded intent — a candidate to LOOK at, never a proven cause; returns UNKNOWN (no fabricated author/reason) when there's no history.",
    whenToUse: "When you (or the user) are debugging a symptom in a specific file/region — BEFORE guessing why it's written that way. Pass the file, the line range if you have it, and the symptom from the alert. Use the 'why/intent' + missing-safeguards to focus the fix; treat HAUNTED as 'look here first', not proof.",
    triggers: ["haunt", "code haunting", "why is this slow", "who wrote this and why", "git blame intent", "what was the intent", "this function is failing", "ghost of this commit", "git telepathy"],
    inputSchema: { type: "object", required: ["file"], properties: { file: { type: "string", description: "repo-relative file path" }, line: { type: "string", description: "line range to focus, e.g. \"40-92\"" }, symptom: { type: "string", description: "the symptom from the alert, e.g. \"slow under traffic peak\"" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const file = typeof args["file"] === "string" ? args["file"] as string : "";
        if (!file) return low("no file provided");
        const lineStr = typeof args["line"] === "string" ? args["line"] as string : "";
        const m = lineStr.match(/^(\d+)\s*[-:,]\s*(\d+)$/);
        const region = m ? { start: parseInt(m[1]!, 10), end: parseInt(m[2]!, 10) } : undefined;
        const symptom = typeof args["symptom"] === "string" ? args["symptom"] as string : undefined;

        let blame: import("@mneme-ai/core").haunt.HauntBlame[] = [];
        let commits: import("@mneme-ai/core").haunt.HauntCommit[] = [];
        try { blame = (await core.git.blame(cwd, file, region?.start, region?.end)).map((b) => ({ commitHash: b.commitHash, authorName: b.authorName, authorTime: b.authorTime, lineNumber: b.lineNumber, content: b.content })); } catch { /* */ }
        try { commits = (await core.git.readCommits({ cwd, paths: [file], maxCount: 10 })).map((c) => ({ hash: c.hash, authorName: c.authorName, authorDate: c.authorDate, subject: c.subject, body: c.body })); } catch { /* */ }

        let codeSnippet = "";
        try { const p = join(cwd, file); if (existsSync(p)) { const ls = readFileSync(p, "utf8").split("\n"); codeSnippet = region ? ls.slice(Math.max(0, region.start - 1), region.end).join("\n") : ls.slice(0, 160).join("\n"); } } catch { /* */ }

        let knowledge: import("@mneme-ai/core").haunt.HauntKnowledge[] = [];
        try { const sp = join(cwd, ".mneme", "cortex", "store.json"); if (existsSync(sp)) { const store = JSON.parse(readFileSync(sp, "utf8")); const base = file.split("/").pop()?.replace(/\.[a-z]+$/i, "") ?? file; const hits = core.cortex.recall(store, `${base} ${file} ${symptom ?? ""}`.trim(), 3) ?? []; knowledge = hits.map((h) => ({ source: h.entry?.agent, value: h.entry?.value })).filter((k) => typeof k.value === "string" && k.value.length > 0); } } catch { /* */ }

        const report = core.haunt.buildHauntReport({ file, region, blame, commits, codeSnippet, symptom, knowledge, nowMs: Date.now() });
        const data = await attest(cwd, `haunt:${report.verdict}`, { ...(report as unknown as Record<string, unknown>) });
        return { data, wisdom: `${report.verdict === "HAUNTED" ? "👻" : report.verdict === "CLEAR" ? "🟢" : "❔"} ${report.narrative}`, followUp: [], confidence: { level: report.verdict === "UNKNOWN" ? "low" as const : "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
