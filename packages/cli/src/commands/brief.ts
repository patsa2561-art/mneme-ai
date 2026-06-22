/**
 * `mneme brief` (v3.132.0) — the Context Capsule. Fuse this repo's git history into
 * ONE git-native shared-context object every agent inherits: the team (commit
 * personas), recent decisions, hot files, open TODOs, themes — deterministic, cited,
 * local-first. The Path-A moat: not "memory", but shared CONTEXT for multi-agent teams.
 */

import type { Command } from "commander";
import { spawnSync } from "node:child_process";
import { repoBrief } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }
function git(args: string[]): string { const r = spawnSync("git", args, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }); return r.status === 0 ? (r.stdout || "") : ""; }

function readBriefCommits(max = 5000): repoBrief.BriefCommit[] {
  const US = "\x1f", RS = "\x1e";
  const meta = git(["log", "--no-merges", "-n", String(max), `--format=${RS}%H${US}%an${US}%at${US}%s${US}%b`]);
  const byHash = new Map<string, repoBrief.BriefCommit>();
  for (const blk of meta.split(RS)) { if (!blk.trim()) continue; const [h, a, t, s, ...r] = blk.split(US); if (!h) continue; byHash.set(h.trim(), { hash: h.trim(), author: (a || "").trim(), ts: parseInt(t || "0", 10) || 0, subject: (s || "").trim(), body: (r.join(US) || "").trim(), files: [], churn: 0 }); }
  const ns = git(["log", "--no-merges", "-n", String(max), "--numstat", `--format=${RS}%H`]);
  for (const blk of ns.split(RS)) { const lines = blk.split("\n").map((l) => l.trim()).filter(Boolean); if (!lines.length) continue; const rec = byHash.get(lines[0]!); if (!rec) continue; for (const l of lines.slice(1)) { const m = l.split("\t"); if (m.length < 3) continue; rec.churn! += (parseInt(m[0]!, 10) || 0) + (parseInt(m[1]!, 10) || 0); rec.files!.push(m[2]!); } }
  return [...byHash.values()];
}
function todosAtHead(): repoBrief.BriefTodo[] {
  const o = git(["grep", "-nI", "-E", "TODO|FIXME|HACK|XXX", "HEAD", "--", "*.ts", "*.tsx", "*.js", "*.py", "*.go", "*.rs"]);
  const out2: repoBrief.BriefTodo[] = [];
  for (const l of o.split("\n")) { const m = l.match(/^[^:]+:([^:]+):(\d+):(.*)$/); if (m) out2.push({ file: m[1]!, line: parseInt(m[2]!, 10), text: m[3]!.trim().slice(0, 120) }); if (out2.length >= 20) break; }
  return out2;
}

export function registerBriefCommands(program: Command): void {
  program
    .command("brief")
    .description("🧭 REPO BRIEF (the Context Capsule) — fuse this repo's git history into ONE git-native shared-context object every agent inherits: the team (commit personas) · recent decisions · hot files · open TODOs · themes. Deterministic, cited, tamper-evident, local-first. The Path-A moat: shared CONTEXT for multi-agent teams, not a 'memory product'.")
    .option("--json", "JSON output (the full signed-able brief)")
    .action((opts: { json?: boolean }) => {
      const commits = readBriefCommits();
      if (!commits.length) { out("no commits found (run inside a git repo)"); process.exitCode = 2; return; }
      const repoCommits = parseInt(git(["rev-list", "--count", "HEAD"]).trim(), 10) || commits.length;
      const repo = (git(["config", "--get", "remote.origin.url"]).trim() || "").replace(/^https?:\/\//, "").replace(/\.git$/, "") || "(local)";
      const b = repoBrief.buildRepoBrief(commits, { repo, repoCommits, openTodos: todosAtHead() });
      if (opts.json) { out(JSON.stringify(b, null, 2)); return; }
      out(`🧭 REPO BRIEF — ${b.repo}`);
      out(`   ${b.reconciled.repoCommits} commits in repo · ${b.reconciled.merges} merge(s) excluded · ${b.reconciled.authoredCommits} authored · ${b.reconciled.contributors} contributors`);
      if (b.themes.length) out(`\n  🎯 Focus: ${b.themes.join(" · ")}`);
      if (b.team.length) { out(`\n  👥 Team:`); for (const t of b.team) out(`     ${t.tier.padEnd(9)} ${t.archetype.padEnd(16)} ${t.author} (${t.commits} commits)`); }
      if (b.decisions.length) { out(`\n  💡 Recent decisions:`); for (const d of b.decisions.slice(0, 6)) out(`     ${d.hash}  ${d.subject}`); }
      if (b.hotFiles.length) { out(`\n  🔥 Hot files:`); for (const h of b.hotFiles.slice(0, 6)) out(`     ${String(h.touches).padStart(3)}× ${h.file}`); }
      if (b.openTodos.length) { out(`\n  📌 Open TODOs: ${b.openTodos.length} (e.g. ${b.openTodos[0]!.file}:${b.openTodos[0]!.line})`); }
      out(`\n  🧷 ${b.citations.length} citations · briefId ${b.briefId.slice(0, 16)}…`);
      out(`  ${b.note}`);
    });
}
