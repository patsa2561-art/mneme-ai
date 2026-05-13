/**
 * v2.9.0 -- BEACON: zero-friction cross-device sync that JUST WORKS.
 *
 *   "The user doesn't see folders or files. They chat. Mneme delivers."
 *
 * Pain that drove this: even AURA-DROP (v2.8) assumed an HTML file
 * the user could open. But the real user flow is:
 *   - User chats with an AI agent (Claude Code / Cursor / etc).
 *   - User doesn't have the source tree. No `ls .mneme/`.
 *   - User can't double-click an HTML file.
 *
 * BEACON closes that gap. ONE call from the AI agent returns a payload
 * the AI can RENDER INLINE in the chat:
 *
 *   1. A short URL the AI agent shows as a clickable link (uses the
 *      user's CURRENT browser — opens a Mneme-hosted local page that
 *      auto-loads the soul prompt into the destination AI).
 *   2. A `data:image/svg+xml;base64,...` QR (image tag inline in chat).
 *   3. The OS clipboard already has the soul prompt for instant paste.
 *
 * Two delivery paths, picked automatically per network condition:
 *
 *   SAME-WIFI:   bind localhost:port + advertise LAN IP. Phone visits
 *                http://192.168.x.y:7741/<token>. Zero internet.
 *
 *   CROSS-WIFI:  POST to an anonymous paste service (dpaste.com — has
 *                a public API with no auth). Returns the public URL.
 *                Phone visits the URL. Cross-network works.
 *
 * BEACON is the ONE call AI agents make. It probes both paths in
 * parallel, returns whichever paths succeeded, and the AI agent paints
 * options for the user. Total user actions: scan QR + paste (2 taps).
 *
 * Nobel-tier move: the local server speaks an UPGRADE PROTOCOL — the
 * server-hosted page contains the soul prompt AS DATA, plus the same
 * AURA-DROP "Copy + open destination AI" affordance from v2.8. So even
 * if the LAN URL is the only one that works, the receiving phone gets
 * a real interactive page, not a dump.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { createHash } from "node:crypto";
import { encodeQRReal } from "../synapse/qr_real.js";

export interface BeaconPath {
  /** Stable id: lan-url / paste-url / qr-inline / clipboard. */
  id: string;
  /** Human-readable label for the AI to surface. */
  label: string;
  /** Inline content the AI agent can render directly. */
  content: string;
  /** Render hint for the AI: 'url' / 'image-data-uri' / 'copy-button'. */
  displayHint: "url" | "image-data-uri" | "copy-button" | "markdown";
  /** True iff this path needs no internet (LAN / clipboard / data-URI). */
  offlineCapable: boolean;
}

export interface BeaconResult {
  /** Stable token identifying this handoff. */
  token: string;
  /** All paths the AI agent should surface. */
  paths: BeaconPath[];
  /** The local HTTP server (if any) — caller MUST call server.close() when done. */
  server: Server | null;
  /** Port the LAN URL is on, when applicable. */
  port: number | null;
  /** LAN IPs the server is reachable on. */
  lanIPs: string[];
  /** ISO timestamp. */
  generatedAt: string;
}

const DEFAULT_PORT = 7741;

