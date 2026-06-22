/**
 * `mneme pr-comment` (v3.133.0) — generate the Mneme PR comment in CI: VERICERT of
 * the PR description + the git-native CONTEXT of every changed file (why it's the
 * way it is, cited) + the author's commit persona. Print markdown; the workflow
 * posts it. Free in your CI on any repo. Exit 2 if the PR description is REJECTED.
 *
 *   mneme pr-comment --base origin/main --title "$TITLE" --body "$BODY"
 */

import type { Command } from "commander";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { prReview } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }
function git(args: string[]): string { const r = spawnSync("git", args, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }); return r.status === 0 ? (r.stdout || "") : ""; }

function readCommits(max = 5000): prReview.PrCommit[] {
  const US = "\x1f", RS = "\x1e";
  const meta = git(["log", "--no-merges", "-n", String(max), `--format=${RS}%H${US}%an${US}%at${US}%s${US}%b`]);
  const byHash = new Map<string, prReview.PrCommit>();
  for (const blk of meta.split(RS)) { if (!blk.trim()) continue; const [h, a, t, s, ...r] = blk.split(US); if (!h) continue; byHash.set(h.trim(), { hash: h.trim(), author: (a || "").trim(), ts: parseInt(t || "0", 10) || 0, subject: (s || "").trim(), body: (r.join(US) || "").trim(), files: [], churn: 0 }); }
  const ns = git(["log", "--no-merges", "-n", String(max), "--numstat", `--format=${RS}%H`]);
  for (const blk of ns.split(RS)) { const lines = blk.split("\n").map((l) => l.trim()).filter(Boolean); if (!lines.length) continue; const rec = byHash.get(lines[0]!); if (!rec) continue; for (const l of lines.slice(1)) { const m = l.split("\t"); if (m.length < 3) continue; rec.churn! += (parseInt(m[0]!, 10) || 0) + (parseInt(m[1]!, 10) || 0); rec.files!.push(m[2]!); } }
  return [...byHash.values()];
}

export function registerPrCommentCommands(program: Command): void {
  program
    .command("pr-comment")
    .description("🧭 Generate the Mneme PR comment for CI — VERICERT of the PR description + git-native context of every changed file (why it's the way it is, cited) + the author's commit persona. Prints markdown for your workflow to post. Exit 2 if the PR description is REJECTED.")
    .option("--base <ref>", "the PR base branch to diff against", "origin/main")
    .option("--title <t>", "PR title (default: latest commit subject)")
    .option("--body <b>", "PR description ('-' or @file to read from stdin/file)")
    .option("--author <name>", "PR author (default: latest commit author)")
    .option("--json", "JSON output")
    .action((opts: { base: string; title?: string; body?: string; author?: string; json?: boolean }) => {
      const commits = readCommits();
      if (!commits.length) { out("no commits found (run inside a git repo)"); process.exitCode = 2; return; }
      // changed files = diff vs the merge-base with the PR base
      let changed = git(["diff", "--name-only", `${opts.base}...HEAD`]).split("\n").map((s) => s.trim()).filter(Boolean);
      if (!changed.length) changed = git(["diff", "--name-only", "HEAD~1...HEAD"]).split("\n").map((s) => s.trim()).filter(Boolean);
      const title = opts.title || git(["log", "-1", "--format=%s"]).trim();
      let body = opts.body || git(["log", "-1", "--format=%b"]).trim();
      if (body === "-") { try { body = readFileSync(0, "utf8"); } catch { body = ""; } }
      else if (body.startsWith("@")) { try { body = readFileSync(body.slice(1), "utf8"); } catch { /* */ } }
      const author = opts.author || git(["log", "-1", "--format=%an"]).trim();
      const review = prReview.buildPrComment({ title, body, changedFiles: changed, commits, author });
      if (opts.json) { out(JSON.stringify(review, null, 2)); }
      else { out(review.markdown); }
      process.exitCode = review.cert.verdict === "REJECTED" ? 2 : 0;
    });
}
