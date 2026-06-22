/**
 * v3.133.0 — PR REVIEW MCP surface. mneme.pr.review — generate the grounded PR
 * comment (VERICERT of the description + git-native file context + author persona)
 * for the local repo's changes vs a base. Wires the PR bot into every agent + Matrix gRPC.
 */

import { spawnSync } from "node:child_process";
import type { MnemeTool } from "./_types.js";

function git(cwd: string, args: string[]): string { const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }); return r.status === 0 ? (r.stdout || "") : ""; }
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const PR_REVIEW_TOOLS: MnemeTool[] = [
  {
    name: "mneme.pr.review",
    category: "quality",
    description: "🧭 PR REVIEW — generate ONE grounded review comment for a change set: a VERICERT of the PR title/description (catch a hallucinated/overconfident claim), the git-native CONTEXT of each changed file (why it's the way it is — last decision + churn, cited to real commits), and the author's commit persona. Deterministic, every line cited. The same engine the Mneme GitHub PR bot posts. HONEST: a window onto measured git + the verification engines, not an opinion.",
    whenToUse: "Before opening/reviewing a PR, or when an agent finishes a change set — generate the context+checks comment so reviewers (human or agent) inherit why the touched files are the way they are and whether the description holds up. Pairs with mneme.brief.repo + mneme.seance.summon.",
    triggers: ["review this pr", "pr comment", "check my changes before pr", "what does this pr touch", "context for this change", "รีวิว pr", "ตรวจ pr"],
    inputSchema: { type: "object", properties: { base: { type: "string", description: "base ref to diff against (default origin/main)" }, title: { type: "string" }, body: { type: "string", description: "PR description to VERICERT" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const US = "\x1f", RS = "\x1e";
        const meta = git(cwd, ["log", "--no-merges", "-n", "5000", `--format=${RS}%H${US}%an${US}%at${US}%s${US}%b`]);
        if (!meta.trim()) return low("no git history.");
        const byHash = new Map<string, import("@mneme-ai/core").prReview.PrCommit>();
        for (const blk of meta.split(RS)) { if (!blk.trim()) continue; const [h, a, t, s, ...r] = blk.split(US); if (!h) continue; byHash.set(h.trim(), { hash: h.trim(), author: (a || "").trim(), ts: parseInt(t || "0", 10) || 0, subject: (s || "").trim(), body: (r.join(US) || "").trim(), files: [], churn: 0 }); }
        const ns = git(cwd, ["log", "--no-merges", "-n", "5000", "--numstat", `--format=${RS}%H`]);
        for (const blk of ns.split(RS)) { const lines = blk.split("\n").map((l) => l.trim()).filter(Boolean); if (!lines.length) continue; const rec = byHash.get(lines[0]!); if (!rec) continue; for (const l of lines.slice(1)) { const m = l.split("\t"); if (m.length < 3) continue; rec.churn! += (parseInt(m[0]!, 10) || 0) + (parseInt(m[1]!, 10) || 0); rec.files!.push(m[2]!); } }
        const commits = [...byHash.values()];
        const base = typeof args["base"] === "string" && args["base"] ? args["base"] as string : "origin/main";
        let changed = git(cwd, ["diff", "--name-only", `${base}...HEAD`]).split("\n").map((s) => s.trim()).filter(Boolean);
        if (!changed.length) changed = git(cwd, ["diff", "--name-only", "HEAD~1...HEAD"]).split("\n").map((s) => s.trim()).filter(Boolean);
        const title = typeof args["title"] === "string" ? args["title"] as string : git(cwd, ["log", "-1", "--format=%s"]).trim();
        const body = typeof args["body"] === "string" ? args["body"] as string : git(cwd, ["log", "-1", "--format=%b"]).trim();
        const author = git(cwd, ["log", "-1", "--format=%an"]).trim();
        const review = core.prReview.buildPrComment({ title, body, changedFiles: changed, commits, author });
        return { data: review, wisdom: `🧭 PR description: ${review.cert.verdict} · ${review.fileContexts.length} files contextualized · author ${review.persona ? review.persona.tier : "?"}. ${review.cert.verdict === "REJECTED" ? "Fix the description before merge." : "Comment ready to post."}`, followUp: review.cert.verdict === "CERTIFIED" ? [] : ["mneme.protect.scan"], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
