/**
 * v1.89.0 -- RAINBOW: multi-channel handoff orchestrator.
 *
 * Renders the COMPLETE PC-side handoff page that includes 3 QRs
 * covering every realistic network scenario (1-7 from the matrix).
 * Scenario 8 (offline) is handled separately via Wanderer .mwt.
 *
 * Channels live in v1.89:
 *   🅰 LAN HTTP server      -- same WiFi, 1-tap via Web Share API
 *   🅱 data: URL bridge     -- ANY network, 1-tap; HTML page lives in QR,
 *                              fetches soul from public paste
 *   🅲 dpaste raw            -- always works, 4-tap fallback
 *
 * Channels ON THE ROADMAP (v1.90+):
 *   🔊 ggwave audio          -- zero-network, sound-based, multi-recipient
 *   🔗 cloudflared tunnel    -- opt-in, true cross-network without LAN
 *   📡 WebRTC P2P             -- browser-native, with public STUN
 *
 * v1.89 ships ONLY the channels that work without ANY install + ANY
 * account. ggwave + cloudflared + WebRTC ship in v1.90 as opt-in.
 */

import type { SoulPrompt } from "../genesplice/soul_prompt.js";

export type ChannelId = "lan" | "data-bridge" | "dpaste-raw" | "ggwave" | "cloudflared" | "webrtc";

export interface ChannelStatus {
  id: ChannelId;
  available: boolean;
  reason: string;
  /** When available, where to point the QR. */
  url?: string | null;
  /** Tap-count on phone after scan. */
  tapsOnPhone: number;
  /** Scenarios this channel covers (matrix #1-8). */
  scenarios: number[];
}

export interface RainbowHandoff {
  soul: SoulPrompt;
  channels: ChannelStatus[];
  /** Recommended channel given current availability. */
  recommended: ChannelId | null;
  /** Plain-English summary. */
  summary: string;
}

export interface RainbowInputs {
  lanUrl: string | null;
  dpasteUrl: string | null;
  /** Whether the data: bridge can be built (requires dpasteUrl). */
  enableDataBridge?: boolean;
}

/** Build the channel status report. UI layer (browser/CLI) renders the
 *  actual QR codes; this module just decides which channels are LIVE. */
export function probeChannels(soul: SoulPrompt, input: RainbowInputs): RainbowHandoff {
  const channels: ChannelStatus[] = [];

  channels.push({
    id: "lan",
    available: Boolean(input.lanUrl),
    reason: input.lanUrl ? "LAN HTTP server reachable on this private network" : "no private LAN interface detected",
    url: input.lanUrl ?? null,
    tapsOnPhone: 1,
    scenarios: [1, 4, 5],
  });

  const dataBridgeAvailable = Boolean(input.enableDataBridge !== false && input.dpasteUrl);
  channels.push({
    id: "data-bridge",
    available: dataBridgeAvailable,
    reason: dataBridgeAvailable
      ? "data: URL HTML page fetches soul from dpaste -- works on any network"
      : "needs dpaste URL to fetch from",
    // The actual data: URL is composed by the renderer (it includes the JS wrapper).
    url: input.dpasteUrl ?? null,
    tapsOnPhone: 1,
    scenarios: [1, 2, 3, 4, 5, 6, 7],
  });

  channels.push({
    id: "dpaste-raw",
    available: Boolean(input.dpasteUrl),
    reason: input.dpasteUrl ? "raw plaintext on dpaste, 7-day TTL" : "dpaste upload failed",
    url: input.dpasteUrl ?? null,
    tapsOnPhone: 4,
    scenarios: [1, 2, 3, 4, 5, 6, 7],
  });

  // Roadmap channels -- always reported as not-yet-live in v1.89.
  channels.push({ id: "ggwave", available: false, reason: "v1.90 -- audio handoff via sound (no network needed)", tapsOnPhone: 1, scenarios: [1, 2, 3, 4, 5, 6, 7] });
  channels.push({ id: "cloudflared", available: false, reason: "v1.90 -- public HTTPS tunnel (one-time install)", tapsOnPhone: 1, scenarios: [1, 2, 3, 4, 5, 6, 7] });
  channels.push({ id: "webrtc", available: false, reason: "v1.90 -- browser-native peer-to-peer", tapsOnPhone: 1, scenarios: [1, 2, 3, 4, 5, 6, 7] });

  // Recommendation: data-bridge first (1-tap any network), then LAN (1-tap same network), then dpaste-raw.
  let recommended: ChannelId | null = null;
  if (dataBridgeAvailable) recommended = "data-bridge";
  else if (input.lanUrl) recommended = "lan";
  else if (input.dpasteUrl) recommended = "dpaste-raw";

  const liveCount = channels.filter((c) => c.available).length;
  const summary = `${liveCount}/3 channels live (v1.89). Recommended: ${recommended ?? "none"}.`;

  return { soul, channels, recommended, summary };
}

/** Build the data: URL bridge -- the wild move. Tiny HTML page that
 *  fetches soul from dpaste + renders Web Share button. Whole thing
 *  fits in a QR because the soul is fetched, not embedded. */
export function buildDataBridgeUrl(dpasteUrl: string): string {
  const wrapper =
    `<!doctype html><html><head>` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Mneme</title>` +
    `<style>body{margin:0;padding:24px;font-family:sans-serif;background:#1abc9c;color:#fff;min-height:100vh;display:flex;flex-direction:column;gap:16px;align-items:center;justify-content:center;text-align:center}` +
    `button{background:#fff;color:#2c3e50;border:0;padding:18px 28px;border-radius:14px;font-weight:700;font-size:17px;cursor:pointer;width:100%;max-width:340px}` +
    `h2{margin:0}</style></head><body>` +
    `<h2>Mneme handoff</h2><div id="s">loading...</div>` +
    `<button id="b" disabled>...</button>` +
    `<script>fetch("${dpasteUrl}").then(r=>r.text()).then(t=>{` +
    `const b=document.getElementById("b");b.disabled=false;` +
    `b.textContent="Share to AI";` +
    `b.onclick=()=>navigator.share?navigator.share({text:t}):` +
    `navigator.clipboard.writeText(t).then(()=>b.textContent="Copied!")}` +
    `).catch(e=>{document.getElementById("b").textContent="Error: "+e.message})` +
    `</script></body></html>`;
  return "data:text/html;charset=utf-8," + encodeURIComponent(wrapper);
}
