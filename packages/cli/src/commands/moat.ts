/**
 * `mneme moat` (v2.150.0) — the deterministic, signed competitive-moat scorer.
 * Scores Mneme's moat from REAL present capabilities + their MEASURED signals
 * (live SIEGE resistance, Gateway accuracy, gauntlet scores). `moat delta` shows
 * the before→after lift from this session's moat builders.
 *
 *   mneme moat            # current moat score + per-dimension breakdown (signed)
 *   mneme moat delta      # pre-session baseline → current (measured improvement)
 */

import type { Command } from "commander";
import { moat as mt, siege as sg, intentGateway as gw, mycelium as myc, canon as cn, agentGovernor as gov, hephaestus, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

/** Gather REAL measured signals live (not hardcoded). */
function liveSignals(): mt.MoatSignals {
  let siegeResistanceLB = 0, gatewayAccuracy = 0;
  try { siegeResistanceLB = sg.scoreSiege(sg.siege((c) => hephaestus.classifyCommandRisk(c).risk === "destructive" ? "COSIGN" : "ALLOW")).resistanceLB; } catch { /* */ }
  try { gatewayAccuracy = gw.benchmark().newAcc; } catch { /* */ }
  return {
    siegeResistanceLB, gatewayAccuracy,
    myceliumGauntlet: safe(() => myc.myceliumGauntlet().score),
    canonGauntlet: safe(() => cn.canonGauntlet().score),
    governorGauntlet: safe(() => gov.governorGauntlet().score),
  };
}
function safe(f: () => number): number { try { return f(); } catch { return 0; } }

function render(title: string, r: mt.MoatReport): void {
  const icon = r.band === "FORTRESS" ? "🏰" : r.band === "STRONG" ? "🛡" : r.band === "FORMING" ? "🧱" : "🕳";
  out(`${icon} ${title} — ${r.overall}/100 (${r.band})`);
  for (const d of r.dimensions) out(`   ${d.dimension.padEnd(24)} ${String(d.score).padStart(3)}  ·  ${d.basis}`);
}

export function registerMoatCommands(program: Command): void {
  const m = program
    .command("moat")
    .description("📊 MOAT — a deterministic, SIGNED competitive-moat scorer. Not an opinion: a number computed from REAL present capabilities × their MEASURED signals (live SIEGE gate-resistance, Gateway routing accuracy, the mycelium/canon/governor gauntlets, signed-primitive depth, locally-accumulating ledgers = switching cost). `mneme moat` (current) · `mneme moat delta` (before→after). HONEST: engineering-moat signals verifiable in-repo — NOT a market valuation / traction / 'uncatchable' claim.")
    .option("--json", "JSON output (signed)")
    .action((opts: { json?: boolean }) => {
      const r = mt.scoreMoat({ capabilities: mt.CURRENT_CAPS, signals: liveSignals() });
      let receipt: unknown = null;
      try { receipt = notary.issueReceipt(process.cwd(), { kind: "claim-verdict", subject: `moat:${r.overall}`, payload: { overall: r.overall, band: r.band }, includePayload: true }); } catch { /* */ }
      if (opts.json) { out(JSON.stringify({ ...r, signed: receipt }, null, 2)); return; }
      render("MNEME MOAT", r);
      out(`   ${receipt ? "✓ signed · " : ""}${r.note}`);
    });

  m.command("delta")
    .description("the before→after moat lift from this session's moat builders (baseline caps vs current).")
    .option("--json", "JSON output")
    .action((opts: { json?: boolean }) => {
      const sig = liveSignals();
      const before = mt.scoreMoat({ capabilities: mt.BASELINE_CAPS, signals: sig });
      const after = mt.scoreMoat({ capabilities: mt.CURRENT_CAPS, signals: sig });
      if (opts.json) { out(JSON.stringify({ before, after, delta: after.overall - before.overall }, null, 2)); return; }
      render("BEFORE (pre-session baseline)", before);
      out("");
      render("AFTER  (current)", after);
      out("");
      out(`   📈 measured moat lift: +${after.overall - before.overall} (${before.overall}→${after.overall}, ${before.band}→${after.band})`);
    });
}
