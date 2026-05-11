/**
 * `mneme powers` (v1.48.0) — surface the state of Mneme's 9 Powers.
 *
 *   mneme powers status               -- one-line status per power
 *   mneme powers <N>                  -- detailed report for power N
 *   mneme powers manifesto            -- print ALETHEIA Manifesto markdown
 *   mneme powers spec                 -- print the protocol spec JSON
 *   mneme powers capsule              -- create a Rosetta capsule
 *   mneme powers wargame              -- run the adversarial war-game
 *   mneme powers treasury <revenue>   -- simulate DAO treasury allocation
 *   mneme powers scenario <key>       -- render a future-scenario position paper
 *   mneme powers gravity              -- compute anti-fork gravity
 */

import type { Command } from "commander";

interface CommonOpts { json?: boolean }
function out(opts: CommonOpts, jsonPayload: unknown, humanLines: string[]): void {
  if (opts.json) process.stdout.write(JSON.stringify(jsonPayload, null, 2) + "\n");
  else for (const line of humanLines) process.stdout.write(line + "\n");
}

const POWER_TITLES = [
  "P1 — Substrate Independence (protocol outlives any implementation)",
  "P2 — Sovereign Infrastructure (no jurisdiction can shut it down)",
  "P3 — Language Ownership (Mneme dialect)",
  "P4 — Philosophical Moat (ALETHEIA Manifesto, 9 articles)",
  "P5 — Anti-Fork Immunity (network gravity)",
  "P6 — Adversarial Resilience (attacks become vaccines)",
  "P7 — Autonomous Economy (DAO treasury policy)",
  "P8 — Existential Niche (5-scenario position papers)",
  "P9 — Inherits-the-Earth (Rosetta capsule)",
];

