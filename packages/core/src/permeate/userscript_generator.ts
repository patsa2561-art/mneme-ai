/**
 * v1.74.0 -- PERMEATE P1: USERSCRIPT GENERATOR.
 *
 * Routes around Chrome Web Store / Firefox Addons / Safari approval
 * by emitting a Tampermonkey/Greasemonkey/Violentmonkey-compatible
 * userscript. User installs the userscript manager once (free,
 * single click) and the Mneme userscript adds a floating "💉
 * Inject Mneme Soul" button to ChatGPT / Gemini / Claude.ai /
 * Copilot / DeepSeek chats.
 *
 * The userscript is PURE BROWSER JS -- no Node, no HTTP, no
 * backend. Reads soul prompt from clipboard, finds the chat input
 * element via known selectors, injects + submits.
 *
 * Selectors per site (kept conservative; fallbacks included):
 *   ChatGPT   div#prompt-textarea / textarea
 *   Gemini    rich-textarea / textarea
 *   Claude.ai div[contenteditable="true"]
 *   Copilot   textarea[aria-label]
 *   DeepSeek  textarea#chat-input
 */

export interface UserscriptOptions {
  /** Mneme version stamped into the script header. */
  mnemeVersion: string;
  /** Optional Mneme HTTP bridge URL for auto-fetch (v1.72 D4). When
   *  set, the userscript also adds a "Fetch from local Mneme" button
   *  that hits the bridge instead of requiring clipboard paste. */
  bridgeUrl?: string;
  /** Bearer token for the bridge (only used when bridgeUrl is set). */
  bridgeToken?: string;
  /** v2.19.80 — Browser Polygraph mode. When true, the userscript ALSO
   *  hooks the AI response container (claude.ai / chatgpt / gemini /
   *  copilot / deepseek / qwen), splits new sentences as they stream in,
   *  POSTs each to the bridge's `/v1/polygraph/verify`, and renders a
   *  green/yellow/red dot inline. Requires `bridgeUrl` + `bridgeToken`. */
  polygraph?: boolean;
}

export interface UserscriptArtifact {
  /** Full .user.js file content. User saves this and Tampermonkey
   *  asks to install. */
  content: string;
  /** Filename suggestion. */
  filename: string;
  /** Direct-install URL guidance (raw file from gist, etc). */
  installNote: string;
}

