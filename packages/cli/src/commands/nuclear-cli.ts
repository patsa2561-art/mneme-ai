/**
 * `mneme nuclear` (v1.33.0) -- WISDOM REACTOR readout.
 *
 * Five real nuclear-physics formulas surfaced as Mneme metrics:
 *   - E=mc² wisdom yield (mass defect from compression)
 *   - N(t)=N₀e^(-λt) atrophy half-life (per cluster band)
 *   - Q=Δm·c² EVOLVE patch energy (per template)
 *   - R=r₀·A^(1/3) cluster radius (RAG sizing)
 *   - k=neutrons/neutrons criticality (user engagement)
 *
 * Subcommands:
 *   mneme nuclear status        full reactor readout
 *   mneme nuclear k             just the criticality (one number)
 *   mneme nuclear half-life     atrophy decay table per band
 */

import type { Command } from "commander";

interface CommonOpts { json?: boolean }

function writeJson(payload: unknown): void { process.stdout.write(JSON.stringify(payload, null, 2) + "\n"); }
function writeText(line: string): void { process.stdout.write(line + "\n"); }

interface ReactorShape {
  computeReactorReport: (input: { repoRoot: string; rawChunks?: number; rawLessons?: number; rawCommits?: number; synthesizedDna?: number; synthesizedLessons?: number; evolveTemplates?: Array<{ id: string; locBefore: number; locAfter: number; confidence: number }>; clusters?: Array<{ id: string; A: number; observedR: number }> }) => {
    mass: { rawChunks: number; rawLessons: number; rawCommits: number; synthesizedDna: number; synthesizedLessons: number; massDefect: number; wisdomYield: number };
    atrophy: { perBand: Record<string, { tHalfDays: number; lambda: number }>; alivenessExample: number };
    evolveQ: { perTemplate: Array<{ templateId: string; locBefore: number; locAfter: number; confidence: number; Q: number }>; ranked: Array<{ templateId: string; Q: number }> };
    clusterRadius: { perSize: Array<{ A: number; theoreticalR: number }>; overflows: Array<{ clusterId: string; A: number; observedR: number; theoreticalR: number }> };
    criticality: { k: number; band: string; suggestedVerbosity: string; recentFollowups: number[] };
    banner: string;
  };
}

async function resolveReactor(): Promise<ReactorShape | null> {
  try {
    const core = (await import("@mneme-ai/core")) as { wisdomReactor?: ReactorShape };
    if (core.wisdomReactor && typeof core.wisdomReactor.computeReactorReport === "function") return core.wisdomReactor;
  } catch { /* */ }
  return null;
}

