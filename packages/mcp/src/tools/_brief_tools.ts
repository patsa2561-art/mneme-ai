/**
 * v3.132.0 — REPO BRIEF MCP surface. mneme.brief.repo — the Context Capsule: ONE
 * git-native shared-context object an agent reads before touching the repo (team ·
 * decisions · hot files · TODOs · themes), deterministic + cited + local-first.
 * The Path-A moat. Wired into every agent + Matrix gRPC.
 */

import { spawnSync } from "node:child_process";
import type { MnemeTool } from "./_types.js";

function git(cwd: string, args: string[]): string { const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }); return r.status === 0 ? (r.stdout || "") : ""; }
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const BRIEF_TOOLS: MnemeTool[] = [
  {
    name: "mneme.brief.repo",
    category: "memory",
    description: "🧭 REPO BRIEF (the Context Capsule) — fuse this repo's git history into ONE git-native shared-context object: the TEAM (each contributor's commit persona), recent DECISIONS (meaningful commits + reasoning), HOT FILES (most-churned + last decision), open TODOs (cited file:line), and focus THEMES. Deterministic, fully cited, tamper-evident, local-first. The shared context every agent should inherit BEFORE touching the code — so it knows who/how/why instead of re-deriving or hallucinating. The Path-A moat: shared CONTEXT for multi-agent teams, not a 'memory product'. HONEST: a window onto measured git, reason from the citations.",
    whenToUse: "At the START of working on an unfamiliar (or shared multi-agent) repo — pull the Brief to inherit the team, the recent decisions, the hot files, and the open TODOs, all grounded + cited. Pairs with mneme.seance.summon (drill into a specific decision) and mneme.persona.scan.",
    triggers: ["repo brief", "context capsule", "onboard me to this repo", "what's the state of this repo", "shared context", "brief me on this codebase", "สรุป repo", "บริบทโปรเจกต์"],
    inputSchema: { type: "object", properties: { topTeam: { type: "number", description: "max contributors in the team section (default 8)" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const US = "\x1f", RS = "\x1e";
        const meta = git(cwd, ["log", "--no-merges", "-n", "5000", `--format=${RS}%H${US}%an${US}%at${US}%s${US}%b`]);
        if (!meta.trim()) return low("no git history (not a repo, or empty).");
        const byHash = new Map<string, import("@mneme-ai/core").repoBrief.BriefCommit>();
        for (const blk of meta.split(RS)) { if (!blk.trim()) continue; const [h, a, t, s, ...r] = blk.split(US); if (!h) continue; byHash.set(h.trim(), { hash: h.trim(), author: (a || "").trim(), ts: parseInt(t || "0", 10) || 0, subject: (s || "").trim(), body: (r.join(US) || "").trim(), files: [], churn: 0 }); }
        const ns = git(cwd, ["log", "--no-merges", "-n", "5000", "--numstat", `--format=${RS}%H`]);
        for (const blk of ns.split(RS)) { const lines = blk.split("\n").map((l) => l.trim()).filter(Boolean); if (!lines.length) continue; const rec = byHash.get(lines[0]!); if (!rec) continue; for (const l of lines.slice(1)) { const m = l.split("\t"); if (m.length < 3) continue; rec.churn! += (parseInt(m[0]!, 10) || 0) + (parseInt(m[1]!, 10) || 0); rec.files!.push(m[2]!); } }
        const commits = [...byHash.values()];
        const repoCommits = parseInt(git(cwd, ["rev-list", "--count", "HEAD"]).trim(), 10) || commits.length;
        const repo = (git(cwd, ["config", "--get", "remote.origin.url"]).trim() || "").replace(/^https?:\/\//, "").replace(/\.git$/, "") || "(local)";
        const grep = git(cwd, ["grep", "-nI", "-E", "TODO|FIXME|HACK|XXX", "HEAD", "--", "*.ts", "*.tsx", "*.js", "*.py", "*.go", "*.rs"]);
        const openTodos = grep.split("\n").map((l) => l.match(/^[^:]+:([^:]+):(\d+):(.*)$/)).filter(Boolean).slice(0, 20).map((m) => ({ file: m![1]!, line: parseInt(m![2]!, 10), text: m![3]!.trim().slice(0, 120) }));
        const brief = core.repoBrief.buildRepoBrief(commits, { repo, repoCommits, openTodos, topTeam: typeof args["topTeam"] === "number" ? (args["topTeam"] as number) : 8 });
        return { data: brief, wisdom: `🧭 Brief for ${brief.repo}: ${brief.reconciled.contributors} contributors, ${brief.reconciled.authoredCommits} authored commits. Team: ${brief.team.slice(0, 3).map((t) => `${t.author}(${t.tier})`).join(", ")}. Focus: ${brief.themes.slice(0, 5).join(", ")}. Reason from the ${brief.citations.length} citations.`, followUp: ["mneme.seance.summon"], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
