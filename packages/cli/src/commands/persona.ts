/**
 * `mneme persona` (v3.123.0) — COMMIT PERSONA: turn this repo's real git history
 * into a measured "commit persona" per contributor + a distinct cartoon avatar.
 * HONEST: it scores commit HYGIENE (messages / size / tests / fixups), not skill.
 *
 *   mneme persona                       # personas for the local repo
 *   mneme persona --svg ./avatars       # also write each avatar as an SVG
 *   mneme persona --json
 */

import type { Command } from "commander";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { commitPersona } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

function readLocalCommits(max = 500): commitPersona.CommitRec[] {
  const US = "\x1f", RS = "\x1e";
  const meta = spawnSync("git", ["log", "--no-merges", "-n", String(max), `--format=${RS}%H${US}%an${US}%at${US}%s${US}%b`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (meta.status !== 0 || !meta.stdout) return [];
  const byHash = new Map<string, commitPersona.CommitRec>();
  for (const blk of meta.stdout.split(RS)) {
    if (!blk.trim()) continue;
    const [hash, author, at, subject, ...rest] = blk.split(US);
    if (!hash) continue;
    byHash.set(hash.trim(), { author: (author || "unknown").trim(), ts: parseInt(at || "0", 10) || 0, subject: (subject || "").trim(), body: (rest.join(US) || "").trim(), files: [], insertions: 0, deletions: 0 });
  }
  const ns = spawnSync("git", ["log", "--no-merges", "-n", String(max), "--numstat", `--format=${RS}%H`], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  if (ns.status === 0 && ns.stdout) {
    for (const blk of ns.stdout.split(RS)) {
      const lines = blk.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!lines.length) continue;
      const rec = byHash.get(lines[0]!); if (!rec) continue;
      for (const l of lines.slice(1)) { const m = l.split("\t"); if (m.length < 3) continue; rec.insertions += parseInt(m[0]!, 10) || 0; rec.deletions += parseInt(m[1]!, 10) || 0; rec.files.push(m[2]!); }
    }
  }
  return [...byHash.values()];
}

export function registerPersonaCommands(program: Command): void {
  program
    .command("persona")
    .description("🎭 COMMIT PERSONA — render each contributor's git style as a measured persona + a distinct cartoon (The Surgeon / Bulldozer / Firefighter / Storyteller…). Deterministic, from real git signals. HONEST: scores commit HYGIENE, not skill. Web: xray.mneme-ai.space/persona")
    .option("--json", "JSON output")
    .option("--svg <dir>", "also write each contributor's avatar as <author>.svg into <dir>")
    .option("--top <n>", "max contributors", "12")
    .action((opts: { json?: boolean; svg?: string; top?: string }) => {
      const commits = readLocalCommits();
      if (!commits.length) { out("no commits found (run inside a git repo)"); process.exitCode = 2; return; }
      const personas = commitPersona.analyzeCommitPersonas(commits, { top: parseInt(opts.top || "12", 10), minCommits: 2 });
      if (opts.svg) { try { mkdirSync(opts.svg, { recursive: true }); for (const p of personas) writeFileSync(join(opts.svg, p.author.replace(/[^A-Za-z0-9._-]/g, "_") + ".svg"), commitPersona.personaAvatarSvg(p)); out(`🎭 ${personas.length} avatar(s) → ${opts.svg}`); } catch { /* */ } }
      if (opts.json) { out(JSON.stringify(personas.map((p) => ({ ...p, avatarSvg: commitPersona.personaAvatarSvg(p) })), null, 2)); return; }
      out(`🎭 Commit Personas — ${personas.length} contributor(s), from real git history (hygiene, not skill)`);
      for (const p of personas) {
        const m = p.metrics;
        out(`\n  ${p.archetype}  ·  ${p.author}`);
        out(`    🧼 ${p.band} ${p.hygiene}  ·  📦 ${m.commits} commits  ·  📏 ~${Math.round(m.avgChurn)} lines/commit  ·  🧪 ${Math.round(m.testTouchRate * 100)}% w/ tests  ·  📝 ${Math.round(m.conventionalRate * 100)}% conventional${m.fixRate > 0.1 ? `  ·  🚒 ${Math.round(m.fixRate * 100)}% firefighting` : ""}`);
        out(`    ${p.blurb}`);
      }
      out(`\n  honest: commit hygiene measured from messages/size/tests/fixups — NOT a judgment of the person.`);
    });
}