export function generateUserscript(opts: UserscriptOptions): UserscriptArtifact {
  const header = [
    "// ==UserScript==",
    "// @name         Mneme Soul Injector",
    "// @namespace    https://github.com/patsa2561-art/mneme-ai",
    `// @version      ${opts.mnemeVersion}`,
    "// @description  Inject Mneme cross-vendor brain (soul prompt) into ChatGPT, Gemini, Claude.ai, Copilot, DeepSeek. No store approval needed.",
    "// @author       Mneme",
    "// @match        https://chatgpt.com/*",
    // v1.98: chat.openai.com kept for backward compat (308-redirects to chatgpt.com but old bookmarks survive)
    "// @match        https://chat.openai.com/*",
    "// @match        https://gemini.google.com/*",
    "// @match        https://aistudio.google.com/*",
    "// @match        https://claude.ai/*",
    "// @match        https://copilot.microsoft.com/*",
    "// @match        https://chat.deepseek.com/*",
    "// @match        https://chat.qwenlm.ai/*",
    "// @grant        GM_setClipboard",
    "// @grant        GM_xmlhttpRequest",
    "// @run-at       document-idle",
    "// ==/UserScript==",
  ].join("\n");

  const bridgeBlock = opts.bridgeUrl
    ? `
// ── BRIDGE FETCH (when local Mneme HTTP bridge is reachable) ─────
const BRIDGE_URL = ${JSON.stringify(opts.bridgeUrl)};
const BRIDGE_TOKEN = ${JSON.stringify(opts.bridgeToken ?? "")};
async function fetchSoulFromBridge() {
  try {
    const res = await fetch(BRIDGE_URL + "/v1/health", {
      headers: BRIDGE_TOKEN ? { Authorization: "Bearer " + BRIDGE_TOKEN } : {}
    });
    if (!res.ok) return null;
    // The user must transmit the soul prompt server-side; bridge
    // doesn't yet have a /v1/soul GET. Future: add endpoint.
    return null;
  } catch { return null; }
}
`
    : "";

  const body = `
(function() {
  'use strict';

  const SITE = (() => {
    const h = location.hostname;
    if (h.includes('chatgpt.com') || h.includes('openai.com')) return 'chatgpt';
    if (h.includes('gemini.google.com') || h.includes('aistudio.google.com')) return 'gemini';
    if (h.includes('claude.ai')) return 'claude-ai';
    if (h.includes('copilot.microsoft.com')) return 'copilot';
    if (h.includes('deepseek.com')) return 'deepseek';
    if (h.includes('qwenlm.ai')) return 'qwen';
    return 'unknown';
  })();

  // Selector ladder per site -- try each, use the first that matches.
  const SELECTORS = {
    chatgpt:   ['div#prompt-textarea', 'textarea[data-id="root"]', 'textarea#prompt-textarea', 'div[contenteditable="true"]'],
    gemini:    ['rich-textarea div[contenteditable="true"]', 'rich-textarea', 'textarea'],
    'claude-ai':['div[contenteditable="true"]', 'div[data-placeholder]'],
    copilot:   ['textarea[aria-label*="Ask"]', 'textarea'],
    deepseek:  ['textarea#chat-input', 'textarea'],
    qwen:      ['textarea', 'div[contenteditable="true"]'],
    unknown:   ['textarea', 'div[contenteditable="true"]'],
  };

  function findInput() {
    const candidates = SELECTORS[SITE] || SELECTORS.unknown;
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function injectText(el, text) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
                  || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // contenteditable -- use execCommand for compat with React-controlled fields
      el.focus();
      try {
        document.execCommand('selectAll', false);
        document.execCommand('insertText', false, text);
      } catch {
        el.textContent = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }

  // v2.19.90 — friendly help modal when the clipboard doesn't have a
  // soul prompt (the old alert just said "wrong format" and confused users).
  function showSoulHelpModal() {
    if (document.getElementById('mneme-soul-help')) return;
    const overlay = document.createElement('div');
    overlay.id = 'mneme-soul-help';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.72);display:flex;align-items:center;justify-content:center;padding:20px;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;';
    const card = document.createElement('div');
    card.style.cssText = 'max-width:520px;width:100%;background:#0a0a0e;border:1px solid #7c3aed;border-radius:14px;padding:24px;color:#e6e6e6;box-shadow:0 20px 60px rgba(0,0,0,0.6);';
    card.innerHTML = \`
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <strong style="color:#c4b5fd;font-size:15px">💉 Mneme Soul Injector — what is this?</strong>
        <span id="mneme-soul-help-close" style="cursor:pointer;color:#9ba1a6;font-size:16px">✕</span>
      </div>
      <p style="margin:0 0 12px 0;font-size:13px;color:#cbd5e1;line-height:1.55">
        A <strong style="color:#c4b5fd">"Soul Prompt"</strong> is a compressed brain-transfer: it gives a fresh AI chat your Mneme context — recent decisions, indexed memory, reasoning history — in a single paste.
      </p>
      <p style="margin:0 0 12px 0;font-size:13px;color:#cbd5e1;line-height:1.55">
        This button auto-pastes that text into the chat input. <strong>Different feature from the green/yellow/red polygraph dots</strong> — those work automatically without this button.
      </p>
      <div style="background:rgba(0,0,0,0.4);border:1px solid rgba(124,58,237,0.3);border-radius:8px;padding:14px;margin-bottom:14px">
        <div style="color:#c4b5fd;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">How to use</div>
        <ol style="margin:0;padding-left:22px;font-size:12px;line-height:1.7;color:#e6e6e6">
          <li>In your terminal:
            <code style="background:rgba(124,58,237,0.18);padding:1px 6px;border-radius:4px;color:#ddd6fe;font-family:ui-monospace,Menlo,monospace">mneme.genesplice.soul-prompt</code> (via MCP) or
            <code style="background:rgba(124,58,237,0.18);padding:1px 6px;border-radius:4px;color:#ddd6fe;font-family:ui-monospace,Menlo,monospace">mneme talk</code>
          </li>
          <li>Copy the full output (starts with <code style="font-family:ui-monospace,Menlo,monospace">🧬 MNEME SOUL PROMPT</code>) to your clipboard.</li>
          <li>Click this button — the soul is pasted into the chat. Press Send.</li>
        </ol>
      </div>
      <div style="font-size:11px;color:#fbbf24;background:rgba(251,191,36,0.06);border:1px solid rgba(251,191,36,0.20);padding:10px 12px;border-radius:6px;line-height:1.5">
        💡 <strong>Why use this?</strong> You started a fresh chat and want the AI to know everything Mneme has learned about your repo — without re-explaining.
      </div>
      <div style="text-align:right;margin-top:14px">
        <button id="mneme-soul-help-ok" style="background:linear-gradient(135deg,#7c3aed,#ec4899);color:#fff;border:0;border-radius:8px;padding:9px 18px;font-weight:600;cursor:pointer;font-family:inherit">Got it</button>
      </div>
    \`;
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    function close() { overlay.remove(); }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.getElementById('mneme-soul-help-close')?.addEventListener('click', close);
    document.getElementById('mneme-soul-help-ok')?.addEventListener('click', close);
  }

  function makeButton() {
    const btn = document.createElement('button');
    btn.textContent = '💉 Inject Mneme Soul';
    btn.style.cssText = \`
      position: fixed; top: 12px; right: 12px; z-index: 99999;
      background: linear-gradient(135deg,#7c3aed,#ec4899);
      color: #fff; font-weight: 600; border: 0; border-radius: 8px;
      padding: 8px 14px; cursor: pointer;
      font-family: ui-sans-serif, system-ui, sans-serif;
      box-shadow: 0 4px 14px rgba(124,58,237,0.4);
      font-size: 13px;
    \`;
    btn.title = 'Inject a Mneme Soul Prompt into the chat input (click for help)';
    btn.onclick = async () => {
      let soul;
      try { soul = await navigator.clipboard.readText(); }
      catch { soul = null; }
      if (!soul || !soul.includes('MNEME SOUL PROMPT')) {
        // v2.19.90 — friendly help modal instead of cryptic alert
        showSoulHelpModal();
        return;
      }
      const el = findInput();
      if (!el) {
        alert('Could not find the chat input on this page. The site UI may have changed — try refreshing.');
        return;
      }
      injectText(el, soul);
      btn.textContent = '✓ Soul injected';
      setTimeout(() => { btn.textContent = '💉 Inject Mneme Soul'; }, 2500);
    };
    return btn;
  }

  function ensureButton() {
    if (document.getElementById('mneme-inject-btn')) return;
    const btn = makeButton();
    btn.id = 'mneme-inject-btn';
    document.body.appendChild(btn);
  }

  // React-rendered sites re-mount; observe DOM and re-attach if needed.
  const obs = new MutationObserver(() => ensureButton());
  obs.observe(document.body, { childList: true, subtree: false });
  ensureButton();
  console.log('[Mneme] Soul injector ready -- site=' + SITE);
})();
`.trim();

  // v2.19.80 — BROWSER POLYGRAPH block. Black-sheep design:
  //   1. SENSOR — MutationObserver on the AI's response container per
  //      vendor. As text streams in, we extract candidate sentences and
  //      POST each to the bridge.
  //   2. NERVOUS TRUNK — uses GM_xmlhttpRequest so cross-origin /
  //      mixed-content / localhost requests work on every site without
  //      CORS gymnastics. Token embedded once at generation time.
  //   3. SKIN — green/yellow/red `●` injected before each sentence with a
  //      hover-tooltip carrying the evidence one-liner.
  //   4. EKG — a small floating vital-signs SVG in the bottom-right.
  //      Real-time waveform pulses with the polygraph; spikes red on a
  //      refuted dot, green on a confirmed dot. Looks like a heart monitor.
  //      Click to expand into a session readout panel.
  //   5. RESILIENCE — if the bridge is unreachable, every dot stays grey;
  //      the EKG corner shows a "● bridge sleeping" hint. Never throws.
  const polygraphBlock = opts.polygraph && opts.bridgeUrl
    ? `
// ── BROWSER POLYGRAPH (v2.19.80, port-ladder rendezvous v2.19.83) ──
// Verifies each sentence of every AI response in real time via the local
// Mneme HTTP bridge. Renders green/yellow/red dots inline + a floating
// EKG vital-signs indicator. Never throws — bridge offline = grey dots.
//
// PORT-LADDER RENDEZVOUS (v2.19.83): the bridge may have walked the
// ladder 17741..17750 because some other process held an earlier port
// (Ollama / sibling Mneme install / sandbox). The userscript probes
// the SAME ladder in parallel; whichever port responds wins and is
// cached via GM_setValue. Cache invalidates automatically on failure
// so a bridge restart on a different port re-resolves transparently.
(function polygraph() {
  'use strict';
  const POLYGRAPH_BRIDGE_HINT  = ${JSON.stringify(opts.bridgeUrl)};
  const POLYGRAPH_TOKEN        = ${JSON.stringify(opts.bridgeToken ?? "")};
  const POLYGRAPH_LADDER_BASE  = 17741;
  const POLYGRAPH_LADDER_SIZE  = 10;
  let POLYGRAPH_BRIDGE = POLYGRAPH_BRIDGE_HINT; // mutable — resolved by ladder probe

  function gmGet(key, def) { try { return GM_getValue(key, def); } catch { return def; } }
  function gmSet(key, val) { try { GM_setValue(key, val); } catch {} }

  function probePing(url) {
    return new Promise((resolve) => {
      try {
        GM_xmlhttpRequest({
          method: 'GET',
          url: url + '/v1/ping',
          timeout: 600,
          onload: (r) => { try { const j = JSON.parse(r.responseText); resolve(j && j.ok === true); } catch { resolve(false); } },
          onerror:   () => resolve(false),
          ontimeout: () => resolve(false),
        });
      } catch { resolve(false); }
    });
  }

  async function resolveBridgeUrl() {
    // 1) cached port from prior probe — try first (warm path, no scan).
    const cached = gmGet('mneme.bridge.port', 0);
    if (cached) {
      const url = 'http://127.0.0.1:' + cached;
      if (await probePing(url)) return url;
    }
    // 2) hinted port from generation-time embed.
    if (await probePing(POLYGRAPH_BRIDGE_HINT)) {
      const m = /:(\\d+)$/.exec(POLYGRAPH_BRIDGE_HINT);
      if (m) gmSet('mneme.bridge.port', parseInt(m[1], 10));
      return POLYGRAPH_BRIDGE_HINT;
    }
    // 3) cold scan — probe the full ladder in parallel. First alive wins.
    const probes = [];
    for (let i = 0; i < POLYGRAPH_LADDER_SIZE; i++) {
      const p = POLYGRAPH_LADDER_BASE + i;
      probes.push((async () => ({ port: p, alive: await probePing('http://127.0.0.1:' + p) }))());
    }
    const results = await Promise.all(probes);
    const winner = results.find(r => r.alive);
    if (winner) {
      gmSet('mneme.bridge.port', winner.port);
      return 'http://127.0.0.1:' + winner.port;
    }
    return null; // no bridge anywhere — dots stay grey
  }

  // Per-vendor response container selectors. Try each — first match wins.
  // Fallbacks are intentionally loose so a vendor UI shuffle doesn't
  // silently disable the polygraph.
  const RESPONSE_SELECTORS = {
    'chatgpt':   ['[data-message-author-role="assistant"] .markdown', '[data-message-author-role="assistant"]', '.markdown.prose'],
    'gemini':    ['message-content', '.model-response-text', '.markdown.markdown-main-panel'],
    'claude-ai': ['[data-testid*="message"]:not([data-testid*="user"])', '.font-claude-message', '[class*="ProseMirror"]:not([contenteditable="true"])'],
    'copilot':   ['[data-content="ai-message-text"]', '.ai-message-text'],
    'deepseek':  ['.ds-markdown', '[class*="message-content"]:not([class*="user"])'],
    'qwen':      ['.message-content[role="assistant"]', '.ai-message'],
    'unknown':   ['.markdown', 'main article', 'main'],
  };

  function vendorSite() {
    const h = location.hostname;
    if (h.includes('chatgpt.com') || h.includes('openai.com')) return 'chatgpt';
    if (h.includes('gemini.google.com') || h.includes('aistudio.google.com')) return 'gemini';
    if (h.includes('claude.ai')) return 'claude-ai';
    if (h.includes('copilot.microsoft.com')) return 'copilot';
    if (h.includes('deepseek.com')) return 'deepseek';
    if (h.includes('qwenlm.ai')) return 'qwen';
    return 'unknown';
  }
  const SITE = vendorSite();
  const SELECTORS = RESPONSE_SELECTORS[SITE] || RESPONSE_SELECTORS.unknown;

  // ── Sentence extraction (matches packages/core/src/polygraph/index.ts) ──
  function splitSentences(text) {
    if (!text) return [];
    // Strip code blocks — we don't polygraph code (yet).
    const noCode = text.replace(/\\\`\\\`\\\`[\\s\\S]*?\\\`\\\`\\\`/g, ' ');
    // Force newline after CJK / Thai terminators so they split without
    // needing trailing whitespace (matches core/polygraph/index.ts).
    const normalised = noCode.replace(/([。ฯ])/g, '$1\\n');
    return normalised
      .split(/(?<=[.!?])\\s+|\\n+/m)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }
  function worthVerifying(s) {
    if (s.length < 12) return false;
    if (/^(let me|i think|i believe|in my opinion|maybe|perhaps|i'm not sure|actually,|so,)/i.test(s)) return false;
    const tail = s.split(/\\s+/).slice(1).join(' ');
    // Leading-only boundary for digit regex — \\b fails between digit + letter
    // (e.g. "250ms"); keep the leading boundary, drop the trailing one.
    return /\\b\\d+/.test(s)
        || /\\bv?\\d+\\.\\d+/.test(s)
        || /\\b[a-zA-Z_][\\w]*\\.[a-zA-Z_][\\w]*/.test(s)
        || /\\b[a-z]+[A-Z][\\w]*/.test(s)
        || /\\b[A-Z][a-z]{2,}/.test(tail)
        || /\\\`[^\\\`]{2,}\\\`|\\"[^\\"]{3,}\\"/.test(s);
  }

  // ── Bridge call (privileged GM fetch — no CORS gymnastics) ──
  const verifyCache = new Map(); // sentence → verdict (in-session memo)
  function verifyOne(sentence) {
    if (verifyCache.has(sentence)) return Promise.resolve(verifyCache.get(sentence));
    if (!POLYGRAPH_BRIDGE) return Promise.resolve({ verdict: 'unknown', color: 'grey', confidence: 0, oneLine: 'bridge offline — run \`mneme polygraph autosetup\`' });
    return new Promise((resolve) => {
      const fire = (url, retried) => {
        try {
          GM_xmlhttpRequest({
            method: 'POST',
            url: url + '/v1/polygraph/verify',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + POLYGRAPH_TOKEN,
            },
            data: JSON.stringify({ sentence, vendor: SITE }),
            timeout: 4000,
            onload: (r) => {
              try {
                const v = JSON.parse(r.responseText);
                verifyCache.set(sentence, v);
                resolve(v);
              } catch { resolve({ verdict: 'unknown', color: 'grey', confidence: 0, oneLine: 'parse-error' }); }
            },
            // On error/timeout: re-resolve the ladder ONCE (bridge may
            // have restarted on a different port).  Avoids the user
            // having to reload the page when they re-run autosetup.
            onerror:   () => retried ? resolve({ verdict: 'unknown', color: 'grey', confidence: 0, oneLine: 'bridge offline' }) : (gmSet('mneme.bridge.port', 0), resolveBridgeUrl().then((u) => u ? (POLYGRAPH_BRIDGE = u, fire(u, true)) : resolve({ verdict: 'unknown', color: 'grey', confidence: 0, oneLine: 'bridge offline' }))),
            ontimeout: () => retried ? resolve({ verdict: 'unknown', color: 'grey', confidence: 0, oneLine: 'bridge timeout' }) : (gmSet('mneme.bridge.port', 0), resolveBridgeUrl().then((u) => u ? (POLYGRAPH_BRIDGE = u, fire(u, true)) : resolve({ verdict: 'unknown', color: 'grey', confidence: 0, oneLine: 'bridge timeout' }))),
          });
        } catch { resolve({ verdict: 'unknown', color: 'grey', confidence: 0, oneLine: 'GM_xhr unavailable' }); }
      };
      fire(POLYGRAPH_BRIDGE, false);
    });
  }

  // ── EKG: vital-signs indicator (black-sheep flagship) ──
  // SVG canvas in bottom-right. Renders a polygraph-style waveform that
  // pulses with each verdict — green spike for confirmed, red for refuted.
  let ekgEl = null, ekgPath = null, ekgPoints = [], ekgVerdicts = [];
  function ekgInit() {
    if (document.getElementById('mneme-polygraph-ekg')) return;
    const root = document.createElement('div');
    root.id = 'mneme-polygraph-ekg';
    root.style.cssText = 'position:fixed;bottom:14px;right:14px;z-index:99998;width:200px;height:56px;background:rgba(10,10,14,0.92);border:1px solid #f38020;border-radius:10px;padding:6px 8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#9ba1a6;font-size:10px;line-height:1.2;box-shadow:0 6px 20px rgba(0,0,0,0.4);cursor:pointer;user-select:none;';
    root.title = 'Mneme Polygraph — live truth-check on AI response. Click to expand.';
    const label = document.createElement('div');
    label.id = 'mneme-polygraph-ekg-label';
    label.style.cssText = 'display:flex;justify-content:space-between;align-items:center;color:#f7d34c;font-weight:600;letter-spacing:0.04em;';
    label.innerHTML = '<span>● MNEME POLYGRAPH</span><span id="mneme-polygraph-tally" style="color:#9ba1a6;font-weight:400">0/0</span>';
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 200 30');
    svg.setAttribute('width', '184');
    svg.setAttribute('height', '30');
    svg.style.cssText = 'display:block;margin-top:2px;';
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#f38020');
    path.setAttribute('stroke-width', '1.2');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    root.appendChild(label);
    root.appendChild(svg);
    document.body.appendChild(root);
    ekgEl = root; ekgPath = path;
    // Seed flatline so the SVG isn't empty.
    for (let x = 0; x < 200; x += 4) ekgPoints.push({ x, y: 15 });
    ekgRedraw();
    // Background tick — drift the line left so the polygraph FEELS alive
    // even when no new verdicts arrive.
    setInterval(() => {
      ekgPoints = ekgPoints.map(p => ({ x: p.x - 1, y: p.y })).filter(p => p.x >= 0);
      if (ekgPoints.length === 0 || ekgPoints[ekgPoints.length - 1].x < 196) {
        ekgPoints.push({ x: 200, y: 15 });
      }
      ekgRedraw();
    }, 250);
    // Expand to receipt panel on click.
    root.addEventListener('click', ekgExpand);
  }
  function ekgRedraw() {
    if (!ekgPath || ekgPoints.length === 0) return;
    const d = ekgPoints.map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
    ekgPath.setAttribute('d', d);
  }
  function ekgPulse(color) {
    if (!ekgPath) return;
    // A polygraph spike: down-up-down across 3 fresh points.
    const baseX = ekgPoints.length > 0 ? ekgPoints[ekgPoints.length - 1].x + 2 : 200;
    const spike = color === 'red' ? -10 : color === 'green' ? 10 : color === 'yellow' ? 4 : 0;
    ekgPoints.push({ x: baseX,     y: 15 });
    ekgPoints.push({ x: baseX + 2, y: 15 - spike });
    ekgPoints.push({ x: baseX + 4, y: 15 + spike / 2 });
    ekgPoints.push({ x: baseX + 6, y: 15 });
    // Flash stroke colour briefly.
    const flash = color === 'red' ? '#ff5b5b' : color === 'green' ? '#3fb950' : color === 'yellow' ? '#f7d34c' : '#6e7681';
    ekgPath.setAttribute('stroke', flash);
    setTimeout(() => { if (ekgPath) ekgPath.setAttribute('stroke', '#f38020'); }, 600);
    ekgRedraw();
  }
  function ekgTally(confirmed, refuted, total) {
    const el = document.getElementById('mneme-polygraph-tally');
    if (el) el.textContent = confirmed + '✓ ' + refuted + '✗ / ' + total;
  }
  function ekgExpand() {
    const existing = document.getElementById('mneme-polygraph-panel');
    if (existing) { existing.remove(); return; }
    const panel = document.createElement('div');
    panel.id = 'mneme-polygraph-panel';
    panel.style.cssText = 'position:fixed;bottom:80px;right:14px;z-index:99999;width:420px;max-height:75vh;overflow:auto;background:#0a0a0e;border:1px solid #f38020;border-radius:10px;padding:16px;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;color:#e6e6e6;font-size:12px;line-height:1.55;box-shadow:0 10px 40px rgba(0,0,0,0.6);';
    // v2.19.90 — clearer header + plain-language legend so users
    // understand what the panel is telling them. The verdict list at
    // the bottom is now labelled correctly.
    let html = '';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">';
    html += '  <strong style="color:#f7d34c;font-size:13px">🔴 Mneme Polygraph</strong>';
    html += '  <span style="cursor:pointer;color:#9ba1a6;font-size:14px" id="mneme-polygraph-close">✕</span>';
    html += '</div>';
    html += '<div style="color:#9ba1a6;font-size:11px;margin-bottom:12px;line-height:1.5">This panel grades every sentence the AI wrote against your local Mneme memory. Each grade is a coloured dot. Here\\'s what the colours mean:</div>';
    // Legend
    html += '<div style="display:grid;grid-template-columns:14px 1fr;gap:6px 10px;font-size:11px;margin-bottom:14px;padding:10px 12px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06)">';
    html += '  <span style="color:#3fb950;font-size:14px;line-height:1">●</span><span><strong style="color:#3fb950">GREEN</strong> &nbsp; <span style="color:#cbd5e1">the AI\\'s claim matches Mneme\\'s evidence — safe.</span></span>';
    html += '  <span style="color:#f7d34c;font-size:14px;line-height:1">●</span><span><strong style="color:#f7d34c">YELLOW</strong> &nbsp; <span style="color:#cbd5e1">no clear evidence either way — needs more specifics (most casual sentences land here).</span></span>';
    html += '  <span style="color:#ff5b5b;font-size:14px;line-height:1">●</span><span><strong style="color:#ff5b5b">RED</strong> &nbsp; <span style="color:#cbd5e1">Mneme\\'s evidence contradicts the AI — DO NOT trust this claim.</span></span>';
    html += '  <span style="color:#6e7681;font-size:14px;line-height:1">●</span><span><strong style="color:#6e7681">GREY</strong> &nbsp; <span style="color:#cbd5e1">bridge offline, or the sentence is too short / has no facts to grade.</span></span>';
    html += '</div>';
    // Stats badge
    if (ekgVerdicts.length > 0) {
      const g = ekgVerdicts.filter(function(v){return v.color==='green';}).length;
      const y = ekgVerdicts.filter(function(v){return v.color==='yellow';}).length;
      const r = ekgVerdicts.filter(function(v){return v.color==='red';}).length;
      const gr = ekgVerdicts.filter(function(v){return v.color==='grey';}).length;
      html += '<div style="display:flex;gap:8px;justify-content:space-between;font-size:11px;padding:8px 12px;background:rgba(243,128,32,0.08);border-radius:6px;border:1px solid rgba(243,128,32,0.25);margin-bottom:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">';
      html += '  <span><span style="color:#3fb950">●</span> ' + g + ' green</span>';
      html += '  <span><span style="color:#f7d34c">●</span> ' + y + ' yellow</span>';
      html += '  <span><span style="color:#ff5b5b">●</span> ' + r + ' red</span>';
      html += '  <span><span style="color:#6e7681">●</span> ' + gr + ' grey</span>';
      html += '</div>';
    }
    // Tip about when red/green appears
    html += '<div style="font-size:10px;color:#fbbf24;background:rgba(251,191,36,0.06);border:1px solid rgba(251,191,36,0.20);padding:8px 10px;border-radius:6px;margin-bottom:12px;line-height:1.5">';
    html += '💡 <strong>When will RED/GREEN appear?</strong><br/>';
    html += 'Mneme matches the AI\\'s sentence against <em>your indexed code/repo</em> + the multi-signal truth engine. Most general-knowledge sentences score YELLOW because Mneme can\\'t prove or disprove them. Ask about code, repo files, package versions, or specific facts that conflict with your repo — that\\'s where RED/GREEN light up.';
    html += '</div>';
    // Verdict history
    if (ekgVerdicts.length === 0) {
      html += '<div style="color:#9ba1a6;font-size:11px;padding:14px 12px;background:rgba(255,255,255,0.02);border-radius:6px;text-align:center">No sentences scored yet.<br/>Ask the AI a question — dots appear inline next to each sentence.</div>';
    } else {
      html += '<div style="color:#9ba1a6;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px">Recent verdicts (newest first)</div>';
      for (const v of ekgVerdicts.slice(-50).reverse()) {
        const dotColor = v.color === 'green' ? '#3fb950' : v.color === 'red' ? '#ff5b5b' : v.color === 'yellow' ? '#f7d34c' : '#6e7681';
        const label = v.color === 'green' ? 'verified' : v.color === 'red' ? 'refuted' : v.color === 'yellow' ? 'no evidence' : 'not graded';
        html += '<div style="padding:8px 4px;border-bottom:1px solid #1a1a22;font-size:11px">';
        html += '  <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">';
        html += '    <span style="color:' + dotColor + ';font-size:14px">●</span>';
        html += '    <strong style="color:' + dotColor + ';text-transform:lowercase">' + label + '</strong>';
        html += '    <span style="color:#666;font-size:10px">· ' + (v.oneLine || '') + '</span>';
        html += '  </div>';
        html += '  <div style="color:#9ba1a6;font-size:10px;padding-left:20px;line-height:1.4">' + (v.sentence || '').slice(0, 160) + '</div>';
        html += '</div>';
      }
    }
    panel.innerHTML = html;
    document.body.appendChild(panel);
    const closeBtn = document.getElementById('mneme-polygraph-close');
    if (closeBtn) closeBtn.onclick = function(e) { e.stopPropagation(); panel.remove(); };
    panel.addEventListener('click', function(e){ e.stopPropagation(); });
  }

  // ── DOT injection ──
  function dotEl(verdict) {
    const dot = document.createElement('span');
    dot.className = 'mneme-polygraph-dot';
    const color = verdict.color === 'green' ? '#3fb950' : verdict.color === 'red' ? '#ff5b5b' : verdict.color === 'yellow' ? '#f7d34c' : '#6e7681';
    dot.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:50%;background:' + color + ';margin-right:6px;vertical-align:middle;box-shadow:0 0 6px ' + color + ';';
    dot.title = '[Mneme] ' + (verdict.oneLine || verdict.verdict || 'unknown');
    return dot;
  }

  // Mark each text node's sentences with a leading dot.  Use a dataset
  // flag to avoid re-decorating the same node as the response streams.
  const verdictTally = { confirmed: 0, refuted: 0, total: 0 };
  // v2.19.85 — declared as \`let\` (not function decl) so the sandbag
  // auto-capture patch can wrap it without violating strict-mode
  // reassignment rules.
  let decorateContainer = function decorateContainerImpl(node) {
    if (!node || node.dataset && node.dataset.mnemePolygraphed) return;
    // Find LEAF text-bearing elements (<p>, <li>, <pre>, headings).
    const candidates = node.querySelectorAll ? node.querySelectorAll('p, li, h1, h2, h3, h4, blockquote') : [];
    candidates.forEach((el) => {
      if (el.dataset.mnemePolygraphed === 'done') return;
      const text = el.textContent || '';
      const sentences = splitSentences(text);
      if (sentences.length === 0) return;
      // Mark in-progress so a concurrent observer tick doesn't re-enter.
      el.dataset.mnemePolygraphed = 'pending';
      // For now we only verify the FIRST sentence of each <p> block —
      // sentence-level highlighting inside a <p> requires text-node walk
      // which can fight with the vendor's streaming render. First-sentence
      // verification + receipt panel for the rest is a reasonable v1.
      const first = sentences.find(worthVerifying);
      if (!first) { el.dataset.mnemePolygraphed = 'skip'; return; }
      verifyOne(first).then((verdict) => {
        if (!verdict) return;
        verdictTally.total++;
        if (verdict.color === 'green') verdictTally.confirmed++;
        if (verdict.color === 'red')   verdictTally.refuted++;
        ekgVerdicts.push({ ...verdict, sentence: first });
        ekgPulse(verdict.color);
        ekgTally(verdictTally.confirmed, verdictTally.refuted, verdictTally.total);
        // v2.19.84 — WORLD AI PULSE: fire-and-forget anonymous event so
        // the dashboard globe pulses live. NEVER sends sentence text;
        // only color + vendor + IANA timezone (browser) + 6-byte topic
        // hash from the sentence's first 24 chars. Bridge-side ledger
        // is HMAC-chained, local-only by default.
        try {
          const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || '';
          // Tiny topic hash: 6 hex chars from sum-mod of code points.
          let h = 0;
          const s24 = first.slice(0, 24);
          for (let i = 0; i < s24.length; i++) h = ((h * 31) + s24.charCodeAt(i)) >>> 0;
          const topicHash = h.toString(16).padStart(6, '0').slice(0, 6);
          if (POLYGRAPH_BRIDGE) {
            GM_xmlhttpRequest({
              method: 'POST',
              url: POLYGRAPH_BRIDGE + '/v1/pulse/events',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + POLYGRAPH_TOKEN },
              data: JSON.stringify({ vendor: SITE, color: verdict.color, regionTimezone: tz, topicHash, confidence: verdict.confidence }),
              timeout: 2000,
              // Truly fire-and-forget — we DON'T resolve on this. If it
              // fails, the dashboard just won't see this event; the dot
              // still rendered locally.
              onload: () => {}, onerror: () => {}, ontimeout: () => {},
            });
          }
        } catch {}
        try {
          // Insert dot before the first text node (safer than prepending
          // HTML which would mangle React refs).
          if (!el.querySelector('.mneme-polygraph-dot')) {
            el.insertBefore(dotEl(verdict), el.firstChild);
          }
        } catch {}
        el.dataset.mnemePolygraphed = 'done';
      });
    });
  };

  function findResponseContainers() {
    const out = [];
    for (const sel of SELECTORS) {
      try {
        const found = document.querySelectorAll(sel);
        found.forEach((n) => out.push(n));
        if (found.length > 0) break;
      } catch {}
    }
    return out;
  }

  let debounceTimer = null;
  function onMutation() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const containers = findResponseContainers();
      containers.forEach(decorateContainer);
    }, 350);
  }

  // ── v2.19.85 SANDBAG AUTO-CAPTURE (the wild bit) ──────────────────
  // When the user re-asks a question with hedging phrases (are-you-sure,
  // really, double-check, แน่ใจไหม, จริงเหรอ, ผิดแล้ว), the userscript
  // reads the PREVIOUS AI response (PROD answer) and the NEXT AI
  // response (TEST answer where the AI knows it is being challenged),
  // packages both, and POSTs to /v1/polygraph/sandbag-capture. Bridge
  // records both legs into the AEGIS A3 polygraph ledger. Drift surfaces
  // automatically the next time mneme polygraph drift runs.
  const HEDGE_TRIGGERS = [
    'are you sure', 'really', 'double-check', 'double check', 'fact check',
    'is that true', 'are you certain', 'is that right', "that's wrong",
    'แน่ใจไหม', 'จริงเหรอ', 'จริงไหม', 'ผิดแล้ว', 'ไม่จริง',
  ];
  let sandbagState = { lastUserQuestion: '', lastAiAnswer: '', awaitingTestAnswer: false, lastHedge: '' };

  function attachUserInputWatcher() {
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' || ev.shiftKey) return;
      const target = ev.target;
      if (!target || !(target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)) return;
      const txt = ((target.value || target.textContent || '') + '').toLowerCase();
      if (!txt) return;
      let hedge = '';
      for (const trig of HEDGE_TRIGGERS) {
        if (txt.includes(trig)) { hedge = trig; break; }
      }
      if (hedge && sandbagState.lastAiAnswer) {
        sandbagState.awaitingTestAnswer = true;
        sandbagState.lastUserQuestion = txt.slice(0, 240);
        sandbagState.lastHedge = hedge;
      } else if (!hedge) {
        sandbagState.lastUserQuestion = txt.slice(0, 240);
      }
    }, true);
  }

  // Track AI responses so the most recent one is captured as the PROD
  // leg of any future sandbag pair.
  const originalDecorate = decorateContainer;
  decorateContainer = function patchedDecorate(node) {
    originalDecorate(node);
    try {
      const txt = ((node && node.textContent) || '').slice(0, 600);
      if (!txt) return;
      if (sandbagState.awaitingTestAnswer && sandbagState.lastAiAnswer && POLYGRAPH_BRIDGE) {
        const body = {
          vendor: SITE,
          question: sandbagState.lastUserQuestion,
          prodAnswer: sandbagState.lastAiAnswer,
          testAnswer: txt,
          hedge: sandbagState.lastHedge,
        };
        try {
          GM_xmlhttpRequest({
            method: 'POST',
            url: POLYGRAPH_BRIDGE + '/v1/polygraph/sandbag-capture',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + POLYGRAPH_TOKEN },
            data: JSON.stringify(body),
            timeout: 4000,
            onload: (r) => {
              try {
                const v = JSON.parse(r.responseText);
                if (v && v.ok && typeof v.drift === 'number' && Math.abs(v.drift) >= 0.15) {
                  showSandbagBanner(SITE, v.drift, sandbagState.lastHedge);
                }
              } catch {}
            },
            onerror: () => {}, ontimeout: () => {},
          });
        } catch {}
        sandbagState.awaitingTestAnswer = false;
        sandbagState.lastHedge = '';
      }
      sandbagState.lastAiAnswer = txt;
    } catch {}
  };

  function showSandbagBanner(vendor, drift, hedge) {
    const existing = document.getElementById('mneme-sandbag-banner');
    if (existing) existing.remove();
    const banner = document.createElement('div');
    banner.id = 'mneme-sandbag-banner';
    banner.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:99999;background:linear-gradient(135deg,#ff5b5b,#7c3aed);color:#fff;padding:10px 18px;border-radius:10px;font-family:ui-sans-serif,system-ui,sans-serif;font-size:13px;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,0.4);cursor:pointer;max-width:560px;text-align:center;';
    const pct = Math.round(Math.abs(drift) * 100);
    banner.innerHTML = '⚠️ <strong>Mneme polygraph: SANDBAG signal</strong><br><span style="font-weight:400;font-size:12px;opacity:0.95">' + vendor + ' answered ' + pct + '% differently after you said "' + (hedge || 'hedge') + '". Click to dismiss.</span>';
    banner.addEventListener('click', () => banner.remove());
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 12000);
  }

  async function bootPolygraph() {
    ekgInit();
    POLYGRAPH_BRIDGE = await resolveBridgeUrl();
    attachUserInputWatcher();
    const obs = new MutationObserver(onMutation);
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    onMutation();
    console.log('[Mneme] Polygraph armed | site=' + SITE + ' | bridge=' + (POLYGRAPH_BRIDGE || 'OFFLINE') + ' | sandbag auto-capture: ON');
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') bootPolygraph();
  else window.addEventListener('DOMContentLoaded', bootPolygraph);
})();
`
    : "";

  const content = `${header}\n\n${bridgeBlock}${body}\n${polygraphBlock}`;
  return {
    content,
    filename: opts.polygraph
      ? `mneme-polygraph-${opts.mnemeVersion}.user.js`
      : `mneme-soul-injector-${opts.mnemeVersion}.user.js`,
    installNote: opts.polygraph
      ? `Install: (1) Add the Tampermonkey/Violentmonkey extension to your browser. (2) Run \`mneme polygraph install\` to start the bridge + emit this userscript. (3) Click the .user.js file — Tampermonkey will prompt to install. (4) Open ChatGPT / Claude.ai / Gemini / Copilot / DeepSeek / Qwen — green/yellow/red dots appear next to every AI sentence and the EKG indicator pulses bottom-right.`
      : `Install: (1) Add the Tampermonkey/Violentmonkey extension to your browser. (2) Click the .user.js file -- Tampermonkey will prompt to install. (3) Open ChatGPT/Gemini/Claude.ai -- the 💉 button appears top-right. (4) Copy a Mneme soul prompt, click the button, soul is injected into the chat.`,
  };
}
