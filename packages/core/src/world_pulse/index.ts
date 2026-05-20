/**
 * v2.19.84 — WORLD AI PULSE.
 *
 * Local-first global telemetry for Browser Polygraph verdicts.  Every
 * green / yellow / red dot the userscript renders next to an AI sentence
 * becomes an anonymous event appended to `.mneme/pulse.jsonl` — HMAC
 * chained, vendor-agnostic, never carries the sentence text.  The
 * dashboard's "World Pulse" view reads aggregated stats out and renders
 * a rotating globe that pulses live with refute/confirm events.
 *
 * Privacy by design (LOAD-BEARING — do not erode):
 *   - The event payload carries: vendor, color, regionTimezone (IANA
 *     identifier inferred client-side from `Intl.DateTimeFormat`), and
 *     a coarse "topic" hash. NEVER the sentence text. NEVER an IP.
 *     NEVER exact lat/lon — only timezone, from which the globe paints
 *     a rough region label (e.g. "Asia/Bangkok").
 *   - HMAC chain protects integrity but does not deanonymise — the
 *     chain is per-machine and never leaves the user's box unless they
 *     opt in to join a public collector (NOT shipped in v2.19.84; the
 *     opt-in toggle in the UI is honest about its "ROADMAP" state).
 *
 * Composes onto:
 *   - SQUADRON ACGV (truth engine that produced the verdict)
 *   - BROWSER POLYGRAPH (the userscript that fires the event)
 *   - DIASPORA bridge (transport from browser → daemon)
 *   - APOSTILLE-family HMAC chain primitive
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";

const PULSE_FILE = "pulse.jsonl";
const PULSE_KEY_FILE = "pulse.key";

/** v2.19.84 — Wire-format event. Tiny on purpose; this travels over the
 *  HTTP bridge from the browser AND aggregates into globe blips. */
export interface PulseEvent {
  /** Unix ms timestamp the userscript stamped at decoration time. */
  ts: number;
  /** Hosted AI surface that produced the sentence (claude-ai / chatgpt /
   *  gemini / copilot / deepseek / qwen / unknown). */
  vendor: string;
  /** Dot colour the polygraph rendered (drives globe blip colour). */
  color: "green" | "yellow" | "red" | "grey";
  /** IANA timezone the browser reported. We never resolve this to
   *  exact lat/lon — the globe paints a label by zone, not by device. */
  regionTimezone?: string;
  /** Coarse 6-byte hex hash of the verified sentence — lets the topic
   *  heatmap cluster identical claims without ever storing the text. */
  topicHash?: string;
  /** HMAC chain hash linking back to the previous event. Set by record. */
  chainHash?: string;
  /** Optional confidence from ACGV (0..1). */
  confidence?: number;
}

function ensurePulseKey(repoRoot: string): string {
  const dir = join(repoRoot, ".mneme");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = join(dir, PULSE_KEY_FILE);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const k = randomBytes(32).toString("base64url");
  writeFileSync(p, k, "utf8");
  return k;
}

function pulsePath(repoRoot: string): string {
  return join(repoRoot, ".mneme", PULSE_FILE);
}

function lastChainHash(repoRoot: string): string {
  const p = pulsePath(repoRoot);
  if (!existsSync(p)) return "GENESIS";
  // Last line; fast tail scan instead of full parse.
  const txt = readFileSync(p, "utf8");
  if (!txt) return "GENESIS";
  const lines = txt.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]!) as PulseEvent;
      if (obj.chainHash) return obj.chainHash;
    } catch { /* skip malformed line */ }
  }
  return "GENESIS";
}

/** Append a pulse event to the chain. Returns the recorded event with
 *  HMAC chain hash filled in. Defensive: bad input → returns the
 *  recorded shape with safe defaults rather than throwing (the userscript
 *  fires this from a fire-and-forget POST and a 500 would surface as a
 *  failed dot animation). */
