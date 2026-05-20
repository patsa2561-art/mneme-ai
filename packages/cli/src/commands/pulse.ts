/**
 * v2.19.84 — `mneme pulse` CLI.
 *
 * Surface for the World AI Pulse — query the HMAC-chained ledger of
 * polygraph events that have flowed through the local bridge.
 *
 * Subcommands:
 *   mneme pulse show        24-hour aggregate (default)
 *   mneme pulse events      tail of recent events
 *   mneme pulse verify      verify HMAC chain integrity end-to-end
 *   mneme pulse synth       generate synthetic events for demos / tests
 */

import { resolve } from "node:path";

export interface PulseCommandOptions {
  cwd: string;
  mode: "show" | "events" | "verify" | "synth";
  windowHours?: number;
  limit?: number;
  count?: number;
  json?: boolean;
}

const BANNER = "🌍 MNEME WORLD PULSE";

export async function pulseCommand(opts: PulseCommandOptions): Promise<void> {
  const core = await import("@mneme-ai/core");
  const repoRoot = resolve(opts.cwd);

  if (opts.mode === "verify") {
    const r = core.worldPulse.verifyPulseChain(repoRoot);
    if (opts.json) { process.stdout.write(JSON.stringify(r, null, 2) + "\n"); return; }
    process.stdout.write(`${BANNER} — chain integrity\n\n`);
    process.stdout.write(`  checked:     ${r.checked} events\n`);
    process.stdout.write(`  intact:      ${r.intact ? "✅ yes" : "❌ broken at index " + r.firstBrokenIndex}\n`);
    return;
  }

  if (opts.mode === "synth") {
    const count = opts.count ?? 240;
    const events = core.worldPulse.synthesizePulseEvents({ count, spanMinutes: 60 });
    let appended = 0;
    for (const e of events) {
      core.worldPulse.recordPulseEvent(repoRoot, e);
      appended++;
    }
    if (opts.json) { process.stdout.write(JSON.stringify({ ok: true, appended }, null, 2) + "\n"); return; }
    process.stdout.write(`${BANNER} — synthesized ${appended} events into .mneme/pulse.jsonl\n`);
    return;
  }

  if (opts.mode === "events") {
    const events = core.worldPulse.readPulseEvents(repoRoot, { limit: opts.limit ?? 20 });
    if (opts.json) { process.stdout.write(JSON.stringify(events, null, 2) + "\n"); return; }
    process.stdout.write(`${BANNER} — last ${events.length} events\n\n`);
    for (const e of events) {
      const dot = e.color === "green" ? "🟢" : e.color === "yellow" ? "🟡" : e.color === "red" ? "🔴" : "⚪";
      const ts = new Date(e.ts).toISOString().slice(0, 19).replace("T", " ");
      process.stdout.write(`  ${dot}  ${ts}  ${e.vendor.padEnd(11)}  ${e.regionTimezone ?? "?"}\n`);
    }
    if (events.length === 0) {
      process.stdout.write(`  (no events yet — start the browser polygraph to populate)\n`);
    }
    return;
  }

  // show
  const windowHours = opts.windowHours ?? 24;
  const events = core.worldPulse.readPulseEvents(repoRoot);
  const agg = core.worldPulse.aggregatePulse(events, { windowHours });
  if (opts.json) { process.stdout.write(JSON.stringify(agg, null, 2) + "\n"); return; }

  process.stdout.write(`${BANNER} — ${windowHours}h window\n\n`);
  process.stdout.write(`  total events: ${agg.total}\n`);
  process.stdout.write(`  🟢 green:  ${agg.byColor.green.toString().padStart(5)}    🟡 yellow: ${agg.byColor.yellow.toString().padStart(5)}\n`);
  process.stdout.write(`  🔴 red:    ${agg.byColor.red.toString().padStart(5)}    ⚪ grey:   ${agg.byColor.grey.toString().padStart(5)}\n\n`);

  const topVendors = Object.entries(agg.byVendor).sort((a, b) => b[1].total - a[1].total).slice(0, 8);
  if (topVendors.length > 0) {
    process.stdout.write(`  Vendor honesty leaderboard\n`);
    for (const [vendor, stats] of topVendors) {
      const honesty = stats.total > 0 ? Math.round((stats.green / stats.total) * 100) : 0;
      const refute = stats.total > 0 ? Math.round((stats.red / stats.total) * 100) : 0;
      process.stdout.write(`    ${vendor.padEnd(12)} ${stats.total.toString().padStart(5)} events · ${honesty.toString().padStart(3)}% trustworthy · ${refute.toString().padStart(3)}% refuted\n`);
    }
    process.stdout.write(`\n`);
  }

  const topRegions = Object.entries(agg.byRegion).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (topRegions.length > 0) {
    process.stdout.write(`  Top regions (IANA timezone)\n`);
    for (const [zone, count] of topRegions) {
      process.stdout.write(`    ${zone.padEnd(28)} ${count}\n`);
    }
    process.stdout.write(`\n`);
  }
  process.stdout.write(`  Open the dashboard's World Pulse tab to see the rotating globe.\n`);
}