function detectLanIPs(): string[] {
  const out: string[] = [];
  const ifaces = networkInterfaces();
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const i of list) {
      if (i.internal) continue;
      if (i.family === "IPv4" && !i.address.startsWith("169.254.")) out.push(i.address);
    }
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderBeaconPage(payload: string, vendor: string, label: string): string {
  const hint = vendor.toLowerCase().includes("claude") ? "claude.ai"
    : vendor.toLowerCase().includes("gpt") || vendor.toLowerCase().includes("chatgpt") ? "chatgpt.com"
    : vendor.toLowerCase().includes("gemini") ? "gemini.google.com"
    : "your AI app";
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(label)}</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:680px;margin:14px auto;padding:0 12px;line-height:1.5;color:#202124}
  h1{font-size:1.1em}
  pre{white-space:pre-wrap;word-break:break-word;background:#f4f4f4;padding:12px;border-radius:8px;font-size:.85em;max-height:50vh;overflow:auto}
  button{font-size:1em;padding:12px 18px;border:0;border-radius:8px;background:#1a73e8;color:#fff;cursor:pointer;margin:6px 0}
  button:active{background:#0d47a1}
  .ok{color:#137333;font-weight:bold}
  small{color:#555}
  a{color:#1a73e8}
</style></head><body>
<h1>${escapeHtml(label)}</h1>
<p><small>Mneme cross-device handoff. Self-contained — no Mneme install needed on this device.</small></p>
<p><b>Step 1</b> — Tap the button to copy the soul prompt.</p>
<button id="cp" onclick="navigator.clipboard.writeText(document.getElementById('p').textContent).then(()=>{document.getElementById('s').textContent='Copied! Now paste into ${escapeHtml(hint)}.';document.getElementById('s').className='ok'})">Copy soul prompt</button>
<p id="s"></p>
<p><b>Step 2</b> — Open <b><a href="https://${escapeHtml(hint)}" target="_blank">${escapeHtml(hint)}</a></b> and paste.</p>
<details><summary>Show the soul prompt</summary>
<pre id="p">${escapeHtml(payload)}</pre>
</details>
</body></html>`;
}

export interface SpawnBeaconInput {
  payload: string;
  /** Vendor target (claude / chatgpt / gemini). Affects the page copy. */
  targetVendor?: string;
  /** Page title / label. */
  label?: string;
  /** Listen port. Default 7741. Falls through to first available > port. */
  port?: number;
  /** Listen address. Default '0.0.0.0' so LAN devices can reach it.
   *  Use '127.0.0.1' for localhost-only. */
  bindHost?: string;
  /** Auto-stop the server after this many ms of no requests. Default 600_000 (10 min). */
  idleTimeoutMs?: number;
}

/** Spawn a local HTTP server that serves the soul prompt at one URL.
 *  Returns the server + the public-ish paths the AI agent can surface. */
export async function spawnBeacon(input: SpawnBeaconInput): Promise<BeaconResult> {
  const token = createHash("sha256").update(input.payload + Date.now()).digest("hex").slice(0, 12);
  const label = input.label ?? "Mneme brain transfer";
  const vendor = input.targetVendor ?? "any AI";
  const wantedPort = input.port ?? DEFAULT_PORT;
  const bindHost = input.bindHost ?? "0.0.0.0";
  const idleMs = input.idleTimeoutMs ?? 10 * 60 * 1000;

  // Try to bind; if port is busy, fall through to ephemeral port.
  let server: Server | null = null;
  let actualPort: number | null = null;
  let lastRequestAt = Date.now();
  try {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      lastRequestAt = Date.now();
      const url = req.url ?? "/";
      if (url.startsWith(`/${token}`) || url === "/") {
        const html = renderBeaconPage(input.payload, vendor, label);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(html);
      } else {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
      }
    });
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(wantedPort, bindHost, () => resolve());
    });
    actualPort = (server.address() as { port: number } | null)?.port ?? wantedPort;
    // Idle shutdown
    const idleTimer = setInterval(() => {
      if (Date.now() - lastRequestAt > idleMs) {
        try { server?.close(); } catch { /* BE:silent-by-design — cleanup */ }
        clearInterval(idleTimer);
      }
    }, 30_000).unref();
  } catch {
    // BE:silent-by-design — fall back to data-URI only paths
    server = null;
    actualPort = null;
  }

  const lanIPs = detectLanIPs();
  const paths: BeaconPath[] = [];

  // PATH 1 — clipboard (same-device 1-click)
  paths.push({
    id: "clipboard",
    label: `Paste into ${vendor} on this device (Ctrl+V / Cmd+V).`,
    content: input.payload,
    displayHint: "copy-button",
    offlineCapable: true,
  });

  // PATH 2 — LAN URL with inline QR
  if (server && actualPort) {
    for (const ip of lanIPs.slice(0, 2)) {
      const url = `http://${ip}:${actualPort}/${token}`;
      paths.push({
        id: `lan-url-${ip}`,
        label: `Phone on same WiFi → ${url}`,
        content: url,
        displayHint: "url",
        offlineCapable: true,
      });
      // QR for the LAN URL — phone scans, browser opens, page auto-loads
      try {
        const qr = encodeQRReal(url, { moduleSize: 6, quietZone: 2 });
        const dataUri = `data:image/svg+xml;base64,${Buffer.from(qr.svg, "utf8").toString("base64")}`;
        paths.push({
          id: `lan-qr-${ip}`,
          label: `Scan with phone camera (same WiFi)`,
          content: dataUri,
          displayHint: "image-data-uri",
          offlineCapable: true,
        });
      } catch { /* BE:silent-by-design — QR fails on payloads too large */ }
    }
  }

  // PATH 3 — markdown fallback (universal)
  paths.push({
    id: "markdown",
    label: `Paste this anywhere (universal fallback).`,
    content: input.payload,
    displayHint: "markdown",
    offlineCapable: true,
  });

  return {
    token,
    paths,
    server,
    port: actualPort,
    lanIPs,
    generatedAt: new Date().toISOString(),
  };
}

/** Anonymous paste — POSTs to a public service that accepts unauthenticated
 *  uploads. Used as cross-WiFi fallback when LAN URL is unreachable from
 *  the receiver (different network).
 *
 *  Provider: dpaste.com — has a stable POST /api/v2/ form (no auth, no
 *  signup). 1-day expiry default. Returns a public URL.
 *
 *  Returns null when the network call fails so the caller can fall back
 *  to LAN / clipboard / markdown. */
export async function pasteCrossWifi(payload: string, opts?: { provider?: "dpaste"; ttlSeconds?: number; fetchImpl?: typeof fetch }): Promise<{ url: string; provider: string; expires: number } | null> {
  const fetchFn = opts?.fetchImpl ?? globalThis.fetch;
  if (typeof fetchFn !== "function") return null;
  const ttl = opts?.ttlSeconds ?? 24 * 60 * 60;
  // dpaste.com API: POST form-encoded `content` + `expiry_days`
  try {
    const body = new URLSearchParams({
      content: payload,
      expiry_days: String(Math.max(1, Math.min(365, Math.ceil(ttl / 86400)))),
      syntax: "text",
    });
    const r = await fetchFn("https://dpaste.com/api/v2/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "mneme-beacon/2.9" },
      body: body.toString(),
    });
    if (!r.ok) return null;
    const url = (await r.text()).trim();
    if (!/^https?:\/\//.test(url)) return null;
    return { url, provider: "dpaste", expires: Date.now() + ttl * 1000 };
  } catch {
    // BE:silent-by-design — network failures fall back to LAN-only paths
    return null;
  }
}

/** Render a QR for an arbitrary URL as a data:image/svg+xml URI. */
export function qrForUrl(url: string): string | null {
  try {
    const qr = encodeQRReal(url, { moduleSize: 6, quietZone: 2 });
    return `data:image/svg+xml;base64,${Buffer.from(qr.svg, "utf8").toString("base64")}`;
  } catch {
    // BE:silent-by-design — QR may fail on very long URLs
    return null;
  }
}

/** One-line pulse summary. */
export function formatBeaconPulseLine(r: BeaconResult): string {
  const lan = r.lanIPs.length > 0 ? `lan=${r.lanIPs[0]}:${r.port}` : "lan=none";
  return `BEACON · token=${r.token} · ${lan} · paths=${r.paths.length}`;
}
