/**
 * v2.6.0 -- WORMHOLE: channel auto-negotiation for cross-device sync.
 *
 *   "One call · every channel races · fastest live channel wins."
 *
 * The pattern Mneme accumulated by v2.5: more than ten folders all
 * answering the same family of question — "how do I move this brain
 * to another device / vendor?":
 *   ANCHOR    — parent-pole / child-rope identity
 *   AURA      — same-WiFi owner-only pairing
 *   RELAY     — anonymous public paste services
 *   CHAMELEON — environment-adaptive transport selection
 *   RAINBOW   — multi-channel handoff orchestrator
 *   SYNAPSE   — short-code + QR
 *   CONDUIT   — phantom-exec cross-vendor loop
 *   PERMEATE  — userscript + bookmarklet route-around
 *   DIASPORA  — gitignore + spore + HTTP bridge
 *   ABYSS     — capsule TTL + replay
 *   SEAMLESS  — voice directive
 *
 * The receiving AI never had a UNIFIED entry. WORMHOLE is that entry.
 *
 * Design — modeled on ICE/STUN/TURN connectivity establishment:
 *   1. Caller asks: "send this payload to peer X with quality Q".
 *   2. WORMHOLE enumerates registered CHANNELS (each wraps one of the
 *      existing transport modules).
 *   3. Channels marked `probe: () => boolean` are pinged in parallel
 *      with a hard timeout. Live ones survive.
 *   4. Among live channels, WORMHOLE sorts by ADAPTIVE SCORE (recent
 *      success rate × inverse latency × user preference).
 *   5. The first channel to successfully `send()` wins; the rest are
 *      cancelled. WORMHOLE records the outcome (success/latency) for
 *      the next negotiation's score.
 *
 * Wild move: the score is not static. Channels that worked yesterday
 * but flake today see their weight decay fast (~30-trial half-life).
 * A WiFi pairing channel scores high on a home network, low on a
 * coffee-shop captive portal — without anyone configuring anything.
 *
 * Transports stay independently usable (no breaking change). WORMHOLE
 * is a NEW SURFACE that composes them.
 */

export type ChannelProbeResult = "available" | "unavailable" | "needs-pairing";

export interface Channel<Payload, Receipt> {
  /** Stable id used in scoring + reporting. */
  id: string;
  /** Higher = caller would prefer this channel if all else equal. */
  preference?: number;
  /** Cheap availability probe. Must return within probeTimeoutMs. */
  probe: (ctx?: Record<string, unknown>) => Promise<ChannelProbeResult> | ChannelProbeResult;
  /** Heavy operation: actually move the payload. Must never throw —
   *  return { ok: false, reason } instead. */
  send: (payload: Payload, ctx?: Record<string, unknown>) => Promise<{ ok: true; receipt: Receipt } | { ok: false; reason: string }>;
}

export interface ChannelTrial {
  channel: string;
  outcome: "succeeded" | "failed" | "unavailable" | "needs-pairing";
  ms: number;
  reason?: string;
  ts: number;
}

export interface WormholeNegotiation<Receipt> {
  /** Channel that won the race. null if every channel failed. */
  winner: string | null;
  /** Receipt from the winning channel. */
  receipt: Receipt | null;
  /** Per-channel trial detail for the AI to surface to the user. */
  trials: ChannelTrial[];
  /** Total wall-clock ms. */
  totalMs: number;
  /** Adaptive score of each channel at the moment of negotiation. */
  scoresAtNegotiation: Record<string, number>;
}

/** Persisted-by-caller stats; WORMHOLE never writes to disk itself. */
export interface ChannelStats {
  channel: string;
  trials: number;
  succeeded: number;
  /** Exponentially-weighted recent success rate (recency = newer trials weigh more). */
  ewmaSuccess: number;
  /** Exponentially-weighted recent latency in ms. */
  ewmaLatencyMs: number;
}

const EWMA_ALPHA = 1 / 30; // ~30-trial half-life

/** Update channel stats with one new trial. Returns the new stats
 *  object — callers persist this (e.g. into .mneme/wormhole-stats.json). */
export function ingestTrial(prev: ChannelStats | undefined, trial: ChannelTrial): ChannelStats {
  const trials = (prev?.trials ?? 0) + 1;
  const succeeded = (prev?.succeeded ?? 0) + (trial.outcome === "succeeded" ? 1 : 0);
  const wasSuccess = trial.outcome === "succeeded" ? 1 : 0;
  const ewmaSuccess = prev ? prev.ewmaSuccess * (1 - EWMA_ALPHA) + wasSuccess * EWMA_ALPHA : wasSuccess;
  const ewmaLatencyMs = prev ? prev.ewmaLatencyMs * (1 - EWMA_ALPHA) + trial.ms * EWMA_ALPHA : trial.ms;
  return { channel: trial.channel, trials, succeeded, ewmaSuccess, ewmaLatencyMs };
}

/** Adaptive score: weight a channel by its EWMA success rate, inverse
 *  latency, and caller preference. Channels never tried before get a
 *  neutral 0.5 success rate so they actually get a chance to compete. */
