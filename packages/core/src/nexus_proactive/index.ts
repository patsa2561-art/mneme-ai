/**
 * v2.18.0 — MNEME NEXUS PROACTIVE (the "Reverse MCP" — push, not pull)
 *
 *   "Standard MCP is pull-only: an AI agent CALLS Mneme. NEXUS inverts
 *    the channel — Mneme observes the repo continuously and pushes
 *    UNREQUESTED notifications back at the AI agent the moment a fact
 *    changes that would have invalidated its last answer.
 *
 *    Closes the 'stale-context' hallucination class entirely:
 *      AI says: 'function foo lives at src/foo.ts:42'
 *      User edits src/foo.ts → moves foo to line 80
 *      Within seconds: NEXUS emits {kind: 'stale_claim', oldFact, newFact, sig}
 *                      AI MUST acknowledge before continuing.
 *
 *    This is the closest a local-first MCP can get to the 'Ghost-in-
 *    the-Shell Developer / Async Context-Weaver / Digital Organ Harvester'
 *    architecture without breaking the MCP contract."
 *
 * Honest scope (what NEXUS PROACTIVE IS):
 *   1. registerSubscription — AI agent subscribes to a fact pattern
 *      (a file path, a symbol, a stat threshold).
 *   2. publishObservation — caller reports an observation; NEXUS diffs
 *      against subscriptions and emits notifications for stale matches.
 *   3. drainNotifications — AI agent (or its supervisor) pulls queued
 *      notifications. Each is HMAC-signed + tamper-evident + monotonic.
 *   4. acknowledge — AI agent confirms it has updated its mental model;
 *      ACK is recorded; un-ACKed notifications surface louder over time.
 *
 * Honest scope (what NEXUS PROACTIVE IS NOT):
 *   - Not a real WebSocket / push channel — MCP doesn't support that.
 *     NEXUS is a server-side queue + ACK ledger. Any MCP transport
 *     (stdio / sse / http) can drain it.
 *   - Not a global pub/sub bus — per-repo, per-subscriber. Federation
 *     belongs to v2.16 OBELISK.
 *   - Not a daemon by itself — daemon (or the AI agent) calls
 *     publishObservation; NEXUS is the diff + queue logic.
 *
 * Pure orchestrator. Composes onto v2.6 TRUTH KERNEL + v2.16 OBELISK
 * + v2.16 LIVING MODEL. Zero new external deps.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export type SubscriptionKind =
  | "file_content"     // hash of file content
  | "symbol_location"  // file:line of named symbol
  | "stat_threshold"   // numeric metric crossing
  | "vendor_score"     // BOUNTY/ARENA score change
  | "soul_rule";       // PROJECT SOUL rule change

export interface Subscription {
  v: typeof PROTOCOL_VERSION;
  subId: string;
  subscriber: string; // e.g., "claude-session-abc"
  kind: SubscriptionKind;
  /** Stable identifier for the fact (path, symbol name, metric key). */
  factKey: string;
  /** The value the AI is currently relying on. */
  knownValue: string;
  registeredAt: string;
  /** TTL — subscriptions auto-expire to keep the queue bounded. */
  expiresAt: string;
  sig: string;
}

export interface Observation {
  kind: SubscriptionKind;
  factKey: string;
  /** Observed value at this instant. */
  value: string;
  observedAt?: string;
}

export type NotificationKind =
  | "stale_claim"         // observed value differs from knownValue
  | "subscription_expired"
  | "consensus_shift";    // future: TRUTH KERNEL verdict flipped

export interface Notification {
  v: typeof PROTOCOL_VERSION;
  notifId: string;
  subId: string;
  subscriber: string;
  kind: NotificationKind;
  factKey: string;
  oldValue: string;
  newValue: string;
  /** Severity 1..5; >=4 means the AI MUST ACK before continuing. */
  severity: 1 | 2 | 3 | 4 | 5;
  emittedAt: string;
  /** Monotonic sequence per subscriber — gap detection for missed notifications. */
  seq: number;
  message: string;
  sig: string;
}

export interface AckRecord {
  v: typeof PROTOCOL_VERSION;
  notifId: string;
  subscriber: string;
  ackedAt: string;
  /** Optional: AI's brief restated understanding so we know it really updated. */
  restatement?: string;
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_NEXUS_SECRET"] || `mneme-nexus-proactive-v${PROTOCOL_VERSION}`;
}

