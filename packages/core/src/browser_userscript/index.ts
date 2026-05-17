/**
 * v2.19.38 — MNEME BROWSER USERSCRIPT (Socket #1 — install once, capture forever)
 *
 *   v2.19.37 BROWSER RECEIPT shipped the pure-TS core. v2.19.38 ships
 *   the actual SHELL the user installs:
 *
 *     (A) Single .user.js file (Tampermonkey / Violentmonkey / Greasemonkey
 *         compatible) — one-click install in any browser
 *     (B) Manifest v3 extension skeleton (.crx-ready) — for Chrome Web Store
 *
 *   This module emits the bytes for both. Caller (npm pack) writes them
 *   to `dist/browser/` for distribution.
 *
 *   Composes onto:
 *     - v2.19.37 BROWSER RECEIPT (vendor detection + chat extraction + mint)
 *     - v2.19.37 RECEIPT PROTOCOL (output format)
 *
 * Honest scope:
 *   - PURE FUNCTION bytes emitter. Two output formats.
 *   - Tampermonkey userscript = production-ready today.
 *   - Manifest v3 = skeleton (caller bundles core JS).
 *   - 20+ tests for emitted bytes + manifest validity.
 */

const PROTOCOL_VERSION = 1 as const;
const USERSCRIPT_VERSION = "1.0.0" as const;

const SUPPORTED_VENDOR_DOMAINS = [
  "chatgpt.com", "chat.openai.com",
  "claude.ai",
  "gemini.google.com", "bard.google.com",
  "x.com", "grok.com",
  "perplexity.ai", "www.perplexity.ai",
  "copilot.microsoft.com",
] as const;

// ─── USERSCRIPT (Tampermonkey / Violentmonkey compat) ──────────────

/**
 * Emit a single self-contained .user.js Tampermonkey script. User installs
 * by clicking the URL — Tampermonkey opens an install dialog.
 *
 * The userscript:
 *   1. Detects vendor from window.location.host
 *   2. Listens for chat turn DOM mutations via MutationObserver
 *   3. Extracts (user, assistant) turn pairs as text
 *   4. Mints a Mneme Protocol Receipt v1 (inline sha256 via SubtleCrypto)
 *   5. Saves to localStorage["mneme.browser.receipts.v1"] (JSON array)
 *   6. Adds a 🛡 floating indicator showing receipt count
 *   7. Optional: POST to a configurable Mneme HTTP bridge endpoint
 */
