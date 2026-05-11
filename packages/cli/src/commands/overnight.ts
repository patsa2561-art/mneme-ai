/**
 * `mneme overnight` (v1.34.0) -- run a goal-driven multi-round
 * transformation while the user sleeps. Inspired by ARIS but explicitly
 * broader: any code-touching goal, not just AI papers.
 *
 *   mneme overnight <goal>            run with the default 4-quark jury
 *                                     (Ollama-backed, free path)
 *   mneme overnight <goal> --rounds 4 --max-time 4h --max-cost 1.0
 *   mneme overnight list              list past sessions (sessions.jsonl)
 *   mneme overnight show <sessionId>  print the morning report
 *
 * The actor for v1.34.0 is a SIMPLE STUB: it records the goal + a
 * placeholder description per round so the WIRING + jury + budget
 * enforcement can be exercised end-to-end. Real-actor wiring (EVOLVE
 * + indexer + git apply) ships in v1.34.1+. The runner accepts ANY
 * actor function, so users can plug in custom actors today.
 */

import type { Command } from "commander";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

interface CommonOpts { json?: boolean }

function writeJson(payload: unknown): void { process.stdout.write(JSON.stringify(payload, null, 2) + "\n"); }
function writeText(line: string): void { process.stdout.write(line + "\n"); }

interface RunnerShape {
  runOvernight: (opts: {
    repoRoot: string;
    goal: { description: string; workItemKind?: string };
    actor: (input: { goal: { description: string }; roundNumber: number; priorFindings: unknown[] }) => Promise<{ description: string; qScore?: number; costEstimateUsd?: number }>;
    baseReviewer?: { id: string; review: (req: unknown) => Promise<unknown> };
    budget?: { maxRounds: number; maxWallSec: number; maxCostUsd?: number; rejectStreakStop?: number; negativeQStreakStop?: number };
  }) => Promise<{
    sessionId: string; rounds: unknown[]; stopReason: string;
    totalDurationMs: number; totalCostUsd: number; totalYield: number;
    reportPath: string;
  }>;
}
interface ConscienceShape {
  mockReviewer: (id: string, score: number, accept: boolean, reason?: string) => { id: string; review: (req: unknown) => Promise<unknown> };
}

async function resolveOvernight(): Promise<{ runner: RunnerShape; conscience: ConscienceShape } | null> {
  try {
    const core = (await import("@mneme-ai/core")) as { overnightRunner?: RunnerShape; overnightConscience?: ConscienceShape };
    if (core.overnightRunner && core.overnightConscience) return { runner: core.overnightRunner, conscience: core.overnightConscience };
  } catch { /* */ }
  return null;
}

function parseDurationToSec(s: string | undefined, defaultSec: number): number {
  if (!s) return defaultSec;
  const m = /^(\d+(?:\.\d+)?)([smhd])?$/.exec(s);
  if (!m) return defaultSec;
  const n = parseFloat(m[1]!);
  const unit = (m[2] ?? "s").toLowerCase();
  const factors: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return Math.floor(n * (factors[unit] ?? 1));
}

