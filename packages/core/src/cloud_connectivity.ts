/**
 * MNEME CLOUD CONNECTIVITY (v1.42.4) — smart connection layer.
 *
 * Mneme is local-first by design — every feature works without any
 * network call. But a small set of features OPT-IN to cloud assistance
 * (federated PRECOG / vaccine CDN / compliance scoreboard upload). For
 * those, we need to:
 *
 *   1. Know if the cloud is REACHABLE without spamming probes.
 *   2. Decide when it's worth the round trip vs serving local results.
 *   3. Never let a network failure block the local-first path.
 *   4. Queue events that fail to upload + drain them when the cloud
 *      comes back, so no data is lost in transient outages.
 *
 * Design principles (anti-patterns we explicitly avoid):
 *   - NO background polling that keeps a long-lived TCP connection.
 *     The local CLI is short-lived; idle pings would burn battery and
 *     show up in user's network monitor as suspicious activity.
 *   - NO assumption "online == cloud-up". DNS works, public internet
 *     works, but our specific droplet might be down. Probe `/healthz`
 *     not "google.com".
 *   - NO fail-loud-block. The AI agent never sees connectivity errors;
 *     it sees `{ source: "local-fallback", note: "cloud queued" }`.
 *
 * Storage:
 *   - .mneme/cloud-state.json    last probe + cached state (TTL 60s)
 *   - .mneme/cloud-queue.jsonl   pending uploads (drains on next reachable cloud)
 *
 * Consumer pattern (for future federated PRECOG, vaccine CDN, etc.):
 *
 *   import { CloudConnectivity } from "@mneme-ai/core";
 *   const cloud = new CloudConnectivity({ baseUrl: "https://brain.mneme.dev" });
 *   const result = await cloud.tryRequest(
 *     async () => fetch(cloud.url("/v1/world.search?q=jwt")).then(r => r.json()),
 *     () => ({ source: "local-fallback", results: localSearch("jwt") }),
 *   );
 *
 * Test coverage in cloud_connectivity.test.ts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync, renameSync } from "node:fs";
import { join } from "node:path";

const STATE_FILE = ".mneme/cloud-state.json";
const QUEUE_FILE = ".mneme/cloud-queue.jsonl";
const QUEUE_ROTATION_BYTES = 1024 * 1024;       // 1 MB → rotate
const STATE_TTL_MS = 60 * 1000;                  // 1 minute cache

export type ConnectivityState = "unknown" | "online" | "offline" | "degraded";

export interface CloudState {
  state: ConnectivityState;
  /** ISO timestamp of last probe. */
  lastProbe: string;
  /** Round-trip latency ms (probe), or null on failure. */
  latencyMs: number | null;
  /** Cloud's reported version + build, or null. */
  cloudVersion: string | null;
  /** Free-text reason — surfaced to user via `mneme cloud status`. */
  reason: string;
}

export interface QueuedEvent {
  ts: string;
  /** Idempotency key — server uses this to dedupe on retry. */
  id: string;
  /** Resource path the caller wanted to POST to (e.g. "/v1/compliance"). */
  path: string;
  /** Arbitrary JSON-serialisable body. */
  payload: unknown;
  /** Number of failed sync attempts so far. */
  attempts: number;
}

export interface ConnectivityOptions {
  /** Base URL of the cloud brain. Required for any probe. */
  baseUrl: string;
  /** Repo root for state + queue persistence. Defaults to cwd. */
  repoRoot?: string;
  /** Cache TTL for probe results. Default 60s. */
  ttlMs?: number;
  /** Probe request timeout. Default 4s. */
  probeTimeoutMs?: number;
}

