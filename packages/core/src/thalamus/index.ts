/**
 * v2.19.23 — MNEME THALAMUS (organ #2 of LIMBIC) · sensory router
 *
 *   "event → tier → route ไปสมองส่วนที่เหมาะสม"
 *
 *   Diagnosis: REFLEX, DREAMS, CORTEX, BREATH all exist as separate
 *   organs. Without a router, the daemon has to manually decide which
 *   organ handles each event. That's the same 'cortex thinks too much'
 *   bug REFLEX was meant to fix.
 *
 *   Fix: THALAMUS classifies every event into one of 4 tiers, then
 *   routes to the matching organ's handler. Caller supplies the
 *   handlers (vendor-agnostic); THALAMUS only decides + dispatches.
 *
 * Tiers:
 *   - "reflex" — event has a cached REFLEX entry; return instant
 *   - "cortex" — event needs synchronous tool call (normal MCP path)
 *   - "dream"  — system is idle; defer to background consolidation
 *   - "breath" — daemon dead; respawn first, then escalate
 *
 * Composes onto:
 *   - v2.19.22 REFLEX (cache HIT short-circuits)
 *   - v2.19.23 BREATH (daemon-dead triggers respawn)
 *   - v2.19.14 DREAMS (idle period triggers consolidation)
 *   - v2.19.16 FEDERATED (when remote attestations needed, route via cortex)
 *
 * Honest scope:
 *   - PURE FUNCTION classifier. Handlers are caller-supplied async fns.
 *   - Routes by RULE, not by ML. Deterministic; auditable.
 *   - No fallback CASCADE; explicit tier per event. Caller picks.
 */

import { createHmac } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export type ThalamusTier = "reflex" | "cortex" | "dream" | "breath";

export interface ThalamusEvent {
  v: typeof PROTOCOL_VERSION;
  kind: "tool_call" | "file_save" | "git_commit" | "terminal_command" | "user_chat" | "idle_tick" | "daemon_health";
  context: Record<string, unknown>;
  ts: number;
}

export interface RouteContext {
  /** Caller signals: is there a fresh cache entry for this event? */
  hasReflexCacheHit: boolean;
  /** Caller signals: daemon PID file present + alive? */
  daemonAlive: boolean;
  /** Caller signals: how long since last user activity, in ms. */
  idleMs: number;
  /** Threshold for "idle enough to dream". Default 30min. */
  dreamIdleThresholdMs?: number;
}

export interface RouteDecision {
  v: typeof PROTOCOL_VERSION;
  tier: ThalamusTier;
  reason: string;
  /** HMAC sig for audit. */
  sig: string;
}

export interface TierHandlers<T> {
  reflex: (event: ThalamusEvent) => Promise<T>;
  cortex: (event: ThalamusEvent) => Promise<T>;
  dream: (event: ThalamusEvent) => Promise<T>;
  breath: (event: ThalamusEvent) => Promise<T>;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_THALAMUS_SECRET"] || `mneme-thalamus-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

/**
 * Classify an event into one of 4 tiers.
 *
 * Rules (in priority order):
 *   1. daemon dead → breath  (highest; everything else needs daemon)
 *   2. cache hit  → reflex  (instant return; cheapest path)
 *   3. idle_tick or idleMs > threshold → dream (background work)
 *   4. fallback → cortex (synchronous tool call)
 */
export function classifyEvent(input: {
  event: ThalamusEvent;
  context: RouteContext;
  secret?: string;
}): RouteDecision {
  const dreamThreshold = input.context.dreamIdleThresholdMs ?? 30 * 60 * 1000;
  let tier: ThalamusTier;
  let reason: string;
  if (!input.context.daemonAlive) {
    tier = "breath";
    reason = "daemon_dead: route to breath for respawn before anything else";
  } else if (input.context.hasReflexCacheHit) {
    tier = "reflex";
    reason = "cache_hit: short-circuit to reflex for instant return";
  } else if (input.event.kind === "idle_tick" || input.context.idleMs > dreamThreshold) {
    tier = "dream";
    reason = `idle_${input.context.idleMs}ms > ${dreamThreshold}ms threshold: route to dream consolidation`;
  } else {
    tier = "cortex";
    reason = "no_cache_or_idle: synchronous cortex path";
  }
  const body = { v: PROTOCOL_VERSION, tier, reason, eventKind: input.event.kind, ts: input.event.ts };
  const sig = hmacHex(body, input.secret ?? defaultSecret());
  return { v: PROTOCOL_VERSION, tier, reason, sig };
}

/**
 * Dispatch event to the chosen tier's handler. Returns the handler's
 * Promise unchanged. Pure orchestration; caller owns the handlers.
 */
export async function routeEvent<T>(input: {
  event: ThalamusEvent;
  context: RouteContext;
  handlers: TierHandlers<T>;
  secret?: string;
}): Promise<{ decision: RouteDecision; result: T }> {
  const decision = classifyEvent({ event: input.event, context: input.context, secret: input.secret });
  const handler = input.handlers[decision.tier];
  const result = await handler(input.event);
  return { decision, result };
}

export function formatRoute(d: RouteDecision): string {
  const tag = d.tier === "reflex" ? "⚡" : d.tier === "cortex" ? "🧠" : d.tier === "dream" ? "💤" : "🫁";
  return `${tag} THALAMUS · tier=${d.tier} · ${d.reason}`;
}