export function registerOvernightCommand(program: Command): void {
  const o = program
    .command("overnight")
    .description("Run a goal-driven multi-round transformation while you sleep. Inspired by ARIS but free-path-first: 6-quark jury (one Ollama model, six personas) reviews each round; NUCLEAR FUSION verdict bands; auto-stops on reject-streak / negative-Q-streak / budget exhaust. Wakes you up to a morning report at .mneme/overnight/<id>/REPORT.md.");

  o.command("run <goal>")
    .alias("start")
    .description("Run an overnight session for the given goal. Default: 4 rounds, 4h max, free Ollama-quark jury.")
    .option("--rounds <n>", "max rounds (ARIS default = 4)", (v: string) => parseInt(v, 10), 4)
    .option("--max-time <duration>", "wall-time cap (e.g., 4h, 30m, 7200s)", "4h")
    .option("--max-cost <usd>", "USD cost cap (when actor reports cost)", (v: string) => parseFloat(v))
    .option("--reject-streak <n>", "stop after N consecutive rejects", (v: string) => parseInt(v, 10), 2)
    .option("--negative-q-streak <n>", "stop after N consecutive negative-Q rounds", (v: string) => parseInt(v, 10), 2)
    .option("--kind <k>", "work item kind (evolve-patch | refactor | docs | other)", "other")
    .option("--reviewer-score <n>", "(stub actor only) mock reviewer score", (v: string) => parseFloat(v), 7)
    .option("--actor-q <n>", "(stub actor only) Q-score per round", (v: string) => parseFloat(v), 1)
    .option("--json", "JSON output.")
    .action(async (goal: string, opts: { rounds?: number; "max-time"?: string; maxTime?: string; "max-cost"?: number; maxCost?: number; "reject-streak"?: number; rejectStreak?: number; "negative-q-streak"?: number; negativeQStreak?: number; kind?: string; "reviewer-score"?: number; reviewerScore?: number; "actor-q"?: number; actorQ?: number } & CommonOpts) => {
      const repoRoot = process.cwd();
      const mods = await resolveOvernight();
      if (!mods) {
        writeText(`✗ overnight runner unavailable in this @mneme-ai/core. Upgrade: \`npm install -g mneme-ai@latest\`.`);
        process.exitCode = 1;
        return;
      }
      const maxRounds = opts.rounds ?? 4;
      const maxWallSec = parseDurationToSec(opts.maxTime ?? opts["max-time"], 4 * 3600);
      const maxCostUsd = opts.maxCost ?? opts["max-cost"];
      const rejectStreakStop = opts.rejectStreak ?? opts["reject-streak"] ?? 2;
      const negativeQStreakStop = opts.negativeQStreak ?? opts["negative-q-streak"] ?? 2;
      const reviewerScore = opts.reviewerScore ?? opts["reviewer-score"] ?? 7;
      const actorQ = opts.actorQ ?? opts["actor-q"] ?? 1;
      const kind = opts.kind ?? "other";

      // v1.34.0 ships a SIMPLE STUB ACTOR. Real-actor (EVOLVE + git
      // apply) wiring lands in v1.34.1+. The runner + jury + budget
      // are fully production-ready right now.
      const actor = async (input: { goal: { description: string }; roundNumber: number }) => ({
        description: `[stub actor] round ${input.roundNumber}: working toward goal "${input.goal.description}"`,
        qScore: actorQ,
        costEstimateUsd: 0.001,
      });
      const baseReviewer = mods.conscience.mockReviewer("mock:default", reviewerScore, reviewerScore >= 6);

      writeText(`🌙 Mneme Overnight starting...`);
      writeText(`  goal:   ${goal}`);
      writeText(`  budget: ${maxRounds} rounds · ${maxWallSec}s wall · ${maxCostUsd != null ? `$${maxCostUsd}` : "no $ cap"}`);
      writeText(``);

      const session = await mods.runner.runOvernight({
        repoRoot,
        goal: { description: goal, workItemKind: kind },
        actor,
        baseReviewer,
        budget: { maxRounds, maxWallSec, maxCostUsd, rejectStreakStop, negativeQStreakStop },
      });

      if (opts.json) { writeJson(session); return; }
      writeText(`☀️ Overnight session complete -- ${session.sessionId}`);
      writeText(``);
      writeText(`  rounds run:    ${session.rounds.length}`);
      writeText(`  stop reason:   ${session.stopReason}`);
      writeText(`  total time:    ${(session.totalDurationMs / 1000).toFixed(1)}s`);
      writeText(`  total cost:    $${session.totalCostUsd.toFixed(4)}`);
      writeText(`  wisdom yield:  ${session.totalYield.toFixed(2)}`);
      writeText(``);
      writeText(`  morning report: ${session.reportPath}`);
    });

  o.command("list")
    .description("List past overnight sessions from .mneme/overnight/sessions.jsonl.")
    .option("--json", "JSON output.")
    .option("-n, --limit <n>", "max entries to show", (v: string) => parseInt(v, 10), 20)
    .action((opts: { limit?: number } & CommonOpts) => {
      const repoRoot = process.cwd();
      const logPath = join(repoRoot, ".mneme", "overnight", "sessions.jsonl");
      if (!existsSync(logPath)) {
        if (opts.json) { writeJson({ sessions: [] }); return; }
        writeText(`No overnight sessions yet. Run: mneme overnight run "<goal>"`);
        return;
      }
      const lines = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
      const limit = opts.limit ?? 20;
      const recent = lines.slice(-limit);
      const sessions = recent.map((ln) => { try { return JSON.parse(ln); } catch { return null; } }).filter(Boolean);
      if (opts.json) { writeJson({ sessions }); return; }
      writeText(`Mneme overnight -- last ${sessions.length} session${sessions.length === 1 ? "" : "s"}`);
      writeText(``);
      for (const s of sessions) {
        const ts = (s.startedAt ?? "").replace("T", " ").slice(0, 19);
        writeText(`  ${ts}  ${s.sessionId}  rounds=${s.rounds}  yield=${(s.totalYield ?? 0).toFixed(1)}  $${(s.totalCostUsd ?? 0).toFixed(4)}  -- ${s.goal}`);
      }
    });

  o.command("show <sessionId>")
    .description("Print the morning report for a session.")
    .action((sessionId: string) => {
      const repoRoot = process.cwd();
      const reportPath = join(repoRoot, ".mneme", "overnight", sessionId, "REPORT.md");
      if (!existsSync(reportPath)) {
        // Try fuzzy match -- the user may have typed only a prefix.
        const dir = join(repoRoot, ".mneme", "overnight");
        if (existsSync(dir)) {
          const matches = readdirSync(dir).filter((d) => d.startsWith(sessionId));
          if (matches.length === 1) {
            const p = join(dir, matches[0]!, "REPORT.md");
            if (existsSync(p)) { writeText(readFileSync(p, "utf8")); return; }
          }
        }
        writeText(`✗ no morning report at ${reportPath}`);
        process.exitCode = 1;
        return;
      }
      writeText(readFileSync(reportPath, "utf8"));
    });
}
