/**
 * v2.19.95 — CLONE — one-verb handoff orchestrator.
 *
 * Composes:
 *   live_session_mirror  →  genesplice.compressToSoulPrompt
 *                        →  one of [clipboard | beacon LAN | relay paste]
 *
 * Why this module exists:
 *   v2.19.94 fixed the stale-capsule bug, but the user still had to
 *   compose three separate primitives (transmit + extract text + ship
 *   via anchor/beacon/synapse).  This module unifies all of them so
 *   the user — and the AI agent on their behalf — types ONE verb:
 *
 *     mneme clone              → clipboard (same machine paste)
 *     mneme clone qr           → LAN URL + QR (phone same WiFi)
 *     mneme clone remote       → public paste + QR (cross-network)
 *
 *   No `--payload`. No remembering `genesplice`. The session captures
 *   itself in realtime.
 *
 * Intent routing:
 *   AI agents read `agent_manifest` and recognise the user's
 *   natural-language asks ("clone session" / "ส่งสมอง" /
 *   "send brain to phone" / "ย้ายไปคุยต่อใน Cursor") and fire the
 *   right transport silently.
 */

import { captureLiveCapsule } from "../live_session_mirror/index.js";
import { compressToSoulPrompt } from "../genesplice/soul_prompt.js";
import { writeClipboard, detectClipboard } from "../anchor/clipboard_handoff.js";
import { spawnBeacon, pasteCrossWifi, qrForUrl, type BeaconResult } from "../beacon/index.js";

export type CloneTransport = "clipboard" | "qr" | "remote";

export interface CloneOptions {
  /** Receiving vendor for phenotype tailoring (claude / chatgpt / gemini / cursor / cline / etc). */
  receivingVendor?: string;
  /** How many recent turns to include. Default 30. */
  lastN?: number;
  /** LAN port for QR transport. Default 7741. */
  port?: number;
}

export interface CloneClipboardResult {
  transport: "clipboard";
  ok: boolean;
  bytes: number;
  tool: string;
  reason?: string;
  /** The soul prompt that was written (so the AI agent can ALSO surface it inline). */
  soulPreview: string;
  estTokens: number;
}

export interface CloneQrResult {
  transport: "qr";
  /** LAN URLs the destination device can open. */
  lanUrls: string[];
  /** Inline data:image/svg+xml QR — AI agent renders directly in chat. */
  qrDataUri: string | null;
  /** Token identifying this handoff. */
  token: string;
  /** Port the server is bound to. */
  port: number | null;
  /** The live HTTP server — caller MUST stash + close it when done. */
  server: BeaconResult["server"];
  estTokens: number;
}

export interface CloneRemoteResult {
  transport: "remote";
  /** Public paste URL (dpaste). */
  url: string | null;
  /** QR for the URL. */
  qrDataUri: string | null;
  expiresAt: string | null;
  estTokens: number;
}

export type CloneResult = CloneClipboardResult | CloneQrResult | CloneRemoteResult;

// ─── HELPERS ───────────────────────────────────────────────────────────

/** Capture live session and compress to soul prompt string. Throws with a
 *  user-friendly message if no live session is found. */
function buildSoulPrompt(repoRoot: string, opts: CloneOptions): { text: string; estTokens: number } {
  const cap = captureLiveCapsule(repoRoot, { lastN: opts.lastN ?? 30 });
  if (!cap) {
    throw new Error("CLONE: no live AI editor session found for this repo. Open Claude Code in this folder + chat once first.");
  }
  // The soul-prompt compressor expects a SessionCapsule-shape; LiveCapsule
  // is compatible (same fields).  Cast through to satisfy the typecheck.
  const soul = compressToSoulPrompt({ capsule: cap as any });
  return { text: soul.text, estTokens: soul.estTokens };
}

// ─── TRANSPORTS ────────────────────────────────────────────────────────

/** Same-machine new-folder / same-machine other-AI handoff. The user opens
 *  a new Claude Code / Cursor / Codex / etc. session and presses Ctrl/Cmd-V. */
export function cloneToClipboard(repoRoot: string, opts: CloneOptions = {}): CloneClipboardResult {
  const { text, estTokens } = buildSoulPrompt(repoRoot, opts);
  const r = writeClipboard(text);
  return {
    transport: "clipboard",
    ok: r.ok,
    bytes: r.bytes,
    tool: r.tool,
    reason: r.reason,
    soulPreview: text.length > 600 ? text.slice(0, 600) + "…\n[trimmed; full prompt is in your clipboard]" : text,
    estTokens,
  };
}

/** Same-WiFi cross-device handoff. The destination device opens a LAN URL
 *  or scans the QR; the soul prompt is auto-copied to their clipboard. */
export async function cloneViaLan(repoRoot: string, opts: CloneOptions = {}): Promise<CloneQrResult> {
  const { text, estTokens } = buildSoulPrompt(repoRoot, opts);
  const r = await spawnBeacon({
    payload: text,
    targetVendor: opts.receivingVendor,
    port: opts.port,
  });
  // Find QR + URL paths from the beacon result.
  const urlPaths = r.paths.filter((p) => p.displayHint === "url").map((p) => p.content);
  const qrPath = r.paths.find((p) => p.displayHint === "image-data-uri");
  return {
    transport: "qr",
    lanUrls: urlPaths,
    qrDataUri: qrPath?.content ?? null,
    token: r.token,
    port: r.port,
    server: r.server,
    estTokens,
  };
}

/** Cross-network handoff (different WiFi / cellular / different city).
 *  Posts the soul prompt to an anonymous paste service and returns a public
 *  short URL + QR. NOT for sensitive sessions. */
export async function cloneViaRelay(repoRoot: string, opts: CloneOptions = {}): Promise<CloneRemoteResult> {
  const { text, estTokens } = buildSoulPrompt(repoRoot, opts);
  const r = await pasteCrossWifi(text);
  if (!r) {
    return { transport: "remote", url: null, qrDataUri: null, expiresAt: null, estTokens };
  }
  const qr = qrForUrl(r.url);
  return {
    transport: "remote",
    url: r.url,
    qrDataUri: qr,
    expiresAt: r.expires ? new Date(r.expires).toISOString() : null,
    estTokens,
  };
}

// ─── PUBLIC FACADE ─────────────────────────────────────────────────────

/** Pick the right transport. Default = clipboard (same-machine, fastest, safest). */
export async function clone(repoRoot: string, transport: CloneTransport = "clipboard", opts: CloneOptions = {}): Promise<CloneResult> {
  switch (transport) {
    case "clipboard": return cloneToClipboard(repoRoot, opts);
    case "qr":        return cloneViaLan(repoRoot, opts);
    case "remote":    return cloneViaRelay(repoRoot, opts);
    default:          return cloneToClipboard(repoRoot, opts);
  }
}

/** Diagnostic — tells the AI agent what transports are LIKELY to work
 *  on this machine right now. Cheap; no network. */
export function diagnoseTransports(): { clipboard: { ok: boolean; tool: string }; qr: { ok: boolean }; remote: { ok: boolean } } {
  const cb = detectClipboard();
  return {
    clipboard: { ok: cb.tool !== "none", tool: cb.tool },
    qr: { ok: true /* spawnBeacon always tries; bind may fail */ },
    remote: { ok: true /* pasteCrossWifi requires internet at call-time */ },
  };
}
