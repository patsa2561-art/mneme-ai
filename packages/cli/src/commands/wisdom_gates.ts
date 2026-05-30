/**
 * `mneme cognitive-gate` + `mneme branch-oracle` (v2.103.0) — the two
 * wisdom gates on the CLI. Both gather their git facts, call the pure core,
 * and print a signed verdict. Total: a non-repo / git failure degrades
 * gracefully, never throws.
 */

import type { Command } from "commander";
import { execFileSync } from "node:child_process";

function git(cwd: string, args: string[]): string {
  try { return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }).trim(); } catch { return ""; }
}
function writeJson(p: unknown): void { process.stdout.write(JSON.stringify(p, null, 2) + "\n"); }
function writeText(l: string): void { process.stdout.write(l + "\n"); }

interface CoreShape {
  cognitiveGate: {
    buildCognitiveSignature: (author: string, diffs: string[]) => { author: string; sampleCount: number; intraVariance: number };
    wisdomGate: (repo: string, sig: unknown, diff: string, at: number, bench?: unknown) => { verdict: string; judgement: { deviation: number; ratio: number; reason: string }; separability?: { separable: boolean } };
  };
  branchOracle: {
    analyzeBranches: (repo: string, branches: unknown[], at: number) => { signals: Array<{ name: string; band: string; conflictRisk: string; ahead: number; behind: number; reasons: string[] }>; summary: { branches: number; healthy: number; caution: number; risky: number; safestBranch: string | null } };
  };
}
async function resolveCore(): Promise<CoreShape | null> {
  try { const core = (await import("@mneme-ai/core")) as unknown as CoreShape; if (core.cognitiveGate && core.branchOracle) return core; } catch { /* */ }
  return null;
}

export function registerWisdomGateCommands(program: Command): void {
  program
    .command("cognitive-gate")
    .description("🧠 COGNITIVE WISDOM GATE — a self-aware, signed second opinion on whether a diff matches an author's coding STYLE (NEMESIS micro-tells). Returns UNKNOWN (refuses to flag) when it can't reliably separate styles. ADVISORY, never auto-reject.")
    .option("--author <name>", "author to baseline (default: most recent committer)")
    .option("--samples <n>", "recent author commits to baseline", (v) => parseInt(v, 10), 12)
    .option("--json", "JSON output.")
    .action(async (opts: { author?: string; samples?: number; json?: boolean }) => {
      const core = await resolveCore();
      if (!core) { writeText("✗ @mneme-ai/core unavailable."); process.exitCode = 1; return; }
      const cwd = process.cwd();
      if (!git(cwd, ["rev-parse", "--git-dir"])) { writeText("✗ not a git repo"); process.exitCode = 1; return; }
      const who = opts.author || git(cwd, ["log", "-1", "--pretty=%an"]) || "unknown";
      const hashes = git(cwd, ["log", `--author=${who}`, "-n", String(opts.samples ?? 12), "--pretty=%H"]).split("\n").filter(Boolean);
      const diffs = hashes.map((h) => git(cwd, ["show", h, "--no-color", "--unified=3", "--pretty=format:"])).filter((d) => d.length > 0);
      const sig = core.cognitiveGate.buildCognitiveSignature(who, diffs);
      const newDiff = git(cwd, ["diff", "HEAD", "--no-color"]);
      const v = core.cognitiveGate.wisdomGate(cwd, sig, newDiff || "", Date.now());
      if (opts.json) { writeJson({ author: who, sampleCount: sig.sampleCount, verdict: v.verdict, deviation: v.judgement.deviation, ratio: v.judgement.ratio }); process.exitCode = 0; return; }
      writeText(`COGNITIVE WISDOM GATE — author ${who} (${sig.sampleCount} samples)`);
      writeText(``);
      writeText(`  verdict: ${v.verdict}  ·  ${v.judgement.reason}`);
      writeText(newDiff ? `  (judged the working-tree diff vs HEAD)` : `  (no working-tree diff — judged empty)`);
      if (v.verdict === "UNKNOWN") writeText(`  ⚪ honest: not enough signal to judge — the gate does not guess.`);
      process.exitCode = 0;
    });

  program
    .command("branch-oracle")
    .description("🌿 BRANCH ORACLE — a signed real-signal snapshot of every branch vs the base: merge-conflict overlap / decay / divergence → band (healthy/caution/risky). NOT a prediction; a present-tense health read. Ranks the safest branch.")
    .option("--base <branch>", "base branch (default: main, else master)")
    .option("--json", "JSON output.")
    .action(async (opts: { base?: string; json?: boolean }) => {
      const core = await resolveCore();
      if (!core) { writeText("✗ @mneme-ai/core unavailable."); process.exitCode = 1; return; }
      const cwd = process.cwd();
      if (!git(cwd, ["rev-parse", "--git-dir"])) { writeText("✗ not a git repo"); process.exitCode = 1; return; }
      let base = opts.base || "";
      if (!base) base = git(cwd, ["rev-parse", "--verify", "-q", "main"]) ? "main" : (git(cwd, ["rev-parse", "--verify", "-q", "master"]) ? "master" : "");
      if (!base) { writeText("✗ no base branch (main/master)"); process.exitCode = 1; return; }
      const branches = git(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"]).split("\n").filter((b) => b && b !== base);
      const inputs = branches.slice(0, 50).map((name) => {
        const mb = git(cwd, ["merge-base", base, name]);
        const ahead = parseInt(git(cwd, ["rev-list", "--count", `${base}..${name}`]) || "0", 10);
        const behind = parseInt(git(cwd, ["rev-list", "--count", `${name}..${base}`]) || "0", 10);
        const changedFiles = (mb ? git(cwd, ["diff", "--name-only", mb, name]) : "").split("\n").filter(Boolean);
        const baseChangedFiles = (mb ? git(cwd, ["diff", "--name-only", mb, base]) : "").split("\n").filter(Boolean);
        const last = git(cwd, ["log", "-1", "--format=%ct", name]);
        const ageDays = last ? Math.max(0, Math.round((Date.now() / 1000 - parseInt(last, 10)) / 86400)) : 0;
        return { name, ahead, behind, changedFiles, baseChangedFiles, staleFiles: 0, ageDays };
      });
      const r = core.branchOracle.analyzeBranches(cwd, inputs, Date.now());
      if (opts.json) { writeJson({ summary: r.summary, signals: r.signals }); process.exitCode = 0; return; }
      writeText(`BRANCH ORACLE — ${r.summary.branches} branch(es) vs ${base}`);
      writeText(``);
      for (const s of r.signals) {
        const icon = s.band === "healthy" ? "✓" : s.band === "caution" ? "·" : "⚠";
        writeText(`  ${icon} ${s.name.padEnd(28)} ${s.band.padEnd(8)} conflict=${s.conflictRisk} ahead=${s.ahead} behind=${s.behind}`);
      }
      writeText(``);
      writeText(`  ${r.summary.healthy} healthy · ${r.summary.caution} caution · ${r.summary.risky} risky · safest: ${r.summary.safestBranch ?? "—"}`);
      writeText(`  (signed real-signal snapshot — not a prediction)`);
      process.exitCode = 0;
    });
}
