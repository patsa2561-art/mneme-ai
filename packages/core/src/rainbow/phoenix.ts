/**
 * v1.92.0 -- RAINBOW: PHOENIX (tunnel watchdog + URL push).
 *
 * Quick tunnels (`cloudflared tunnel --url http://localhost:PORT`) die.
 * They die when the process exits, when idle ~30 min, or randomly when
 * the Cloudflare edge garbage-collects them. The user scans a QR five
 * minutes later and gets HTTP 404.
 *
 * PHOENIX:
 *   1. Periodically probes the tunnel URL with HEAD / GET.
 *   2. If the probe fails N consecutive times -> respawn cloudflared.
 *   3. Calls every onUrlChange listener with the new URL.
 *   4. Exposes a /events SSE endpoint so the served PC + mobile pages
 *      can subscribe and re-render their QR LIVE when the URL changes
 *      -- without the user reopening the page.
 *
 * The page on the phone never has to be reloaded. The wizard never has
 * to confess "the URL died."
 */

import { setTimeout as nodeSetTimeout, clearTimeout as nodeClearTimeout } from "node:timers";

export interface TunnelProbeResult {
  url: string;
  ok: boolean;
  status: number | null;
  elapsedMs: number;
  /** Reason for failure (network, http status, etc). */
  reason?: string;
}

export interface PhoenixOptions {
  /** Initial tunnel URL (already-spawned tunnel from startQuickTunnel). */
  initialUrl: string;
  /** Probe interval in ms. Default 30_000. */
  probeIntervalMs?: number;
  /** Consecutive failures before respawn. Default 2. */
  failuresBeforeRespawn?: number;
  /** Function to probe the URL. Default: fetch HEAD. */
  probeFn?: (url: string) => Promise<TunnelProbeResult>;
  /** Function that respawns the tunnel + returns the new URL. */
  respawnFn: () => Promise<string | null>;
  /** Optional logger. */
  log?: (msg: string) => void;
}

export interface PhoenixHandle {
  getUrl(): string;
  /** Subscribe to URL changes. Returns an unsubscribe function. */
  onUrlChange(cb: (newUrl: string, oldUrl: string) => void): () => void;
  /** History of every probe + respawn (newest last). */
  getHistory(): Array<{ when: number; kind: "probe" | "respawn"; ok: boolean; url: string; note?: string }>;
  /** Stop the watchdog. Tunnel itself is NOT killed -- caller owns it. */
  stop(): void;
}

const HISTORY_MAX = 50;

/** Default probe: HEAD request with 8s timeout. A 5xx still counts as
 *  "tunnel alive" because the LAN server is reachable through it.
 *  A 4xx from cloudflared edge (specifically 530/521/404) means the
 *  tunnel itself is dead. */
async function defaultProbe(url: string): Promise<TunnelProbeResult> {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = nodeSetTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(url, { method: "HEAD", signal: controller.signal });
    nodeClearTimeout(timer);
    const elapsedMs = Date.now() - t0;
    const isDead = r.status === 404 || r.status === 530 || r.status === 521 || r.status === 502;
    return {
      url,
      ok: !isDead,
      status: r.status,
      elapsedMs,
      reason: isDead ? `tunnel edge returned ${r.status}` : undefined,
    };
  } catch (e) {
    nodeClearTimeout(timer);
    return { url, ok: false, status: null, elapsedMs: Date.now() - t0, reason: (e as Error).message };
  }
}