export function registerPowersCommand(program: Command): void {
  const cmd = program
    .command("powers")
    .description("The 9 Powers — Mneme's permanence engine. Status, gravity, manifesto, capsule, war-game, treasury, scenarios.");

  // ── status (default) ──────────────────────────────────────────────────
  cmd
    .command("status", { isDefault: true })
    .description("Show one-line status for each of the 9 Powers.")
    .option("--json", "JSON output")
    .action(async (opts: CommonOpts) => {
      const core = await import("@mneme-ai/core");
      const cwd = process.cwd();
      const p1 = core.powerSubstrate.validateImplementation(core.powerSubstrate.REFERENCE_IMPL_MANIFEST);
      const p2 = core.powerSovereign.auditSovereignty(cwd);
      const p3 = core.powerLanguage.MNEME_LEXICON.length;
      const p4 = core.powerPhilosophical.ALETHEIA_ARTICLES.length;
      const p5 = core.powerAntifork.computeGravity(cwd);
      const p6 = core.powerAdversarial.runWarGame(cwd);
      const p7defaults = core.powerAutonomous.DEFAULT_TREASURY_POLICY;
      const p8 = Object.keys(core.powerExistential.SCENARIOS).length;
      const p9 = core.powerInherits.listCapsules(cwd);
      const summary = {
        p1: { conforming: p1.conforming, capabilities: p1.declared.length, missing: p1.missing.length },
        p2: { verdict: p2.verdict, nodes: p2.nodeCount, jurisdictions: p2.jurisdictionCount, concentration: p2.concentrationRisk },
        p3: { lexiconTerms: p3 },
        p4: { manifestoArticles: p4 },
        p5: { gravity: p5.totalGravity, verdict: p5.verdict },
        p6: { detectionRatePct: p6.detectionRatePct, verdict: p6.verdict },
        p7: { rdSplit: p7defaults.rdSplit, runwayMonths: "n/a (no revenue)" },
        p8: { scenariosDefined: p8 },
        p9: { capsulesSealed: p9.length },
      };
      if (opts.json) { process.stdout.write(JSON.stringify(summary, null, 2) + "\n"); return; }
      process.stdout.write("Mneme — 9 Powers\n");
      process.stdout.write("─".repeat(72) + "\n");
      process.stdout.write(`  ${POWER_TITLES[0]}\n     conforming=${p1.conforming} · ${p1.declared.length} capabilities\n\n`);
      process.stdout.write(`  ${POWER_TITLES[1]}\n     verdict=${p2.verdict} · ${p2.nodeCount} nodes · ${p2.jurisdictionCount} jurisdictions · concentration=${p2.concentrationRisk}\n\n`);
      process.stdout.write(`  ${POWER_TITLES[2]}\n     lexicon=${p3} terms registered\n\n`);
      process.stdout.write(`  ${POWER_TITLES[3]}\n     manifesto=${p4} articles (M-001..M-009)\n\n`);
      process.stdout.write(`  ${POWER_TITLES[4]}\n     gravity=${p5.totalGravity}/100+ · verdict=${p5.verdict}\n\n`);
      process.stdout.write(`  ${POWER_TITLES[5]}\n     detectionRate=${p6.detectionRatePct}% · verdict=${p6.verdict} · ${p6.attacksReplayed} attacks replayed\n\n`);
      process.stdout.write(`  ${POWER_TITLES[6]}\n     policy=${(p7defaults.rdSplit * 100).toFixed(0)}/${(p7defaults.bountySplit * 100).toFixed(0)}/${(p7defaults.bdSplit * 100).toFixed(0)}/${(p7defaults.validatorSplit * 100).toFixed(0)} · runway=n/a (no revenue yet)\n\n`);
      process.stdout.write(`  ${POWER_TITLES[7]}\n     ${p8} future scenarios documented\n\n`);
      process.stdout.write(`  ${POWER_TITLES[8]}\n     ${p9.length} Rosetta capsule(s) sealed\n`);
    });

  // ── manifesto ─────────────────────────────────────────────────────────
  cmd
    .command("manifesto")
    .description("Print the ALETHEIA Manifesto markdown.")
    .action(async () => {
      const core = await import("@mneme-ai/core");
      process.stdout.write(core.powerPhilosophical.renderManifestoMarkdown() + "\n");
    });

  // ── spec ──────────────────────────────────────────────────────────────
  cmd
    .command("spec")
    .description("Print the Mneme Protocol spec as JSON (for future ports).")
    .action(async () => {
      const core = await import("@mneme-ai/core");
      process.stdout.write(JSON.stringify(core.powerSubstrate.exportSpec(), null, 2) + "\n");
    });

  // ── capsule (P9) ──────────────────────────────────────────────────────
  cmd
    .command("capsule")
    .description("Seal a Rosetta capsule (long-term archive of protocol + manifesto + wisdom packs).")
    .option("--note <text>", "Author note to embed in the capsule.")
    .option("--json", "JSON output")
    .action(async (opts: { note?: string } & CommonOpts) => {
      const core = await import("@mneme-ai/core");
      const c = core.powerInherits.createRosettaCapsule(process.cwd(), { authorNote: opts.note });
      out(opts, c, [
        `✓ sealed capsule ${c.capsuleId.slice(0, 16)} at ${c.createdAt}`,
        `  prevCapsule:    ${c.prevCapsuleHash ? c.prevCapsuleHash.slice(0, 16) : "(genesis)"}`,
        `  protocol v${c.protocol.protocolVersion} · ${c.manifesto.length} articles · ${c.wisdomPacks.length} packs · ${c.replayChainHeads.length} chain heads`,
      ]);
    });

  // ── wargame (P6) ──────────────────────────────────────────────────────
  cmd
    .command("wargame")
    .description("Run the adversarial war-game against the local attack log.")
    .option("--json", "JSON output")
    .action(async (opts: CommonOpts) => {
      const core = await import("@mneme-ai/core");
      const r = core.powerAdversarial.runWarGame(process.cwd());
      out(opts, r, [
        `verdict:        ${r.verdict}`,
        `attacks:        ${r.attacksReplayed} replayed`,
        `detection:      ${r.detected}/${r.attacksReplayed} (${r.detectionRatePct}%)`,
        `MTTD:           ${r.meanTimeToDetectMs ? r.meanTimeToDetectMs + "ms" : "n/a"}`,
        `gaps:           ${r.coverageGaps.length} categories`,
      ]);
    });

  // ── treasury (P7) ─────────────────────────────────────────────────────
  cmd
    .command("treasury <monthlyRevenue>")
    .description("Simulate the DAO treasury 12 months forward with a given monthly revenue (USD).")
    .option("--start <usd>", "Starting treasury (default 60000).", (v) => parseFloat(v), 60_000)
    .option("--months <n>", "Months to project (default 12).", (v) => parseInt(v, 10), 12)
    .option("--json", "JSON output")
    .action(async (revArg: string, opts: { start?: number; months?: number } & CommonOpts) => {
      const core = await import("@mneme-ai/core");
      const monthly = parseFloat(revArg);
      if (Number.isNaN(monthly)) { process.stderr.write(`monthly revenue must be a number\n`); process.exitCode = 1; return; }
      const rows = core.powerAutonomous.projectTreasury(opts.start ?? 60_000, monthly, opts.months ?? 12);
      if (opts.json) { process.stdout.write(JSON.stringify({ rows, policy: core.powerAutonomous.DEFAULT_TREASURY_POLICY }, null, 2) + "\n"); return; }
      process.stdout.write(core.powerAutonomous.renderProjectionText(rows) + "\n");
    });

  // ── scenario (P8) ─────────────────────────────────────────────────────
  cmd
    .command("scenario <key>")
    .description("Render a position paper for a future scenario (agi | quantum-ai | climate-collapse | interplanetary | post-human).")
    .action(async (key: string) => {
      const core = await import("@mneme-ai/core");
      try {
        process.stdout.write(core.powerExistential.renderScenarioPaper(key as never) + "\n");
      } catch (e) {
        process.stderr.write(`✗ ${(e as Error).message}\n`);
        process.exitCode = 1;
      }
    });

  // ── gravity (P5) ──────────────────────────────────────────────────────
  cmd
    .command("gravity")
    .description("Compute anti-fork gravity score for this repo.")
    .option("--json", "JSON output")
    .action(async (opts: CommonOpts) => {
      const core = await import("@mneme-ai/core");
      const g = core.powerAntifork.computeGravity(process.cwd());
      out(opts, g, [
        `gravity:    ${g.totalGravity}/100+`,
        `verdict:    ${g.verdict}`,
        `axes:`,
        `  vaccines:        ${g.axes.vaccines.count} (weight ${g.axes.vaccines.weight})`,
        `  replay chain:    ${g.axes.replayChain.entries} entries / ${g.axes.replayChain.bytes}B (weight ${g.axes.replayChain.weight})`,
        `  ratified cards:  ${g.axes.ratifiedCards.count} (weight ${g.axes.ratifiedCards.weight})`,
        `  handshakes:      ${g.axes.handshakes.count} (weight ${g.axes.handshakes.weight})`,
        `  CLI ticks 7d:    ${g.axes.cliActivity7d.ticks} (weight ${g.axes.cliActivity7d.weight})`,
        `  pheromones:      ${g.axes.pheromones.entries} (weight ${g.axes.pheromones.weight})`,
        `reasoning:  ${g.reasoning}`,
      ]);
    });
}
