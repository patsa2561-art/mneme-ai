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
import { renderBeaconHtmlPage } from "./_page_template.js";

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

function vendorMeta(vendor: string): { name: string; url: string; deeplink: string | null } {
  const v = vendor.toLowerCase();
  if (v.includes("claude") || v.includes("anthropic")) return { name: "Claude", url: "https://claude.ai/new", deeplink: null };
  if (v.includes("gpt") || v.includes("chatgpt") || v.includes("openai")) return { name: "ChatGPT", url: "https://chatgpt.com/", deeplink: null };
  if (v.includes("gemini") || v.includes("google")) return { name: "Gemini", url: "https://gemini.google.com/app", deeplink: null };
  if (v.includes("perplexity")) return { name: "Perplexity", url: "https://perplexity.ai/", deeplink: null };
  if (v.includes("copilot")) return { name: "Copilot", url: "https://copilot.microsoft.com/", deeplink: null };
  return { name: "your AI app", url: "https://www.google.com/search?q=ai+chat", deeplink: null };
}

function renderBeaconPage(payload: string, vendor: string, label: string): string {
  // v2.9.4: full bilingual TH/EN page lives in _page_template.ts so this
  // file stays focused on the server + path-bundle logic.
  return renderBeaconHtmlPage(payload, vendorMeta(vendor), label);
}

function renderBeaconPageLegacy(payload: string, vendor: string, label: string): string {
  const meta = vendorMeta(vendor);
  // v2.9.3 BEACON page upgrade:
  //  - Plaintext soul prompt (no AES-256-GCM nonsense — Gemini Free can't decrypt anyway)
  //  - Big copy button + visible status
  //  - Vendor-specific deeplink button (Open Gemini app / ChatGPT / Claude)
  //  - Mobile-first responsive CSS
  //  - LIVE STATE block visible at top so receiving AI reads current version
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(label)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;max-width:680px;margin:0 auto;padding:14px;line-height:1.5;color:#202124;background:#fafafa}
  h1{font-size:1.2em;margin:.2em 0}
  h2{font-size:1em;color:#555;margin-top:1.4em}
  pre{white-space:pre-wrap;word-break:break-word;background:#fff;border:1px solid #e0e0e0;padding:12px;border-radius:8px;font-size:.78em;max-height:38vh;overflow:auto}
  .row{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}
  .btn{flex:1 1 200px;font-size:1.05em;padding:14px 18px;border:0;border-radius:10px;color:#fff;cursor:pointer;font-weight:600;text-align:center;text-decoration:none;display:inline-block}
  .btn-primary{background:#1a73e8}
  .btn-primary:active{background:#0d47a1}
  .btn-vendor{background:#137333}
  .btn-vendor:active{background:#0b5a25}
  .status{margin:8px 0;font-weight:600}
  .ok{color:#137333}
  .err{color:#c5221f}
  small{color:#555}
  details{margin:14px 0}
  .footer{margin-top:24px;padding-top:12px;border-top:1px solid #e0e0e0;color:#777;font-size:.85em}
</style></head><body>
<h1>${escapeHtml(label)}</h1>
<p><small>Mneme cross-device brain transfer. No app install needed on this device. Tap the buttons below in order.</small></p>

<h2>Step 1 — Copy the brain</h2>
<div class="row">
  <button id="cp" class="btn btn-primary" onclick="copyAndStatus()">📋 Copy soul prompt</button>
</div>
<p class="status" id="s"></p>

<h2>Step 2 — Open ${escapeHtml(meta.name)} and paste</h2>
<div class="row">
  <a href="${escapeHtml(meta.url)}" target="_blank" rel="noopener" class="btn btn-vendor">🚀 Open ${escapeHtml(meta.name)}</a>
</div>
<p><small>After ${escapeHtml(meta.name)} opens, long-press the message input → Paste → Send. The receiving AI will read the LIVE STATE block at the top of the prompt and continue your conversation with current Mneme context.</small></p>

<details><summary>Show / verify the soul prompt</summary>
<pre id="p">${escapeHtml(payload)}</pre>
</details>

<div class="footer">
  Served by Mneme BEACON · ephemeral local server · auto-stops after 10 min idle · <span id="ts"></span>
</div>

<script>
function copyAndStatus(){
  const el = document.getElementById('p');
  const s = document.getElementById('s');
  if (!navigator.clipboard) { s.textContent = '⚠ Browser does not support auto-copy. Long-press the soul prompt below + Copy manually.'; s.className = 'status err'; return; }
  navigator.clipboard.writeText(el.textContent).then(()=>{
    s.textContent = '✓ Copied! Tap "Open ${meta.name.replace(/'/g, "\\'")}" above, then paste in the chat box.';
    s.className = 'status ok';
  }, (err)=>{
    s.textContent = '⚠ Copy failed: ' + err.message + ' — long-press the soul prompt below + Copy manually.';
    s.className = 'status err';
  });
}
document.getElementById('ts').textContent = new Date().toLocaleString();
</script>
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

  // v2.9.3: if caller bound to 127.0.0.1 only, the server is NOT reachable
  // on LAN IPs — don't lie to the AI agent by advertising URLs that will
  // throw ECONNREFUSED when scanned. Only surface LAN IPs when we bound
  // to a wildcard or all-interfaces address.
  const lanReachable = bindHost === "0.0.0.0" || bindHost === "::" || bindHost === "" || bindHost === "::0";
  const lanIPs = lanReachable ? detectLanIPs() : [];
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