export function registerNuclearCommands(program: Command): void {
  const n = program
    .command("nuclear")
    .description("MNEME WISDOM REACTOR readout. Five real nuclear-physics formulas mapped to Mneme metrics: wisdom yield (E=mc² mass defect), atrophy half-life (radioactive decay), EVOLVE patch energy (reaction Q), RAG cluster radius, user-engagement criticality (k-factor).");

  n.command("status")
    .description("Full reactor readout: mass defect / wisdom yield / atrophy bands / EVOLVE Q / cluster radii / criticality.")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const reactor = await resolveReactor();
      if (!reactor) { writeText(`✗ wisdom_reactor unavailable. Upgrade: \`npm install -g mneme-ai@latest\`.`); process.exitCode = 1; return; }
      const repoRoot = process.cwd();
      // For v1.33.0 we feed minimal sample inputs. The daemon (next ship)
      // will populate these from the real store.
      const r = reactor.computeReactorReport({ repoRoot });
      if (opts.json) { writeJson(r); return; }
      writeText(`MNEME WISDOM REACTOR -- status`);
      writeText(``);
      writeText(`  ${r.banner}`);
      writeText(``);
      writeText(`E = mc² (mass defect → wisdom yield)`);
      writeText(`  raw mass:        ${r.mass.rawChunks + r.mass.rawLessons + r.mass.rawCommits} (chunks ${r.mass.rawChunks} + lessons ${r.mass.rawLessons} + commits ${r.mass.rawCommits})`);
      writeText(`  synthesized:     ${r.mass.synthesizedDna + r.mass.synthesizedLessons}`);
      writeText(`  ΔM (mass defect): ${r.mass.massDefect}`);
      writeText(`  wisdom yield:    ${r.mass.wisdomYield.toFixed(0)}`);
      writeText(``);
      writeText(`N(t) = N₀·e^(-λt) (atrophy half-life)`);
      for (const [band, info] of Object.entries(r.atrophy.perBand)) {
        writeText(`  ${band.padEnd(8)} T_½ = ${String(info.tHalfDays).padStart(5)} days   λ = ${info.lambda.toExponential(3)}`);
      }
      writeText(``);
      writeText(`Q = Δm·c² (EVOLVE patch energy)`);
      if (r.evolveQ.ranked.length === 0) {
        writeText(`  (no EVOLVE templates indexed yet -- run \`mneme evolve scan\` first)`);
      } else {
        for (const t of r.evolveQ.ranked.slice(0, 5)) writeText(`  ${t.templateId.padEnd(30)} Q=${t.Q.toFixed(1)}`);
      }
      writeText(``);
      writeText(`R = r₀·A^(1/3) (cluster radius theoretical max)`);
      for (const s of r.clusterRadius.perSize) {
        writeText(`  A=${String(s.A).padStart(4)}   R_max = ${s.theoreticalR.toFixed(4)}`);
      }
      if (r.clusterRadius.overflows.length > 0) {
        writeText(``);
        writeText(`  ⚠ ${r.clusterRadius.overflows.length} cluster(s) exceed theoretical R -- candidates for split:`);
        for (const o of r.clusterRadius.overflows) writeText(`    ${o.clusterId} (A=${o.A}, observed=${o.observedR.toFixed(3)}, max=${o.theoreticalR.toFixed(3)})`);
      }
      writeText(``);
      writeText(`k = neutrons_n / neutrons_n-1 (user-engagement criticality)`);
      writeText(`  k = ${r.criticality.k.toFixed(2)}   band: ${r.criticality.band}`);
      writeText(`  Suggested verbosity (NUCLEUS TIDE): ${r.criticality.suggestedVerbosity}`);
      if (r.criticality.recentFollowups.length > 0) {
        writeText(`  Recent followup counts: [${r.criticality.recentFollowups.join(", ")}]`);
      } else {
        writeText(`  (no follow-up data yet -- the daemon will record these as you use Mneme)`);
      }
    });

  n.command("k")
    .description("Just the criticality factor + band (one-line).")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const reactor = await resolveReactor();
      if (!reactor) { writeText(`✗ wisdom_reactor unavailable.`); process.exitCode = 1; return; }
      const r = reactor.computeReactorReport({ repoRoot: process.cwd() });
      if (opts.json) { writeJson({ k: r.criticality.k, band: r.criticality.band, suggestedVerbosity: r.criticality.suggestedVerbosity }); return; }
      writeText(`k = ${r.criticality.k.toFixed(3)}   ${r.criticality.band}   verbosity=${r.criticality.suggestedVerbosity}`);
    });

  n.command("half-life")
    .description("Atrophy decay table per cluster age band.")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const reactor = await resolveReactor();
      if (!reactor) { writeText(`✗ wisdom_reactor unavailable.`); process.exitCode = 1; return; }
      const r = reactor.computeReactorReport({ repoRoot: process.cwd() });
      if (opts.json) { writeJson(r.atrophy); return; }
      writeText(`Atrophy half-life (radioactive-decay model)`);
      writeText(``);
      for (const [band, info] of Object.entries(r.atrophy.perBand)) {
        writeText(`  ${band.padEnd(10)} T_½ = ${String(info.tHalfDays).padStart(5)} days   λ = ${info.lambda.toExponential(3)}`);
      }
    });
}
