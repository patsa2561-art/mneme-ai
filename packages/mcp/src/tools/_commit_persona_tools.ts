/**
 * v3.130.0 — COMMIT PERSONA MCP surface. mneme.persona.scan — read the local repo's
 * git history and return each contributor's measured commit persona (tier · level ·
 * stats · archetype). Wires the persona engine into every agent + Matrix gRPC.
 */

import { spawnSync } from "node:child_process";
import type { MnemeTool } from "./_types.js";

function git(cwd: string, args: string[]): string { const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }); return r.status === 0 ? (r.stdout || "") : ""; }
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const COMMIT_PERSONA_TOOLS: MnemeTool[] = [
  {
    name: "mneme.persona.scan",
    category: "insights",
    description: "🎭 COMMIT PERSONA — read the local repo's git history and return each contributor's MEASURED commit persona: archetype (Surgeon/Bulldozer/Firefighter/Storyteller/Night Owl/Machine Gun/Architect/Builder), tier (ROOKIE→LEGENDARY) + rarity, level, power, and a 5-stat sheet (precision/discipline/coverage/velocity/stability) from deterministic git signals. Exact git reconciliation (repo total · merges · authored). HONEST: measures commit HYGIENE, not a developer's skill or worth.",
    whenToUse: "When the user asks about a repo's commit culture, a contributor's git style, who-does-what, or wants the 'commit persona' / 3D-hero of a repo. Web equivalent: xray.mneme-ai.space/persona.",
    triggers: ["commit persona", "git style", "commit culture", "who commits how", "my git hero", "persona ของ repo", "สไตล์การ commit"],
    inputSchema: { type: "object", properties: { top: { type: "number", description: "max contributors (default 12)" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const US = "\x1f", RS = "\x1e";
        const meta = git(cwd, ["log", "--no-merges", "-n", "5000", `--format=${RS}%H${US}%an${US}%at${US}%s${US}%b`]);
        if (!meta.trim()) return low("no git history (not a repo, or empty).");
        const byHash = new Map<string, import("@mneme-ai/core").commitPersona.CommitRec>();
        for (const blk of meta.split(RS)) { if (!blk.trim()) continue; const [h, a, t, s, ...r] = blk.split(US); if (!h) continue; byHash.set(h.trim(), { author: (a || "unknown").trim(), ts: parseInt(t || "0", 10) || 0, subject: (s || "").trim(), body: (r.join(US) || "").trim(), files: [], insertions: 0, deletions: 0 }); }
        const ns = git(cwd, ["log", "--no-merges", "-n", "5000", "--numstat", `--format=${RS}%H`]);
        for (const blk of ns.split(RS)) { const lines = blk.split("\n").map((l) => l.trim()).filter(Boolean); if (!lines.length) continue; const rec = byHash.get(lines[0]!); if (!rec) continue; for (const l of lines.slice(1)) { const m = l.split("\t"); if (m.length < 3) continue; rec.insertions += parseInt(m[0]!, 10) || 0; rec.deletions += parseInt(m[1]!, 10) || 0; rec.files.push(m[2]!); } }
        const commits = [...byHash.values()];
        const repoCommits = parseInt(git(cwd, ["rev-list", "--count", "HEAD"]).trim(), 10) || commits.length;
        const all = core.commitPersona.analyzeCommitPersonas(commits, { minCommits: 1 });
        const top = typeof args["top"] === "number" ? (args["top"] as number) : 12;
        const personas = all.filter((p) => p.metrics.commits >= 3).slice(0, top).map((p) => ({ author: p.author, archetype: p.archetype, tier: p.tier, rarity: p.rarity, level: p.level, power: p.power, stats: p.stats, commits: p.metrics.commits }));
        return { data: { repoCommits, merges: Math.max(0, repoCommits - commits.length), authoredCommits: commits.length, contributors: all.length, personas }, wisdom: `🎭 ${personas.length} persona(s) from ${repoCommits} commits (${commits.length} authored). Top: ${personas.slice(0, 3).map((p) => `${p.author}=${p.tier}`).join(", ")}. HYGIENE, not skill.`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
