/**
 * `mneme stigmergy` (alias `mneme hive`) -- emergent collaboration
 * detection from git traces alone (v1.27.6).
 *
 *   mneme stigmergy                 # analyse last 500 commits
 *   mneme stigmergy --commits 1000  # bigger window
 *   mneme stigmergy --top 10        # show top N pairs
 *   mneme stigmergy --json          # machine-readable
 *
 * Surfaces the INVISIBLE collaboration layer: dev pairs who work on
 * the same code without ever talking. Often gold for org charts --
 * the real team structure vs the formal one.
 */

import type { Command } from "commander";
import { stigmergy } from "@mneme-ai/core";

interface CommonOpts { json?: boolean }

function writeJson(p: unknown): void { process.stdout.write(JSON.stringify(p, null, 2) + "\n"); }
function writeText(s: string): void { process.stdout.write(s + "\n"); }

export function registerStigmergyCommands(program: Command): void {
  const cmd = program
    .command("stigmergy")
    .alias("hive")
    .description("MNEME STIGMERGY HIVE -- emergent dev-collaboration detection from git traces alone (no chat logs needed). Finds pairs who effectively work together without ever talking.")
    .option("--commits <n>", "git log window size (default 500)", (v) => Number(v))
    .option("--top <n>", "show top N pairs (default 10)", (v) => Number(v))
    .option("--threshold <n>", "minimum stigmergy score to surface (default 10)", (v) => Number(v))
    .option("--git-dir <path>", "analyze a specific local git checkout (default cwd). Useful for pointing at a cloned multi-author repo to evaluate STIGMERGY beyond your own.")
    .option("--json", "JSON output.")
    .action((opts: { commits?: number; top?: number; threshold?: number; gitDir?: string } & CommonOpts) => {
      const target = opts.gitDir ?? process.cwd();
      const r = stigmergy.analyze(target, {
        windowCommits: opts.commits ?? 500,
        surfaceThreshold: opts.threshold ?? 10,
      });
      if (opts.json) { writeJson(r); return; }
      writeText(`MNEME STIGMERGY HIVE -- emergent collaboration analysis`);
      writeText(`  Commits analysed:  ${r.commitsAnalysed}`);
      writeText(`  Authors:           ${r.authorCount}`);
      writeText(`  Pairs surfaced:    ${r.pairs.length}  (${r.weakPairs} below threshold)`);
      if (r.pairs.length === 0) {
        writeText(``);
        writeText(`(no stigmergic pairs above threshold ${opts.threshold ?? 10})`);
        writeText(`Try: --threshold 5 or --commits 1000 to widen the search.`);
        return;
      }
      const top = opts.top ?? 10;
      writeText(``);
      writeText(`Top ${Math.min(top, r.pairs.length)} stigmergic dev pairs (highest score = strongest invisible collaboration):`);
      for (const p of r.pairs.slice(0, top)) {
        writeText(`  [${p.stigmergyScore.toString().padStart(3)}/100]  ${p.authorA}  <->  ${p.authorB}`);
        writeText(`         shared=${p.sharedFiles} files · sync=${p.synchronyHits} · carry-on=${p.carryOnHits}`);
        if (p.firstCoTouch && p.lastCoTouch) {
          writeText(`         first co-touch ${p.firstCoTouch.slice(0, 10)} · last ${p.lastCoTouch.slice(0, 10)}`);
        }
      }
      writeText(``);
      writeText(`Reading the score:`);
      writeText(`  shared files       = both authors touched these at any time`);
      writeText(`  sync               = touches within 24h of each other (one reacted to the other)`);
      writeText(`  carry-on           = one introduced a file, the other extended within 7 days`);
      writeText(``);
      writeText(`This is the INVISIBLE layer of org coordination. Pairs near the top often work`);
      writeText(`together effectively without ever DMing or PR-reviewing each other.`);
    });

  // v1.27.7 -- self-contained proof. Runs the algorithm against a
  // bundled synthetic 5-author / 200-commit history with KNOWN
  // ground-truth pairs. PASS = algorithm detects the engineered pairs.
  // Lets users prove STIGMERGY works without needing access to a
  // multi-author public repo.
  cmd.command("verify")
    .description("Run STIGMERGY against a built-in synthetic 5-author fixture with KNOWN ground-truth pairs. Proves the algorithm without needing a multi-author repo.")
    .option("--threshold <n>", "surface threshold to use in the verification (default 10)", (v) => Number(v))
    .option("--json", "JSON output.")
    .action((opts: { threshold?: number } & CommonOpts) => {
      const threshold = opts.threshold ?? 10;
      const r = stigmergy.verifyAgainstFixture(
        (commits) => stigmergy.computeOverlaps(commits),
        threshold,
      );
      if (opts.json) { writeJson(r); return; }
      writeText(`MNEME STIGMERGY HIVE -- verification against synthetic fixture`);
      writeText(`  Threshold:    ${threshold}`);
      writeText(`  Verdict:      ${r.ok ? "✓ PASS -- algorithm detects all engineered pairs" : "✗ FAIL -- see details below"}`);
      writeText(``);
      writeText(`Fixture: 5 authors (alice/bob/carol/dave/eve), ~200 commits, deterministic seed=42`);
      writeText(`  Engineered HIGH pairs:  alice<->bob (auth squad), carol<->dave (infra squad)`);
      writeText(`  Engineered LOW pair:    alice<->carol (weak overlap on shared/config.ts)`);
      writeText(`  Engineered LONE author: eve (touches src/util/* alone)`);
      writeText(``);
      writeText(`Per-assertion:`);
      for (const d of r.details) writeText(`  ${d}`);
      writeText(``);
      writeText(`Detected pair scores (top by score desc):`);
      const sorted = Object.entries(r.detectedScores).sort((a, b) => b[1] - a[1]).slice(0, 8);
      for (const [pair, score] of sorted) {
        writeText(`  [${score.toString().padStart(3)}/100]  ${pair.replace("::", "  <->  ")}`);
      }
      if (!r.ok) process.exit(1);
    });
}