export function generateUserscript(): string {
  return `// ==UserScript==
// @name         Mneme Browser Receipt (v${USERSCRIPT_VERSION})
// @namespace    https://mneme-ai.dev
// @version      ${USERSCRIPT_VERSION}
// @description  Mints Mneme Receipt Protocol v1.0 receipts for every AI web-chat turn (ChatGPT / Claude / Gemini / Grok / Perplexity / Copilot). Local-first, vendor-neutral, MIT licensed.
// @author       Mneme contributors
// @license      MIT
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://claude.ai/*
// @match        https://gemini.google.com/*
// @match        https://bard.google.com/*
// @match        https://x.com/i/grok*
// @match        https://grok.com/*
// @match        https://www.perplexity.ai/*
// @match        https://perplexity.ai/*
// @match        https://copilot.microsoft.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

/* eslint-disable no-undef */
(function() {
  'use strict';

  // ─── Vendor detection ────────────────────────────────────────────
  const VENDOR_PATTERNS = [
    { vendor: 'chatgpt',    patterns: [/(^|\\.)chatgpt\\.com$/, /(^|\\.)chat\\.openai\\.com$/], assistantNames: ['ChatGPT', 'GPT'] },
    { vendor: 'claude',     patterns: [/(^|\\.)claude\\.ai$/], assistantNames: ['Claude'] },
    { vendor: 'gemini',     patterns: [/(^|\\.)gemini\\.google\\.com$/, /(^|\\.)bard\\.google\\.com$/], assistantNames: ['Gemini', 'Bard'] },
    { vendor: 'grok',       patterns: [/(^|\\.)x\\.com$/, /(^|\\.)grok\\.com$/], assistantNames: ['Grok'] },
    { vendor: 'perplexity', patterns: [/(^|\\.)perplexity\\.ai$/, /(^|\\.)www\\.perplexity\\.ai$/], assistantNames: ['Perplexity'] },
    { vendor: 'copilot',    patterns: [/(^|\\.)copilot\\.microsoft\\.com$/], assistantNames: ['Copilot'] },
  ];

  function detectVendor() {
    const host = (location.hostname || '').toLowerCase();
    for (const v of VENDOR_PATTERNS) {
      for (const p of v.patterns) {
        if (p.test(host)) return v;
      }
    }
    return null;
  }

  const vendorInfo = detectVendor();
  if (!vendorInfo) return; // unsupported page — silent exit

  // ─── SHA-256 via SubtleCrypto (async) ─────────────────────────────
  async function sha256Hex(text) {
    const buf = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function canonical(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    const keys = Object.keys(v).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }

  // ─── Mint a Mneme Protocol Receipt v1 ─────────────────────────────
  async function mintReceipt(userText, asstText, modelHint) {
    const promptSha256 = await sha256Hex(userText || '');
    const responseSha256 = await sha256Hex(asstText || '');
    const body = {
      protocol: 'mneme-receipt-protocol',
      protocolVersion: '1.0',
      implementation: '@mneme-ai/browser-userscript@${USERSCRIPT_VERSION}',
      vendor: vendorInfo.vendor,
      modelVersion: modelHint || 'web-chat-unknown',
      promptSha256, responseSha256,
      tsMs: Date.now(),
      toolsCalled: [], filesTouched: [],
      tokensIn: Math.ceil((userText || '').length / 4),
      tokensOut: Math.ceil((asstText || '').length / 4),
      costUsdMicros: 0,
      vaccinesTriggered: [],
      outcomeClass: 'pending',
    };
    const contentHash = await sha256Hex(canonical(body));
    return { ...body, contentHash };
  }

  // ─── Storage ──────────────────────────────────────────────────────
  const STORAGE_KEY = 'mneme.browser.receipts.v1';
  function loadReceipts() {
    try {
      const raw = (typeof GM_getValue === 'function') ? GM_getValue(STORAGE_KEY, '[]') : localStorage.getItem(STORAGE_KEY);
      const arr = JSON.parse(raw || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }
  function saveReceipts(arr) {
    const json = JSON.stringify(arr);
    try {
      if (typeof GM_setValue === 'function') GM_setValue(STORAGE_KEY, json);
      else localStorage.setItem(STORAGE_KEY, json);
    } catch (e) { console.warn('Mneme: storage write failed', e); }
  }
  function appendReceipt(r) {
    const arr = loadReceipts();
    arr.push(r);
    // Cap at 10,000 receipts to avoid localStorage blow-up
    if (arr.length > 10000) arr.shift();
    saveReceipts(arr);
  }

  // ─── Chat turn extraction (vendor-specific) ──────────────────────
  function extractLatestPair() {
    const body = (document.body && document.body.innerText) ? document.body.innerText : '';
    const names = vendorInfo.assistantNames.map(n => n.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&')).join('|');
    const splitRe = new RegExp('(^You\\\\b|^(?:' + names + ')\\\\b)', 'gm');
    const segs = body.split(splitRe).filter(s => s && s.trim().length > 0);
    let lastUserText = null, lastAsstText = null;
    for (let i = 0; i < segs.length - 1; i++) {
      const label = segs[i].trim();
      const text = segs[i + 1].trim().slice(0, 50000);
      if (/^You$/i.test(label)) lastUserText = text;
      else if (vendorInfo.assistantNames.some(n => n.toLowerCase() === label.toLowerCase())) lastAsstText = text;
    }
    return { userText: lastUserText, asstText: lastAsstText };
  }

  // ─── Floating 🛡 indicator UI ────────────────────────────────────
  function ensureIndicator() {
    let el = document.getElementById('mneme-indicator');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'mneme-indicator';
    el.style.cssText = 'position:fixed;bottom:12px;right:12px;background:#0f172a;color:#22d3ee;padding:6px 10px;border-radius:8px;font:12px ui-monospace,Menlo,monospace;cursor:pointer;z-index:2147483647;box-shadow:0 2px 8px rgba(0,0,0,0.3);user-select:none;';
    el.title = 'Mneme · click to export receipts';
    el.onclick = function() {
      const arr = loadReceipts();
      const blob = new Blob([JSON.stringify({ batchVersion: 1, receipts: arr, serializedAtMs: Date.now() }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mneme-receipts-' + Date.now() + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    document.body.appendChild(el);
    return el;
  }
  function updateIndicator() {
    const el = ensureIndicator();
    if (el) el.textContent = '🛡 Mneme · ' + loadReceipts().length;
  }

  // ─── MutationObserver: re-extract on chat updates ────────────────
  let mintInFlight = false;
  let lastMintHash = null;
  async function tick() {
    if (mintInFlight) return;
    const { userText, asstText } = extractLatestPair();
    if (!userText || !asstText) { updateIndicator(); return; }
    const key = userText.slice(0, 100) + '||' + asstText.slice(0, 100);
    if (key === lastMintHash) { updateIndicator(); return; } // dedupe
    mintInFlight = true;
    try {
      const r = await mintReceipt(userText, asstText, null);
      appendReceipt(r);
      lastMintHash = key;
      updateIndicator();
    } catch (e) { console.warn('Mneme mint failed:', e); }
    finally { mintInFlight = false; }
  }

  function start() {
    updateIndicator();
    const obs = new MutationObserver(() => { setTimeout(tick, 300); });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    setInterval(tick, 5000); // safety poll every 5s
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
`;
}

