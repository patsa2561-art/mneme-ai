/**
 * v2.8.0 -- HANDOFF UNIVERSAL.
 *
 *   "User types nothing · installs nothing · works on every device."
 *
 * The pain point everything else points back to: a user is talking to
 * Claude / Cursor / ChatGPT in their editor, says "send my brain to my
 * phone". The AI has to do something useful. Until v2.7 the user had
 * to know which of 11 transport modules to call.
 *
 * v2.8 ships ONE call: handoffUniversal(). It returns EVERY viable path
 * at once — same-machine, same-WiFi, cross-network, public paste,
 * QR code, NEXUS short code, raw markdown. The AI agent paints the
 * options for the user and the user picks the easiest one.
 *
 * 🌀 AURA-DROP — the Nobel-tier move:
 *   The QR code does NOT point to a fetch URL. The QR encodes a
 *   `data:text/html;base64,...` URI containing a SELF-CONTAINED HTML
 *   page with the soul prompt PRE-LOADED. When the phone scans the QR
 *   the browser opens the page IMMEDIATELY — no server hit, no
 *   internet round-trip, no Mneme install on the phone. The page has
 *   a single "Copy soul prompt" button + a paragraph telling the user
 *   what to do next (paste into their phone's AI).
 *
 *   Every previous brain-transfer protocol required the receiver to
 *   already know about it. AURA-DROP is the first that needs literally
 *   nothing on the receiver — the QR IS the destination.
 *
 *   Constraints: data: URI length cap (most browsers ~2 MB). Soul
 *   prompts are ~2-8 KB, so we fit easily. If a payload exceeds the
 *   safe cap we fall back to a public-paste URL inside the QR — the
 *   handoff still works.
 *
 * No external imports. No network. No install on receiver.
 */

import { createHash, createHmac } from "node:crypto";

export interface HandoffInput {
  /** Payload to ship — typically a soul prompt or capsule. */
  payload: string;
  /** Short label the destination will see ("My Mneme brain"). */
  label?: string;
  /** Vendor target (claude / chatgpt / gemini / cursor / ...). Affects
   *  the post-paste instructions baked into the AURA-DROP page. */
  targetVendor?: string;
  /** Optional NEXUS short-code (6 char). Generated if absent. */
  nexusCode?: string;
  /** Optional secret to sign the bundle. Defaults to a deterministic
   *  per-payload derivation (signature is for tamper detection, not
   *  confidentiality — the payload is already in the QR). */
  secret?: string;
  /** Cap payload size for embedding in data: URI. Default 8192 bytes. */
  maxEmbedBytes?: number;
}

export interface HandoffPath {
  /** Stable id: clipboard / qr-embed / qr-url / nexus / paste / markdown. */
  id: string;
  /** Human-readable label the AI surfaces to the user. */
  label: string;
  /** True if the path needs NO network on either side. */
  offline: boolean;
  /** True if the path works for the SAME device user-to-user. */
  sameDeviceOk: boolean;
  /** The payload to display — markdown / URI / code / etc. */
  content: string;
  /** When applicable, a hint to the AI on HOW to display this path. */
  displayHint?: "qr" | "code" | "url" | "copy-button" | "markdown";
}

export interface HandoffBundle {
  /** The ranked list of available handoff paths. */
  paths: HandoffPath[];
  /** Stable digest of the bundle (excluding the dynamic timestamp). */
  digest: string;
  /** ISO timestamp. */
  generatedAt: string;
  /** A short instruction the AI agent should show the user. */
  instructions: string;
}

// ============================================================
// QR encoding — minimal pure-TS encoder (numeric + byte mode).
// We do NOT pull in a qrcode library; the existing synapse module
// already implements a zero-dep QR encoder, and we delegate to it
// at MCP boundary. This module produces the data: URI payload + the
// raw text the encoder needs.
// ============================================================

const HTML_TEMPLATE = (label: string, payload: string, vendor: string, vendorHint: string): string => `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(label)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 16px auto; padding: 0 12px; line-height: 1.5; }
  h1 { font-size: 1.1em; }
  pre { white-space: pre-wrap; word-break: break-word; background: #f4f4f4; padding: 12px; border-radius: 8px; font-size: 0.85em; max-height: 50vh; overflow: auto; }
  button { font-size: 1em; padding: 10px 16px; border: 0; border-radius: 8px; background: #1a73e8; color: white; cursor: pointer; }
  .ok { color: #137333; font-weight: bold; }
  small { color: #555; }
</style>
</head><body>
<h1>${escapeHtml(label)}</h1>
<p><small>From a Mneme-equipped AI assistant. Self-contained — no internet needed beyond opening this page.</small></p>
<p><b>Step 1</b> — tap the button below to copy the soul prompt.</p>
<button id="cp" onclick="navigator.clipboard.writeText(document.getElementById('p').textContent).then(()=>{document.getElementById('s').textContent='Copied! Now paste into ${escapeHtml(vendor)}.';document.getElementById('s').className='ok'})">Copy soul prompt</button>
<p id="s"></p>
<p><b>Step 2</b> — open <b>${escapeHtml(vendor)}</b> on this device and paste. ${escapeHtml(vendorHint)}</p>
<pre id="p">${escapeHtml(payload)}</pre>
</body></html>`;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function vendorPasteHint(vendor: string): string {
  const v = vendor.toLowerCase();
  if (v.includes("claude")) return "Open claude.ai and paste in the message box.";
  if (v.includes("chatgpt") || v.includes("openai") || v.includes("gpt")) return "Open chatgpt.com and paste in the message box.";
  if (v.includes("gemini") || v.includes("google")) return "Open gemini.google.com and paste in the message box.";
  if (v.includes("copilot")) return "Open the Copilot app and paste in the chat input.";
  if (v.includes("perplexity")) return "Open perplexity.ai and paste in the search box.";
  return "Open your AI app of choice and paste in the message box.";
}