export function createPhoenix(opts: PhoenixOptions): PhoenixHandle {
  let url = opts.initialUrl;
  const probeIntervalMs = opts.probeIntervalMs ?? 30_000;
  const failuresBeforeRespawn = opts.failuresBeforeRespawn ?? 2;
  const probe = opts.probeFn ?? defaultProbe;
  const log = opts.log ?? (() => undefined);
  const listeners: Array<(n: string, o: string) => void> = [];
  const history: PhoenixHandle["getHistory"] extends () => infer R ? R : never = [];
  let consecutiveFailures = 0;
  let stopped = false;
  let timer: ReturnType<typeof nodeSetTimeout> | null = null;

  function record(entry: { when: number; kind: "probe" | "respawn"; ok: boolean; url: string; note?: string }) {
    history.push(entry);
    if (history.length > HISTORY_MAX) history.shift();
  }

  async function tick() {
    if (stopped) return;
    try {
      const r = await probe(url);
      record({ when: Date.now(), kind: "probe", ok: r.ok, url, note: r.reason });
      log(`probe ${url} ok=${r.ok} status=${r.status} elapsed=${r.elapsedMs}ms`);
      if (r.ok) {
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
        if (consecutiveFailures >= failuresBeforeRespawn) {
          consecutiveFailures = 0;
          log(`tunnel dead (${r.reason ?? "unknown"}) -- respawning`);
          const newUrl = await opts.respawnFn();
          if (newUrl && newUrl !== url) {
            const oldUrl = url;
            url = newUrl;
            record({ when: Date.now(), kind: "respawn", ok: true, url: newUrl, note: `replaced ${oldUrl}` });
            log(`tunnel respawned: ${oldUrl} -> ${newUrl}`);
            for (const cb of [...listeners]) {
              try { cb(newUrl, oldUrl); } catch { /* swallow */ }
            }
          } else {
            record({ when: Date.now(), kind: "respawn", ok: false, url, note: "respawnFn returned null" });
            log(`respawn failed -- staying on ${url}`);
          }
        }
      }
    } catch (e) {
      record({ when: Date.now(), kind: "probe", ok: false, url, note: (e as Error).message });
    }
    if (!stopped) timer = nodeSetTimeout(tick, probeIntervalMs);
  }

  // First probe happens after one interval, not immediately, so the
  // initial tunnel has time to settle.
  timer = nodeSetTimeout(tick, probeIntervalMs);

  return {
    getUrl: () => url,
    onUrlChange: (cb) => {
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    getHistory: () => history.slice(),
    stop: () => {
      stopped = true;
      if (timer) { nodeClearTimeout(timer); timer = null; }
    },
  };
}

/** Inline JS for the served page so it can SUBSCRIBE to URL changes via
 *  Server-Sent Events. The page polls /events; when the server emits a
 *  url-change event, the page replaces its QR <img> src + URL text.
 *
 *  Server side: open SSE response, send `event: url-change\ndata: NEW_URL\n\n`
 *  each time PHOENIX fires onUrlChange. */
export function renderPhoenixSubscriberScript(input: { eventsUrl: string; qrImgId: string; urlTextId: string }): string {
  const eventsUrl = JSON.stringify(input.eventsUrl);
  const qrId = JSON.stringify(input.qrImgId);
  const urlId = JSON.stringify(input.urlTextId);
  return `(function(){
  if (typeof EventSource === "undefined") return;
  var es = new EventSource(${eventsUrl});
  es.addEventListener("url-change", function(ev) {
    var newUrl = ev.data;
    var img = document.getElementById(${qrId});
    if (img) img.src = "https://api.qrserver.com/v1/create-qr-code/?size=360x360&format=svg&margin=10&data=" + encodeURIComponent(newUrl);
    var txt = document.getElementById(${urlId});
    if (txt) txt.textContent = newUrl;
  });
  es.addEventListener("error", function() { /* auto-reconnects */ });
})();`;
}

/** Format the SSE wire payload for a single url-change event. Server
 *  writes this byte sequence to the response body. */
export function formatUrlChangeSseFrame(newUrl: string): string {
  // Strip newlines from URL just in case (URL spec doesn't allow them
  // but be defensive).
  const safe = String(newUrl).replace(/\r?\n/g, "");
  return `event: url-change\ndata: ${safe}\n\n`;
}