export function recordPulseEvent(repoRoot: string, raw: Partial<PulseEvent>): PulseEvent {
  const event: PulseEvent = {
    ts: typeof raw.ts === "number" ? raw.ts : Date.now(),
    vendor: typeof raw.vendor === "string" ? raw.vendor.slice(0, 32) : "unknown",
    color: (["green", "yellow", "red", "grey"] as const).includes(raw.color as any)
      ? raw.color as PulseEvent["color"]
      : "grey",
    regionTimezone: typeof raw.regionTimezone === "string" ? raw.regionTimezone.slice(0, 64) : undefined,
    topicHash: typeof raw.topicHash === "string" ? raw.topicHash.slice(0, 24) : undefined,
    confidence: typeof raw.confidence === "number" ? Math.max(0, Math.min(1, raw.confidence)) : undefined,
  };
  const key = ensurePulseKey(repoRoot);
  const prev = lastChainHash(repoRoot);
  const payload = `${prev}|${event.ts}|${event.vendor}|${event.color}|${event.regionTimezone ?? ""}|${event.topicHash ?? ""}`;
  event.chainHash = createHmac("sha256", key).update(payload).digest("base64url").slice(0, 22);
  try {
    appendFileSync(pulsePath(repoRoot), JSON.stringify(event) + "\n", "utf8");
  } catch { /* fs write failed — return the event anyway so caller knows what would have been written */ }
  return event;
}

/** Read events back. Cheapest fast path: streams the JSONL line by line,
 *  no full-text parse needed if caller wants a tail. */
export function readPulseEvents(repoRoot: string, opts: { sinceTs?: number; limit?: number } = {}): PulseEvent[] {
  const p = pulsePath(repoRoot);
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").trim().split("\n").filter(Boolean);
  const out: PulseEvent[] = [];
  for (const line of lines) {
    try {
      const e = JSON.parse(line) as PulseEvent;
      if (opts.sinceTs && e.ts < opts.sinceTs) continue;
      out.push(e);
    } catch { /* skip malformed */ }
  }
  // Newest first; apply limit on the suffix so callers asking for "last
  // N" get the freshest events.
  out.sort((a, b) => b.ts - a.ts);
  return typeof opts.limit === "number" ? out.slice(0, opts.limit) : out;
}

/** Aggregate stats for the dashboard view. Cheap O(n) scan. */
export interface PulseAggregate {
  total: number;
  byColor: Record<"green" | "yellow" | "red" | "grey", number>;
  byVendor: Record<string, { total: number; green: number; yellow: number; red: number; grey: number }>;
  byHour: Array<{ hour: string; count: number }>;
  byRegion: Record<string, number>;
  topTopics: Array<{ hash: string; count: number }>;
  freshestTs: number | null;
  windowHours: number;
}

export function aggregatePulse(events: PulseEvent[], opts: { windowHours?: number } = {}): PulseAggregate {
  const windowHours = opts.windowHours ?? 24;
  const cutoff = Date.now() - windowHours * 3600_000;
  const inWindow = events.filter((e) => e.ts >= cutoff);
  const agg: PulseAggregate = {
    total: inWindow.length,
    byColor: { green: 0, yellow: 0, red: 0, grey: 0 },
    byVendor: {},
    byHour: [],
    byRegion: {},
    topTopics: [],
    freshestTs: inWindow.length > 0 ? Math.max(...inWindow.map((e) => e.ts)) : null,
    windowHours,
  };
  const hourBuckets = new Map<string, number>();
  const topicBuckets = new Map<string, number>();
  for (const e of inWindow) {
    agg.byColor[e.color] = (agg.byColor[e.color] ?? 0) + 1;
    if (!agg.byVendor[e.vendor]) agg.byVendor[e.vendor] = { total: 0, green: 0, yellow: 0, red: 0, grey: 0 };
    agg.byVendor[e.vendor]!.total += 1;
    agg.byVendor[e.vendor]![e.color] += 1;
    if (e.regionTimezone) agg.byRegion[e.regionTimezone] = (agg.byRegion[e.regionTimezone] ?? 0) + 1;
    const hourKey = new Date(e.ts).toISOString().slice(0, 13) + ":00";
    hourBuckets.set(hourKey, (hourBuckets.get(hourKey) ?? 0) + 1);
    if (e.topicHash) topicBuckets.set(e.topicHash, (topicBuckets.get(e.topicHash) ?? 0) + 1);
  }
  agg.byHour = [...hourBuckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([hour, count]) => ({ hour, count }));
  agg.topTopics = [...topicBuckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([hash, count]) => ({ hash, count }));
  return agg;
}

/** Verify the HMAC chain integrity end-to-end. Returns the index of the
 *  first broken event, or -1 if the chain is intact. Replays in FILE
 *  order (the order in which `recordPulseEvent` appended) — not ts
 *  order. The chain links event-N to event-(N-1) in write order; using
 *  ts order would false-fail on synthetic streams + clock-skew. */