function ensureMnemeDir(repoRoot: string): void {
  const d = join(repoRoot, ".mneme");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

export class CloudConnectivity {
  private opts: Required<ConnectivityOptions>;

  constructor(opts: ConnectivityOptions) {
    this.opts = {
      baseUrl: opts.baseUrl.replace(/\/$/, ""),
      repoRoot: opts.repoRoot ?? process.cwd(),
      ttlMs: opts.ttlMs ?? STATE_TTL_MS,
      probeTimeoutMs: opts.probeTimeoutMs ?? 4_000,
    };
  }

  url(path: string): string {
    return this.opts.baseUrl + (path.startsWith("/") ? path : "/" + path);
  }

  /** Read the cached state. Returns "unknown" if stale or missing. */
  readState(): CloudState {
    const p = join(this.opts.repoRoot, STATE_FILE);
    if (existsSync(p)) {
      try {
        const cached = JSON.parse(readFileSync(p, "utf8")) as CloudState;
        const age = Date.now() - Date.parse(cached.lastProbe);
        if (age < this.opts.ttlMs) return cached;
      } catch { /* corrupt cache — fall through to fresh probe */ }
    }
    return { state: "unknown", lastProbe: new Date(0).toISOString(), latencyMs: null, cloudVersion: null, reason: "no recent probe" };
  }

  private writeState(s: CloudState): void {
    ensureMnemeDir(this.opts.repoRoot);
    try { writeFileSync(join(this.opts.repoRoot, STATE_FILE), JSON.stringify(s, null, 2)); } catch { /* never crash */ }
  }

  /** Run a fresh /healthz probe + update cache. Returns the new state. */
  async probe(): Promise<CloudState> {
    const start = Date.now();
    let state: ConnectivityState = "offline";
    let latencyMs: number | null = null;
    let cloudVersion: string | null = null;
    let reason = "";
    try {
      const res = await fetch(this.url("/v1/healthz"), { signal: AbortSignal.timeout(this.opts.probeTimeoutMs) });
      latencyMs = Date.now() - start;
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as { version?: string } | null;
        cloudVersion = body?.version ?? null;
        state = latencyMs > 1500 ? "degraded" : "online";
        reason = state === "degraded" ? `slow (${latencyMs}ms > 1500ms)` : `healthy (${latencyMs}ms)`;
      } else {
        state = "degraded";
        reason = `cloud returned HTTP ${res.status}`;
      }
    } catch (e) {
      state = "offline";
      reason = `probe failed: ${(e as Error)?.message ?? "unknown"}`;
    }
    const fresh: CloudState = { state, lastProbe: new Date().toISOString(), latencyMs, cloudVersion, reason };
    this.writeState(fresh);
    return fresh;
  }

  /** Cheap connectivity check. Uses cache when fresh; probes only on cache miss. */
  async ensureProbed(): Promise<CloudState> {
    const cached = this.readState();
    if (cached.state !== "unknown") return cached;
    return this.probe();
  }

  /** Try `online()` first; on failure or offline state, fall back to
   *  `local()`. Caller never sees a network error. */
  async tryRequest<T>(online: () => Promise<T>, local: () => T | Promise<T>): Promise<T> {
    const s = await this.ensureProbed();
    if (s.state === "offline") return await local();
    try {
      return await online();
    } catch {
      // Bust the cache so next call probes fresh.
      this.writeState({ ...s, state: "offline", reason: "request failed", lastProbe: new Date().toISOString() });
      return await local();
    }
  }

  /** Queue an event for later upload. Use when the caller MUST persist
   *  but cloud is unreachable (or you want to batch). The daemon's next
   *  caretaker pass calls `drainQueue()`. */
  enqueue(event: Omit<QueuedEvent, "ts" | "attempts">): QueuedEvent {
    ensureMnemeDir(this.opts.repoRoot);
    const path = join(this.opts.repoRoot, QUEUE_FILE);
    // Rotate at 1 MB — JSONL grows unbounded otherwise.
    try {
      if (existsSync(path) && statSync(path).size >= QUEUE_ROTATION_BYTES) {
        renameSync(path, path + ".rotated-" + Date.now());
      }
    } catch { /* best-effort rotation */ }
    const queued: QueuedEvent = { ts: new Date().toISOString(), attempts: 0, ...event };
    try { appendFileSync(path, JSON.stringify(queued) + "\n"); } catch { /* never crash */ }
    return queued;
  }

  /** Read the pending queue (events not yet successfully uploaded). */
  readQueue(): QueuedEvent[] {
    const p = join(this.opts.repoRoot, QUEUE_FILE);
    if (!existsSync(p)) return [];
    try {
      return readFileSync(p, "utf8").split("\n").filter((l) => l.trim().length > 0).map((l) => {
        try { return JSON.parse(l) as QueuedEvent; } catch { return null; }
      }).filter((x): x is QueuedEvent => x !== null);
    } catch { return []; }
  }

  /** Try to drain the queue. Probes first; if cloud offline, returns
   *  early. On per-event failure, increments attempts so next drain
   *  can apply backoff. */
  async drainQueue(opts: { maxBatch?: number } = {}): Promise<{ attempted: number; succeeded: number; remaining: number }> {
    const maxBatch = opts.maxBatch ?? 50;
    const probed = await this.probe();
    if (probed.state === "offline") return { attempted: 0, succeeded: 0, remaining: this.readQueue().length };

    const all = this.readQueue();
    const batch = all.slice(0, maxBatch);
    const remaining = all.slice(maxBatch);
    let succeeded = 0;

    for (const ev of batch) {
      try {
        const res = await fetch(this.url(ev.path), {
          method: "POST",
          headers: { "content-type": "application/json", "x-mneme-event-id": ev.id },
          body: JSON.stringify(ev.payload),
          signal: AbortSignal.timeout(this.opts.probeTimeoutMs),
        });
        if (res.ok) succeeded++;
        else { ev.attempts++; remaining.push(ev); }
      } catch {
        ev.attempts++;
        remaining.push(ev);
      }
    }

    // Rewrite the queue file with whatever survived (failed events
    // included, so they get retried on next drain).
    ensureMnemeDir(this.opts.repoRoot);
    try {
      const path = join(this.opts.repoRoot, QUEUE_FILE);
      writeFileSync(path, remaining.map((e) => JSON.stringify(e)).join("\n") + (remaining.length > 0 ? "\n" : ""));
    } catch { /* never crash */ }

    return { attempted: batch.length, succeeded, remaining: remaining.length };
  }

  /** Human-readable explanation of current state — for `mneme cloud status` */
  explain(state?: CloudState): string {
    const s = state ?? this.readState();
    const ageSec = Math.floor((Date.now() - Date.parse(s.lastProbe)) / 1000);
    const queue = this.readQueue();
    const queueNote = queue.length > 0 ? ` · ${queue.length} event(s) queued for sync` : "";
    return `[${s.state}] ${s.reason}${s.latencyMs != null ? ` (${s.latencyMs}ms)` : ""}${s.cloudVersion ? ` · cloud v${s.cloudVersion}` : ""} · last probe ${ageSec}s ago${queueNote}`;
  }
}