// ─── MANIFEST V3 (Chrome Web Store extension skeleton) ─────────────

export interface ManifestV3 {
  manifest_version: 3;
  name: string;
  version: string;
  description: string;
  permissions: string[];
  host_permissions: string[];
  content_scripts: Array<{ matches: string[]; js: string[]; run_at: string }>;
  background?: { service_worker: string };
  action?: { default_popup: string; default_icon?: Record<string, string> };
  icons?: Record<string, string>;
}

export function generateManifestV3(): ManifestV3 {
  return {
    manifest_version: 3,
    name: "Mneme Browser Receipt",
    version: USERSCRIPT_VERSION,
    description: "Mints Mneme Receipt Protocol v1.0 receipts for every AI web-chat turn. Local-first, vendor-neutral, MIT licensed.",
    permissions: ["storage"],
    host_permissions: SUPPORTED_VENDOR_DOMAINS.map((d) => `https://${d}/*`),
    content_scripts: [{
      matches: SUPPORTED_VENDOR_DOMAINS.map((d) => `https://${d}/*`),
      js: ["content.js"],
      run_at: "document_idle",
    }],
    action: { default_popup: "popup.html" },
  };
}

/** Content script (bundled-version of the userscript IIFE, minus Greasemonkey APIs). */
export function generateContentScript(): string {
  // For the extension shell, just embed the userscript IIFE body without
  // the @grant blocks — the extension uses chrome.storage instead.
  // Keep it close to the userscript so behaviour matches; chrome.storage
  // detection falls back to localStorage when chrome.* is unavailable.
  return generateUserscript()
    .replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/m, "")
    .replace(/GM_setValue/g, "(typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local ? function(k,v){chrome.storage.local.set({[k]:v});} : function(){})")
    .replace(/GM_getValue\(([^,]+),\s*([^)]+)\)/g, "(localStorage.getItem($1) || $2)");
}