export function verifyPulseChain(repoRoot: string): { intact: boolean; firstBrokenIndex: number; checked: number } {
  const p = pulsePath(repoRoot);
  if (!existsSync(p)) return { intact: true, firstBrokenIndex: -1, checked: 0 };
  const lines = readFileSync(p, "utf8").trim().split("\n").filter(Boolean);
  const key = ensurePulseKey(repoRoot);
  let prev = "GENESIS";
  for (let i = 0; i < lines.length; i++) {
    let e: PulseEvent;
    try { e = JSON.parse(lines[i]!) as PulseEvent; }
    catch { return { intact: false, firstBrokenIndex: i, checked: i + 1 }; }
    const payload = `${prev}|${e.ts}|${e.vendor}|${e.color}|${e.regionTimezone ?? ""}|${e.topicHash ?? ""}`;
    const expected = createHmac("sha256", key).update(payload).digest("base64url").slice(0, 22);
    if (e.chainHash !== expected) return { intact: false, firstBrokenIndex: i, checked: i + 1 };
    prev = e.chainHash!;
  }
  return { intact: true, firstBrokenIndex: -1, checked: lines.length };
}

// ─── SYNTHETIC EVENT STREAM ─────────────────────────────────────────
// Used by the dashboard's empty state + the live demo button. The
// distribution matches realistic-looking polygraph traffic: 60% green,
// 25% yellow, 12% red, 3% grey across the 6 major AI surfaces. Regions
// weighted by realistic AI usage geography (NA + EU + Asia heavy).

const VENDORS = ["claude-ai", "chatgpt", "gemini", "copilot", "deepseek", "qwen"] as const;
const COLOR_WEIGHTS: Array<{ color: PulseEvent["color"]; w: number }> = [
  { color: "green", w: 60 }, { color: "yellow", w: 25 }, { color: "red", w: 12 }, { color: "grey", w: 3 },
];
// IANA timezones with rough population/AI-usage weights. The globe
// view paints blips at each zone's approximate centroid.
const TIMEZONES: Array<{ zone: string; w: number }> = [
  { zone: "America/Los_Angeles", w: 12 }, { zone: "America/New_York", w: 18 },
  { zone: "America/Chicago", w: 6 }, { zone: "America/Sao_Paulo", w: 4 },
  { zone: "Europe/London", w: 8 }, { zone: "Europe/Berlin", w: 7 },
  { zone: "Europe/Paris", w: 4 }, { zone: "Europe/Madrid", w: 3 },
  { zone: "Europe/Moscow", w: 5 }, { zone: "Africa/Lagos", w: 4 },
  { zone: "Africa/Johannesburg", w: 2 }, { zone: "Asia/Bangkok", w: 5 },
  { zone: "Asia/Singapore", w: 4 }, { zone: "Asia/Tokyo", w: 9 },
  { zone: "Asia/Shanghai", w: 14 }, { zone: "Asia/Kolkata", w: 12 },
  { zone: "Asia/Dubai", w: 3 }, { zone: "Australia/Sydney", w: 4 },
];

function weightedPick<T>(items: Array<{ w: number } & T>, rng: () => number): T {
  const total = items.reduce((s, it) => s + it.w, 0);
  let r = rng() * total;
  for (const it of items) {
    r -= it.w;
    if (r <= 0) return it;
  }
  return items[items.length - 1]!;
}

/** Generate a synthetic event stream for the dashboard demo + empty state.
 *  Deterministic when `seed` is provided so the visual stays stable
 *  between dashboard reloads in test/demo mode. */
export function synthesizePulseEvents(opts: { count?: number; spanMinutes?: number; seed?: number } = {}): PulseEvent[] {
  const count = opts.count ?? 240;
  const span = (opts.spanMinutes ?? 60) * 60_000;
  // Mulberry32 PRNG — fast, small, seedable.
  let state = (opts.seed ?? 42) >>> 0;
  const rng = (): number => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const now = Date.now();
  const out: PulseEvent[] = [];
  for (let i = 0; i < count; i++) {
    const ts = now - Math.floor(rng() * span);
    const vendor = VENDORS[Math.floor(rng() * VENDORS.length)]!;
    const color = weightedPick(COLOR_WEIGHTS, rng).color;
    const zone = weightedPick(TIMEZONES, rng).zone;
    // Synthetic topic hash — 6 hex chars, ~16 unique-ish topics for clustering.
    const topicHash = (Math.floor(rng() * 16)).toString(16).padStart(6, "0");
    out.push({ ts, vendor, color, regionTimezone: zone, topicHash, confidence: rng() });
  }
  return out.sort((a, b) => b.ts - a.ts);
}