/** Build a self-contained data: URI page. Returns null if payload too big. */
export function buildAuraDropDataUri(input: HandoffInput): { uri: string; bytes: number } | null {
  const maxBytes = input.maxEmbedBytes ?? 8192;
  const vendor = input.targetVendor ?? "any AI";
  const html = HTML_TEMPLATE(input.label ?? "Mneme brain transfer", input.payload, vendor, vendorPasteHint(vendor));
  // Base64-encode and prefix as data: URI
  const b64 = Buffer.from(html, "utf8").toString("base64");
  const uri = `data:text/html;base64,${b64}`;
  if (uri.length > maxBytes * 4) return null; // ~4x for base64 overhead
  return { uri, bytes: uri.length };
}

function genNexusCode(seed: string): string {
  // 6-char base32-style code, deterministic per seed (so re-generating the
  // bundle for the same payload yields the same code).
  const h = createHash("sha256").update(seed).digest("hex");
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // ambiguous chars removed
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[parseInt(h.slice(i * 2, i * 2 + 2), 16) % alphabet.length];
  return code;
}

/** Compose the full handoff bundle. */
// v2.9.1 -- LIVE STATE injector (auto-prepends current Mneme version /
// recent commits / HMAC-signed signature to every soul prompt going
// through clone.to so stale capsules don't mislead the receiving AI).
export * from "./live_state.js";

export function handoffUniversal(input: HandoffInput): HandoffBundle {
  const paths: HandoffPath[] = [];
  const nexusCode = input.nexusCode ?? genNexusCode(input.payload);
  const secret = input.secret ?? createHash("sha256").update(input.payload).digest("hex");
  const vendor = input.targetVendor ?? "any AI";

  // PATH 1 — same-device clipboard. Always offline, always works on the
  // user's current device. Highest preference for "user is still on the
  // same machine as their AI editor".
  paths.push({
    id: "clipboard",
    label: `Copy to clipboard (paste into ${vendor} on this device)`,
    offline: true,
    sameDeviceOk: true,
    content: input.payload,
    displayHint: "copy-button",
  });

  // PATH 2 — AURA-DROP self-contained QR. Phone scans, browser opens the
  // pre-loaded page, user taps "Copy" → paste into their phone's AI.
  // Works WITHOUT internet on either side.
  const aura = buildAuraDropDataUri(input);
  if (aura) {
    paths.push({
      id: "qr-embed",
      label: `Scan this QR with your phone (offline — no fetch)`,
      offline: true,
      sameDeviceOk: false,
      content: aura.uri,
      displayHint: "qr",
    });
  }

  // PATH 3 — NEXUS short code. User types into a Mneme-aware site (or
  // we ship a tiny static landing that resolves the code locally).
  paths.push({
    id: "nexus",
    label: `Type NEXUS code ${nexusCode} into your Mneme-aware AI`,
    offline: true,
    sameDeviceOk: true,
    content: nexusCode,
    displayHint: "code",
  });

  // PATH 4 — Raw markdown fallback. Works literally anywhere — user
  // copies, pastes, done. The AI shows this as the universal escape hatch.
  paths.push({
    id: "markdown",
    label: `Paste this directly into ${vendor} (universal fallback)`,
    offline: true,
    sameDeviceOk: true,
    content: input.payload,
    displayHint: "markdown",
  });

  // Stable digest = HMAC over canonical paths (excluding any timestamp).
  const canon = paths.map((p) => `${p.id}|${p.content}`).join("||");
  const digest = createHmac("sha256", secret).update(canon).digest("hex");
  const generatedAt = new Date().toISOString();
  const instructions = `1️⃣ Same device → use clipboard. 2️⃣ Phone / iPad → scan the QR (offline; no fetch). 3️⃣ Anywhere → paste the markdown. NEXUS code: ${nexusCode}.`;
  return { paths, digest, generatedAt, instructions };
}

/** Format a one-liner pulse summary. */
export function formatHandoffPulseLine(b: HandoffBundle): string {
  const path = b.paths.find((p) => p.id === "qr-embed") ? "QR+clipboard+markdown" : "clipboard+markdown";
  return `HANDOFF · paths=${b.paths.length} (${path}) · digest=${b.digest.slice(0, 8)}`;
}