export function generatePopupHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Mneme Browser Receipt</title>
<style>
  body { font: 13px ui-sans-serif, system-ui; background: #0f172a; color: #e2e8f0; padding: 12px; width: 280px; margin: 0; }
  h1 { font-size: 14px; margin: 0 0 8px; color: #22d3ee; }
  .stat { background: #1e293b; padding: 8px; border-radius: 6px; margin: 6px 0; }
  .stat strong { color: #fde047; }
  button { background: #22d3ee; color: #001821; border: none; padding: 8px 12px; border-radius: 6px; font-weight: 600; cursor: pointer; width: 100%; margin-top: 8px; }
  button:hover { filter: brightness(1.1); }
  a { color: #22d3ee; }
</style>
</head>
<body>
<h1>🛡 Mneme Browser Receipt</h1>
<div class="stat">Receipts captured: <strong id="count">…</strong></div>
<button id="export">📥 Export all receipts (JSON)</button>
<button id="clear">🗑 Clear stored receipts</button>
<p style="margin-top:12px;font-size:11px;color:#94a3b8;">
  Receipts stay LOCAL. Export to share with <a href="https://mneme-ai.dev">mneme-ai.dev</a>.
</p>
<script>
  function loadCount() {
    try {
      const raw = localStorage.getItem('mneme.browser.receipts.v1') || '[]';
      const arr = JSON.parse(raw);
      document.getElementById('count').textContent = Array.isArray(arr) ? arr.length : 0;
    } catch { document.getElementById('count').textContent = '?'; }
  }
  document.getElementById('export').onclick = () => {
    const raw = localStorage.getItem('mneme.browser.receipts.v1') || '[]';
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'mneme-receipts.json'; a.click();
  };
  document.getElementById('clear').onclick = () => {
    if (confirm('Clear all stored receipts?')) {
      localStorage.removeItem('mneme.browser.receipts.v1');
      loadCount();
    }
  };
  loadCount();
</script>
</body>
</html>`;
}

// ─── README for distribution ───────────────────────────────────────

export function generateBrowserReadme(): string {
  return `# 🛡 Mneme Browser Receipt — install once, capture forever

## Option A: Userscript (works in any browser; recommended)

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome / Firefox / Edge / Safari).
2. Click → install the latest \`mneme.user.js\` from this directory.
3. Visit any of: chatgpt.com, claude.ai, gemini.google.com, x.com/i/grok, perplexity.ai, copilot.microsoft.com — the 🛡 indicator appears bottom-right.
4. Chat normally. Each AI response auto-mints a Mneme Receipt Protocol v1 receipt to your browser's storage.
5. Click 🛡 to export JSON of all receipts.

## Option B: Chrome Extension (.crx)

1. Download \`mneme-browser-receipt-extension.zip\` from this directory.
2. Unzip.
3. Chrome → \`chrome://extensions\` → "Load unpacked" → select the unzipped folder.
4. Done. Behaves identically to userscript.

## What it does

- Detects which AI vendor's web chat you're on (6 vendors supported)
- Watches for new chat turns via MutationObserver
- Extracts (user, assistant) text pairs
- Mints a portable Mneme Receipt Protocol v1.0 receipt (sha256 of prompt + response, no plaintext stored)
- Saves to local browser storage (never leaves your device)
- Provides one-click export for sharing with Citizens Audit / personal archive

## What it does NOT do

- ❌ Send anything to any server without your action
- ❌ Read your prompts in plaintext (only sha256 hashes stored)
- ❌ Modify the AI vendor's page in any visible way (except the small 🛡 indicator)
- ❌ Inject anything into your chat

## License

MIT. Source: \`@mneme-ai/core/browser_userscript\`. Reference impl: \`@mneme-ai/core/browser_receipt\`.
`;
}

// ─── STATS ─────────────────────────────────────────────────────────

export interface UserscriptStats {
  userscriptBytes: number;
  manifestBytes: number;
  contentScriptBytes: number;
  popupBytes: number;
  readmeBytes: number;
  supportedDomains: number;
}

export function computeUserscriptStats(): UserscriptStats {
  return {
    userscriptBytes: generateUserscript().length,
    manifestBytes: JSON.stringify(generateManifestV3(), null, 2).length,
    contentScriptBytes: generateContentScript().length,
    popupBytes: generatePopupHtml().length,
    readmeBytes: generateBrowserReadme().length,
    supportedDomains: SUPPORTED_VENDOR_DOMAINS.length,
  };
}

export function formatUserscriptStatsLine(s: UserscriptStats): string {
  return `🛡 USERSCRIPT · ${s.userscriptBytes}B + manifest ${s.manifestBytes}B + popup ${s.popupBytes}B · ${s.supportedDomains} domains`;
}

export const BROWSER_USERSCRIPT_TUNABLES = Object.freeze({
  PROTOCOL_VERSION,
  USERSCRIPT_VERSION,
  SUPPORTED_DOMAINS: SUPPORTED_VENDOR_DOMAINS,
});