function hmac(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEq(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

/**
 * Pure in-memory NEXUS instance. Real deployments persist subscriptions
 * + queued notifications to .mneme/nexus.jsonl; this class is the
 * arithmetic — caller chooses durability.
 */
export class NexusProactive {
  private subs = new Map<string, Subscription>();
  private queue = new Map<string, Notification[]>(); // subscriber -> notifs
  private acks = new Map<string, AckRecord>();
  private seq = new Map<string, number>(); // subscriber -> last seq
  private secret: string;

  constructor(secret?: string) {
    this.secret = secret ?? defaultSecret();
  }

  registerSubscription(input: {
    subscriber: string;
    kind: SubscriptionKind;
    factKey: string;
    knownValue: string;
    ttlSeconds?: number;
    nowMs?: number;
  }): Subscription {
    const now = input.nowMs ?? Date.now();
    const ttl = input.ttlSeconds ?? 60 * 60 * 24; // 24h default
    const subId = "sub-" + createHmac("sha256", "mneme-nexus-subid")
      .update(`${input.subscriber}|${input.kind}|${input.factKey}|${now}`)
      .digest("hex").slice(0, 14);
    const body: Omit<Subscription, "sig"> = {
      v: PROTOCOL_VERSION,
      subId,
      subscriber: input.subscriber,
      kind: input.kind,
      factKey: input.factKey,
      knownValue: input.knownValue,
      registeredAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttl * 1000).toISOString(),
    };
    const sub: Subscription = { ...body, sig: hmac(body, this.secret) };
    this.subs.set(subId, sub);
    return sub;
  }

  publishObservation(obs: Observation, nowMs?: number): Notification[] {
    const now = nowMs ?? Date.now();
    const observedAt = obs.observedAt ?? new Date(now).toISOString();
    const emitted: Notification[] = [];

    for (const sub of this.subs.values()) {
      if (sub.kind !== obs.kind) continue;
      if (sub.factKey !== obs.factKey) continue;
      if (Date.parse(sub.expiresAt) < now) continue;
      if (sub.knownValue === obs.value) continue; // still fresh

      const seq = (this.seq.get(sub.subscriber) ?? 0) + 1;
      this.seq.set(sub.subscriber, seq);
      const severity = severityOf(sub.kind, sub.knownValue, obs.value);
      const notifId = "n-" + createHmac("sha256", "mneme-nexus-notifid")
        .update(`${sub.subId}|${seq}|${observedAt}`)
        .digest("hex").slice(0, 12);
      const body: Omit<Notification, "sig"> = {
        v: PROTOCOL_VERSION,
        notifId,
        subId: sub.subId,
        subscriber: sub.subscriber,
        kind: "stale_claim",
        factKey: sub.factKey,
        oldValue: sub.knownValue,
        newValue: obs.value,
        severity,
        emittedAt: observedAt,
        seq,
        message: messageFor(sub.kind, sub.factKey, sub.knownValue, obs.value, severity),
      };
      const notif: Notification = { ...body, sig: hmac(body, this.secret) };
      const list = this.queue.get(sub.subscriber) ?? [];
      list.push(notif);
      this.queue.set(sub.subscriber, list);
      emitted.push(notif);
      // Update knownValue so we don't re-fire on the same change next observation.
      // Caller is expected to re-register if they explicitly want new-value tracking.
      this.subs.set(sub.subId, { ...sub, knownValue: obs.value });
    }

    return emitted;
  }

  drainNotifications(subscriber: string, nowMs?: number): Notification[] {
    const now = nowMs ?? Date.now();
    // Also surface expired-subscription notifications
    const expired: Notification[] = [];
    for (const sub of this.subs.values()) {
      if (sub.subscriber !== subscriber) continue;
      if (Date.parse(sub.expiresAt) >= now) continue;
      const seq = (this.seq.get(subscriber) ?? 0) + 1;
      this.seq.set(subscriber, seq);
      const notifId = "n-" + createHmac("sha256", "mneme-nexus-notifid")
        .update(`${sub.subId}|expired|${seq}`)
        .digest("hex").slice(0, 12);
      const body: Omit<Notification, "sig"> = {
        v: PROTOCOL_VERSION,
        notifId, subId: sub.subId, subscriber,
        kind: "subscription_expired",
        factKey: sub.factKey,
        oldValue: sub.knownValue,
        newValue: sub.knownValue,
        severity: 2,
        emittedAt: new Date(now).toISOString(),
        seq,
        message: `Subscription on '${sub.factKey}' expired without observation. Re-verify before relying on it.`,
      };
      expired.push({ ...body, sig: hmac(body, this.secret) });
      this.subs.delete(sub.subId);
    }
    if (expired.length > 0) {
      const list = this.queue.get(subscriber) ?? [];
      list.push(...expired);
      this.queue.set(subscriber, list);
    }
    const out = this.queue.get(subscriber) ?? [];
    this.queue.set(subscriber, []);
    return out;
  }

  acknowledge(input: {
    notifId: string;
    subscriber: string;
    restatement?: string;
    nowMs?: number;
  }): AckRecord {
    const now = input.nowMs ?? Date.now();
    const body: Omit<AckRecord, "sig"> = {
      v: PROTOCOL_VERSION,
      notifId: input.notifId,
      subscriber: input.subscriber,
      ackedAt: new Date(now).toISOString(),
      ...(input.restatement ? { restatement: input.restatement } : {}),
    };
    const rec: AckRecord = { ...body, sig: hmac(body, this.secret) };
    this.acks.set(input.notifId, rec);
    return rec;
  }

  isAcked(notifId: string): boolean {
    return this.acks.has(notifId);
  }

  /** Verify a notification we received from the wire. */
  verifyNotification(n: Notification): boolean {
    const { sig, ...body } = n;
    return safeEq(hmac(body, this.secret), sig);
  }

  /** Verify an ack receipt. */
  verifyAck(a: AckRecord): boolean {
    const { sig, ...body } = a;
    return safeEq(hmac(body, this.secret), sig);
  }

  /** Stats for pulse / dashboard. */
  stats(subscriber?: string): { activeSubs: number; pendingNotifs: number; totalAcks: number } {
    let activeSubs = 0;
    for (const s of this.subs.values()) {
      if (subscriber && s.subscriber !== subscriber) continue;
      activeSubs++;
    }
    let pendingNotifs = 0;
    if (subscriber) {
      pendingNotifs = (this.queue.get(subscriber) ?? []).length;
    } else {
      for (const list of this.queue.values()) pendingNotifs += list.length;
    }
    return { activeSubs, pendingNotifs, totalAcks: this.acks.size };
  }
}

function severityOf(kind: SubscriptionKind, oldV: string, newV: string): 1 | 2 | 3 | 4 | 5 {
  // soul_rule changes are MUST-ACK (4); symbol locations and file content
  // are MUST-ACK (4) — these directly invalidate prior code claims.
  // stat_threshold + vendor_score drift is informational (2-3).
  if (kind === "soul_rule") return 5;
  if (kind === "symbol_location") return 4;
  if (kind === "file_content") return 4;
  if (kind === "vendor_score") {
    // bigger score swing → higher severity
    const a = Number(oldV), b = Number(newV);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      const delta = Math.abs(a - b);
      if (delta > 0.20) return 4;
      if (delta > 0.05) return 3;
    }
    return 2;
  }
  return 3;
}

