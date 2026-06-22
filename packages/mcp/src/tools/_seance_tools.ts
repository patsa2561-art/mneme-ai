/**
 * v3.128.0 — SÉANCE MCP surface. mneme.seance.summon — reconstruct the grounded
 * decision-context around a commit so an agent can answer "why did past-me choose
 * this?" FROM cited evidence. The agent should HPE-guard its answer. Matrix gRPC auto.
 */

import { spawnSync } from "node:child_process";
import type { MnemeTool } from "./_types.js";

function git(cwd: string, args: string[]): string { const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }); return r.status === 0 ? (r.stdout || "") : ""; }
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const SEANCE_TOOLS: MnemeTool[] = [
  {
    name: "mneme.seance.summon",
    category: "memory",
    description: "🔮 SÉANCE — talk to your (or a teammate's) past self. Reconstruct the DECISION CONTEXT around a commit / 'N months ago' from real git history: what was said in that commit, the surrounding commits (what was being worked on), TODOs open then (cited file:line), and paths abandoned (reverts). Returns a grounded, CITED packet an agent reasons FROM to answer 'why did I choose this back then?' — git-native shared context, local-first. HONEST: a deterministic projection of git, NOT spirit-channeling; reason only from the cited evidence and HPE-guard the answer (an honest 'not in the record' beats an invented memory).",
    whenToUse: "When you (or the user) need the REASONING behind a past decision — before changing old code, during onboarding, or revisiting an architecture choice. Summon the context, then answer grounded in its citations; run your answer through mneme.protect.scan so a fabricated memory is blocked.",
    triggers: ["why did i choose this", "what was i thinking", "talk to my past self", "decision context", "why was this built this way", "ทำไมตอนนั้นถึงเลือกแบบนี้", "เรียกอดีต"],
    inputSchema: { type: "object", properties: { ref: { type: "string", description: "commit ref / sha / tag" }, months: { type: "number", description: "summon self from N months ago" }, file: { type: "string", description: "why is THIS file the way it is — reconstruct its decision history" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const US = "\x1f", RS = "\x1e";
        const o = git(cwd, ["log", "--no-merges", "-n", "4000", `--format=${RS}%H${US}%an${US}%at${US}%s${US}%b`]);
        if (!o.trim()) return low("no git history found (not a repo, or empty).");
        const commits = o.split(RS).filter((b) => b.trim()).map((blk) => { const [hash, author, at, subject, ...rest] = blk.split(US); return { hash: (hash || "").trim(), author: (author || "").trim(), ts: parseInt(at || "0", 10) || 0, subject: (subject || "").trim(), body: (rest.join(US) || "").trim(), files: [] as string[] }; });
        let hash = "", ref = "HEAD";
        const fileArg = typeof args["file"] === "string" ? (args["file"] as string).trim() : "";
        if (fileArg) { hash = git(cwd, ["log", "-1", "--format=%H", "--", fileArg]).trim(); ref = fileArg; }
        else if (typeof args["ref"] === "string" && args["ref"]) { hash = git(cwd, ["rev-parse", args["ref"] as string]).trim(); ref = args["ref"] as string; }
        else if (typeof args["months"] === "number") { hash = git(cwd, ["rev-list", "-1", `--before=${args["months"]} months ago`, "HEAD"]).trim(); ref = `${args["months"]} months ago`; }
        else hash = git(cwd, ["rev-parse", "HEAD"]).trim();
        if (!hash) return low("could not resolve that ref/file.");
        const grep = git(cwd, ["grep", "-nI", "-E", "TODO|FIXME|HACK|XXX", hash, "--", ...(fileArg ? [fileArg] : ["*.ts", "*.tsx", "*.js", "*.py", "*.go", "*.rs"])]);
        const todosThen = grep.split("\n").map((l) => l.match(/^[^:]+:([^:]+):(\d+):(.*)$/)).filter(Boolean).slice(0, 30).map((m) => ({ file: m![1]!, line: parseInt(m![2]!, 10), text: m![3]!.trim().slice(0, 120) }));
        const packet = core.seance.reconstructSeance(commits, hash, { ref, todosThen, now: Math.floor(Date.now() / 1000), focusFile: fileArg || undefined });
        return { data: packet, wisdom: `🔮 Summoned your self at ${packet.at.ref} (${packet.at.monthsAgo}mo ago). Reason ONLY from the ${packet.citations.length} cited commits/TODOs — HPE-guard your answer; 'not in the record' beats invention.`, followUp: ["mneme.protect.scan"], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
