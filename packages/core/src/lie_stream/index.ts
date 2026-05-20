/**
 * v2.19.88 — #5 LIVE LIE STREAM.
 *
 * A live ticker of REFUTED (red-dot) Browser Polygraph verdicts.
 * Reads the same pulse.jsonl that powers IDEA #2 World Pulse.
 *
 * `mneme stream` runs an in-terminal ticker; the dashboard widget
 * subscribes to the same data via /v1/pulse/aggregate.  v2.19.88
 * ships LOCAL only — public "Live Lie Stream of every AI in the
 * world" needs the public Cloudflare Worker collector that's
 * already marked ROADMAP in WorldPulseView.
 */

import { readPulseEvents } from "../world_pulse/index.js";

export interface LieEvent {
  ts: number;
  vendor: string;
  regionTimezone?: string;
  topicHash?: string;
  /** Always "red" — that's the whole point of the stream. */
  color: "red";
}

export function readRecentLies(repoRoot: string, opts: { limit?: number; sinceTs?: number } = {}): LieEvent[] {
  const events = readPulseEvents(repoRoot, { sinceTs: opts.sinceTs, limit: opts.limit ? opts.limit * 4 : undefined });
  const lies: LieEvent[] = events
    .filter((e) => e.color === "red")
    .map((e) => ({ ts: e.ts, vendor: e.vendor, regionTimezone: e.regionTimezone, topicHash: e.topicHash, color: "red" as const }));
  return typeof opts.limit === "number" ? lies.slice(0, opts.limit) : lies;
}

/** Friendly one-liner for the ticker. */
export function formatLieTickerLine(e: LieEvent): string {
  const date = new Date(e.ts).toISOString().slice(11, 19);
  const region = e.regionTimezone ?? "?";
  return `[${date}]  🚨 ${e.vendor.padEnd(12)} lied  ·  region=${region}  ·  topic=${e.topicHash ?? "?"}`;
}