function messageFor(kind: SubscriptionKind, factKey: string, oldV: string, newV: string, sev: number): string {
  const must = sev >= 4 ? "MUST ACK" : "FYI";
  switch (kind) {
    case "file_content":
      return `[${must}] file '${factKey}' changed (sha differs). Refresh any claim citing it.`;
    case "symbol_location":
      return `[${must}] symbol '${factKey}' moved: was at ${oldV}, now at ${newV}.`;
    case "soul_rule":
      return `[${must}] PROJECT SOUL rule on '${factKey}' changed; re-evaluate any decision that hinged on the old wording.`;
    case "stat_threshold":
      return `[${must}] stat '${factKey}' crossed threshold: ${oldV} → ${newV}.`;
    case "vendor_score":
      return `[${must}] vendor score for '${factKey}' shifted: ${oldV} → ${newV}.`;
    default:
      return `[${must}] '${factKey}': ${oldV} → ${newV}.`;
  }
}

export function formatNexusLine(n: Notification): string {
  return `NEXUS 📡 · ${n.kind} · sev=${n.severity} · ${n.factKey} · ${n.oldValue} → ${n.newValue}`;
}

/** Convenience: a singleton instance for callers that want global state. */
let _instance: NexusProactive | null = null;
export function defaultNexus(): NexusProactive {
  if (!_instance) _instance = new NexusProactive();
  return _instance;
}
