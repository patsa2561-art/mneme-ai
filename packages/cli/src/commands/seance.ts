/**
 * `mneme seance` (v3.128.0) — talk to your past self. Reconstruct the decision
 * context around any commit (or "N months ago") from real git history — what you
 * said, what you were working on, the TODOs you had open, and what you abandoned —
 * all cited to real commits. Then reason FROM it (HPE-guarded), never invent.
 *
 *   mneme seance --at <ref>
 *   mneme seance --months 8
 */

import type { Command } from "commander";
import { spawnSync } from "node:child_process";
import { seance } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }
function git(args: string[]): string { const r = spawnSync("git", args, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }); return r.status === 0 ? (r.stdout || "") : ""; }

function readCommits(max = 4000): seance.PastCommit[] {
  const US = "\x1f", RS = "\x1e";
  const o = git(["log", "--no-merges", "-n", String(max), `--format=${RS}%H${US}%an${US}%at${US}%s${US}%b`]);
  const byHash = new Map<string, seance.PastCommit>();
  for (const blk of o.split(RS)) {
    if (!blk.trim()) continue;
    const [hash, author, at, subject, ...rest] = blk.split(US);
    if (!hash) continue;
    byHash.set(hash.trim(), { hash: hash.trim(), author: (author || "").trim(), ts: parseInt(at || "0", 10) || 0, subject: (subject || "").trim(), body: (rest.join(US) || "").trim(), files: [] });
  }
  return [...byHash.values()];
}

/** Resolve --at ref or --months N to a full commit hash. */
function resolveRef(ref?: string, months?: string): { ref: string; hash: string } | null {
  if (ref) { const h = git(["rev-parse", ref]).trim(); return h ? { ref, hash: h } : null; }
  if (months) { const h = git(["rev-list", "-1", `--before=${months} months ago`, "HEAD"]).trim(); return h ? { ref: `${months} months ago`, hash: h } : null; }
  const h = git(["rev-parse", "HEAD"]).trim(); return h ? { ref: "HEAD", hash: h } : null;
}

/** TODO/FIXME alive at a ref → cited file:line. */
function todosAtRef(hash: string): seance.TodoThen[] {
  const o = git(["grep", "-nI", "-E", "TODO|FIXME|HACK|XXX", hash, "--", "*.ts", "*.tsx", "*.js", "*.py", "*.go", "*.rs", "*.rb", "*.java"]);
  const todos: seance.TodoThen[] = [];
  for (const line of o.split("\n")) {
    // format: <ref>:<file>:<line>:<text>
    const m = line.match(/^[^:]+:([^:]+):(\d+):(.*)$/);
    if (m) todos.push({ file: m[1]!, line: parseInt(m[2]!, 10), text: m[3]!.trim().slice(0, 120) });
    if (todos.length >= 30) break;
  }
  return todos;
}

export function registerSeanceCommands(program: Command): void {
  program
    .command("seance")
    .description("🔮 SÉANCE — talk to your past self. Reconstruct the DECISION CONTEXT around any commit (what you said · were working on · had open as TODOs · abandoned), cited to real commits, so you (or an agent) can answer 'why did I choose this?' grounded in the record — never invented. Git-native shared context, local-first. HONEST: deterministic projection of git, not spirit-channeling; HPE-guard any answer.")
    .option("--at <ref>", "a commit ref / sha / tag to summon")
    .option("--months <n>", "summon your self from N months ago")
    .option("--json", "JSON output (the full grounded packet)")
    .action((opts: { at?: string; months?: string; json?: boolean }) => {
      const commits = readCommits();
      if (!commits.length) { out("no commits found (run inside a git repo)"); process.exitCode = 2; return; }
      const r = resolveRef(opts.at, opts.months);
      if (!r) { out("could not resolve that ref"); process.exitCode = 2; return; }
      const packet = seance.reconstructSeance(commits, r.hash, { ref: r.ref, todosThen: todosAtRef(r.hash), now: Math.floor(Date.now() / 1000) });
      if (opts.json) { out(JSON.stringify(packet, null, 2)); return; }
      out(`🔮 SÉANCE — your self at ${packet.at.ref} (${packet.at.monthsAgo} month(s) ago · ${packet.at.hash})`);
      out(`\n  💬 What you said:\n     "${packet.decision.subject}"${packet.decision.body ? `\n     ${packet.decision.body.split("\n")[0]}` : ""}`);
      if (packet.themes.length) out(`\n  🎯 What you were focused on:  ${packet.themes.join(" · ")}`);
      if (packet.window.length) { out(`\n  🕰  Leading up to it:`); for (const w of packet.window.slice(0, 6)) out(`     ${w.hash}  ${w.subject}`); }
      if (packet.lineage.length) { out(`\n  🧬 How this code evolved (same files):`); for (const l of packet.lineage.slice(0, 6)) out(`     ${l.hash}  ${l.subject}`); }
      if (packet.abandoned.length) { out(`\n  👻 Paths you abandoned:`); for (const a of packet.abandoned) out(`     ${a.hash}  ${a.subject}`); }
      if (packet.todosThen.length) { out(`\n  📌 Intentions you had open then:`); for (const t of packet.todosThen.slice(0, 6)) out(`     ${t.file}:${t.line}  ${t.text}`); }
      out(`\n  🧷 ${packet.citations.length} citations · packetId ${packet.packetId.slice(0, 16)}…`);
      out(`  ${packet.groundingNote}`);
    });
}
