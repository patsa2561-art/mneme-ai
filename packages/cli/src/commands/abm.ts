/**
 * v2.19.93 — `mneme abm` CLI for Chronicle (Agent-Based Modeling).
 *
 * Verbs:
 *   mneme abm genesis  --config agents.json   create birth certs + state
 *   mneme abm simulate --ticks N              advance N ticks (anchor every M)
 *   mneme abm tick                            single-step
 *   mneme abm chronicle                       print final report + narrative
 *   mneme abm reset                           wipe the local state
 */

import { resolve } from "node:path";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

export interface AbmCommandOptions {
  cwd: string;
  mode: "genesis" | "simulate" | "tick" | "chronicle" | "reset";
  configPath?: string;
  ticks?: number;
  anchorEvery?: number;
  driftThreshold?: number;
  json?: boolean;
}

const BANNER = "📜 MNEME CHRONICLE";

export async function abmCommand(opts: AbmCommandOptions): Promise<void> {
  const core = await import("@mneme-ai/core");
  const repoRoot = resolve(opts.cwd);

  if (opts.mode === "reset") {
    const dir = join(repoRoot, ".mneme", "abm");
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    if (opts.json) process.stdout.write(JSON.stringify({ ok: true }) + "\n");
    else process.stdout.write(`${BANNER} — local ABM state wiped\n`);
    return;
  }

  if (opts.mode === "genesis") {
    if (!opts.configPath) { process.stderr.write("genesis requires --config <agents.json>\n"); process.exit(1); return; }
    const raw = readFileSync(opts.configPath, "utf8").replace(/^﻿/, ""); // strip BOM
    const seeds = JSON.parse(raw) as Parameters<typeof core.abmChronicle.genesis>[1];
    const state = core.abmChronicle.genesis(repoRoot, seeds, {
      anchorEveryTicks: opts.anchorEvery,
      driftThreshold: opts.driftThreshold,
    });
    if (opts.json) { process.stdout.write(JSON.stringify(state, null, 2) + "\n"); return; }
    process.stdout.write(`${BANNER} — genesis\n\n  sim:        ${state.simId}\n  agents:     ${state.agents.length}\n  anchor:     every ${state.config.anchorEveryTicks} ticks\n  threshold:  ${state.config.driftThreshold}\n\n`);
    for (const a of state.agents) {
      process.stdout.write(`  🧬 ${a.agentId}  ${a.birthCert.name.padEnd(16)}  budget=${a.budget}  cert=${a.birthCert.sig.slice(0, 10)}…\n`);
    }
    return;
  }

  const state = core.abmChronicle.loadState(repoRoot);
  if (!state) { process.stderr.write("No simulation state found. Run `mneme abm genesis --config <agents.json>` first.\n"); process.exit(1); return; }

  if (opts.mode === "tick") {
    const next = await core.abmChronicle.tick(repoRoot, state);
    if (opts.json) process.stdout.write(JSON.stringify(next, null, 2) + "\n");
    else process.stdout.write(`${BANNER} — tick ${next.tick}  (day ${next.worldClock.day}, month ${next.worldClock.month}, year ${next.worldClock.year})\n`);
    return;
  }

  if (opts.mode === "simulate") {
    const n = opts.ticks ?? 30;
    await core.abmChronicle.simulate(repoRoot, state, n);
    if (opts.json) {
      process.stdout.write(JSON.stringify({ ticksAdvanced: n, currentTick: state.tick, events: state.events.length }, null, 2) + "\n");
      return;
    }
    process.stdout.write(`${BANNER} — advanced ${n} ticks\n  current tick: ${state.tick}  (day ${state.worldClock.day}, month ${state.worldClock.month}, year ${state.worldClock.year})\n  events:       ${state.events.length}\n`);
    return;
  }

  if (opts.mode === "chronicle") {
    const r = core.abmChronicle.chronicle(state);
    if (opts.json) process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    else {
      process.stdout.write(`${BANNER} — final report\n\n`);
      process.stdout.write(`  sim:           ${r.simId}\n  started:       ${r.startedAt.slice(0, 19)}\n  ended:         ${r.endedAt.slice(0, 19)}\n  ticks ran:     ${r.ticksRan}  (${r.worldClock.year}y${r.worldClock.month}m${r.worldClock.day}d)\n`);
      process.stdout.write(`  agents:        ${r.agentCount}  (alive=${r.aliveCount}, died=${r.deathCount})\n`);
      process.stdout.write(`  decisions:     ${r.totalDecisions}\n  anchors fired: ${r.totalAnchors}\n`);
      if (r.firstHallucinationCascade) process.stdout.write(`  🌀 first cascade: tick ${r.firstHallucinationCascade.tick}, ${r.firstHallucinationCascade.involved.length} agents involved\n`);
      process.stdout.write(`\n  per-agent:\n`);
      for (const a of r.perAgent) {
        const tag = a.alive ? "✓" : "✗";
        process.stdout.write(`    ${tag} ${a.name.padEnd(16)}  budget=${a.budget.toString().padStart(6)}  drift=${a.finalDriftFromBirth.toFixed(2)}  anchors=${a.anchorCount}  reds=${a.redDecisionCount}\n`);
      }
      process.stdout.write(`\n  📖 narrative:\n  ${r.narrative}\n`);
    }
    return;
  }
}