function adaptiveScore<P, R>(c: Channel<P, R>, stats: ChannelStats | undefined): number {
  const success = stats ? stats.ewmaSuccess : 0.5;
  const latencyPenalty = stats ? 1 / (1 + stats.ewmaLatencyMs / 1000) : 1; // 1s → 0.5
  const pref = c.preference ?? 1;
  return success * latencyPenalty * pref;
}

export interface WormholeInput<Payload, Receipt> {
  payload: Payload;
  channels: ReadonlyArray<Channel<Payload, Receipt>>;
  /** Caller-supplied stats keyed by channel id. Undefined entries → cold start. */
  stats?: Record<string, ChannelStats>;
  /** Context passed verbatim to probe + send. */
  ctx?: Record<string, unknown>;
  /** Hard timeout per probe. Default 1500ms. */
  probeTimeoutMs?: number;
  /** Hard timeout per send. Default 15000ms. */
  sendTimeoutMs?: number;
  /** Maximum channels to try simultaneously during the send phase.
   *  Default 3 — keeps bandwidth + cost bounded. */
  concurrency?: number;
}

async function runWithTimeout<T>(p: Promise<T> | T, ms: number): Promise<T | "timeout"> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutP = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  try {
    return await Promise.race([Promise.resolve(p), timeoutP]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Run the negotiation. Returns the winning channel's receipt or null. */
export async function sendViaWormhole<Payload, Receipt>(input: WormholeInput<Payload, Receipt>): Promise<WormholeNegotiation<Receipt>> {
  const t0 = Date.now();
  const trials: ChannelTrial[] = [];
  if (input.channels.length === 0) {
    return { winner: null, receipt: null, trials, totalMs: 0, scoresAtNegotiation: {} };
  }

  // Phase 1: probe in parallel.
  const probeTimeout = input.probeTimeoutMs ?? 1500;
  const probes = await Promise.all(input.channels.map(async (c) => {
    const probeStart = Date.now();
    const res = await runWithTimeout(Promise.resolve(c.probe(input.ctx)), probeTimeout);
    const ms = Date.now() - probeStart;
    if (res === "timeout") {
      trials.push({ channel: c.id, outcome: "unavailable", ms, reason: "probe timeout", ts: Date.now() });
      return null;
    }
    if (res === "unavailable") {
      trials.push({ channel: c.id, outcome: "unavailable", ms, ts: Date.now() });
      return null;
    }
    if (res === "needs-pairing") {
      trials.push({ channel: c.id, outcome: "needs-pairing", ms, ts: Date.now() });
      return null;
    }
    return c;
  }));
  const live = probes.filter((x): x is Channel<Payload, Receipt> => x !== null);

  const scoresAtNegotiation: Record<string, number> = {};
  for (const c of input.channels) scoresAtNegotiation[c.id] = adaptiveScore(c, input.stats?.[c.id]);
  if (live.length === 0) {
    return { winner: null, receipt: null, trials, totalMs: Date.now() - t0, scoresAtNegotiation };
  }

  // Phase 2: rank by adaptive score, slice to concurrency, race.
  const sorted = live.slice().sort((a, b) => adaptiveScore(b, input.stats?.[b.id]) - adaptiveScore(a, input.stats?.[a.id]));
  const racers = sorted.slice(0, Math.max(1, input.concurrency ?? 3));
  const sendTimeout = input.sendTimeoutMs ?? 15000;

  let winner: { channel: string; receipt: Receipt } | null = null;
  const racePromises = racers.map(async (c) => {
    const sendStart = Date.now();
    const res = await runWithTimeout(c.send(input.payload, input.ctx), sendTimeout);
    const ms = Date.now() - sendStart;
    if (res === "timeout") {
      trials.push({ channel: c.id, outcome: "failed", ms, reason: "send timeout", ts: Date.now() });
      return null;
    }
    if (!res.ok) {
      trials.push({ channel: c.id, outcome: "failed", ms, reason: res.reason, ts: Date.now() });
      return null;
    }
    trials.push({ channel: c.id, outcome: "succeeded", ms, ts: Date.now() });
    return { channel: c.id, receipt: res.receipt };
  });

  // First-to-succeed wins. We still wait for all so the trials list is
  // complete (the AI may want to surface why losers lost).
  const results = await Promise.all(racePromises);
  for (const r of results) {
    if (r && !winner) winner = r;
  }
  return {
    winner: winner?.channel ?? null,
    receipt: winner?.receipt ?? null,
    trials,
    totalMs: Date.now() - t0,
    scoresAtNegotiation,
  };
}

/** Compact one-line pulse summary. */
export function formatWormholePulseLine<R>(n: WormholeNegotiation<R>): string {
  if (!n.winner) return `WORMHOLE · NO-CHANNEL · tried=${n.trials.length} · ${n.totalMs}ms`;
  return `WORMHOLE · OK · winner=${n.winner} · tried=${n.trials.length} · ${n.totalMs}ms`;
}
