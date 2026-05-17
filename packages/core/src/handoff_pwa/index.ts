/**
 * v2.19.32 — MNEME HANDOFF PWA (the device-adaptive page the scanner lands on)
 *
 *   "PWA ปลายทาง — Smart, Detect device. หน้าเดียว ฉลาดพอจะปรับตัว
 *    ตาม scanner: Android phone → Share to Gemini; Desktop → Open in
 *    Cursor / VS Code / Claude Code; iOS → Copy + Shortcut; Tablet →
 *    เหมือน Phone"                                  — user spec, 2026-05-17
 *
 *   v2.19.32 ships a pure-function HTML GENERATOR. Caller (BEACON HTTP
 *   server) embeds the envelope text + SAS emoji + pair code into a
 *   self-contained HTML page (no external CDN — works offline on LAN).
 *   The embedded JavaScript detects user-agent and renders the right
 *   set of action buttons.
 *
 *   Action buttons by device:
 *
 *     📱 Android Phone:
 *       [📤 Share to Gemini app]   (Web Share API → any AI app installed)
 *       [📤 Share to ChatGPT app]
 *       [📤 Share to Claude app]
 *       [📋 Copy to clipboard]
 *
 *     📱 iOS Phone (Web Share API limited):
 *       [📋 Copy to clipboard]
 *       [📲 Open Shortcut] (mneme://receive deep link)
 *
 *     💻 Desktop browser:
 *       [💻 Open in Cursor]     (cursor:// deep link)
 *       [💻 Open in VS Code]    (vscode:// deep link)
 *       [💻 Open in Claude Code] (claude-code:// deep link)
 *       [💻 Save to .mneme/]    (download .json — CLI auto-detects)
 *       [📋 Copy to clipboard]
 *
 *     📱 Tablet: phone-like
 *
 *   All buttons gracefully degrade: if Web Share unsupported → clipboard;
 *   if deep link unsupported → download .json + instructions.
 *
 *   Composes onto:
 *     - v2.19.32 HANDOFF SNAPSHOT (envelope to embed)
 *     - v2.19.32 PAIR CODE (code displayed + SAS emoji)
 *     - v2.9 BEACON server (HTTP transport)
 *
 * Honest scope:
 *   - PURE FUNCTION HTML emitter. Single string returned.
 *   - No external CSS / JS / fonts — fully self-contained.
 *   - All user-supplied text HTML-escaped (defends against the v2.19.31
 *     XSS-via-payload class — reuses beacon's escape logic).
 *   - 24/7 safe: empty / missing fields render placeholders, never throw.
 */

const PROTOCOL_VERSION = 1 as const;

export interface HandoffPwaInput {
  /** Markdown body to embed (output of renderForChildVendor). */
  body: string;
  /** Pair code (e.g. "ZOZ-CAT") for display. */
  pairCode: string;
  /** SAS emoji array (4 emoji) for MITM verification. */
  sasEmoji: string[];
  /** ms until pair-code expires (display countdown). */
  expiresInMs: number;
  /** Optional title above the page. */
  title?: string;
  /** Optional parent device id for display. */
  parentDeviceId?: string;
  /** Optional list of vendor app names to offer "Share to" buttons for. */
  shareTargets?: string[];
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[c]!));
}

const LS_RE = new RegExp(" ", "g");
const PS_RE = new RegExp(" ", "g");

function escapeJs(s: string): string {
  // For embedding into <script> string literal — escape backslash, quote,
  // line terminators (\n / \r / U+2028 / U+2029) and </ to prevent
  // </script> closure attack.
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(LS_RE, "\\u2028")
    .replace(PS_RE, "\\u2029")
    .replace(/<\//g, "<\\/");
}

/**
 * Render a self-contained HTML page the BEACON server can serve at
 * GET /pair/<code>. No external requests — works offline on LAN.
 */
export function generateHandoffPwaHtml(input: HandoffPwaInput): string {
  const title = escapeHtml(input.title ?? "Mneme Handoff");
  const pairCode = escapeHtml(input.pairCode);
  const emoji = (Array.isArray(input.sasEmoji) && input.sasEmoji.length === 4)
    ? input.sasEmoji.map(escapeHtml).join(" ")
    : "❓ ❓ ❓ ❓";
  const body = escapeJs(input.body ?? "");
  const parent = escapeHtml(input.parentDeviceId ?? "anonymous");
  const expiresIn = Number.isFinite(input.expiresInMs) ? Math.max(0, Math.floor(input.expiresInMs / 1000)) : 0;
  const shareTargets = (Array.isArray(input.shareTargets) && input.shareTargets.length > 0)
    ? input.shareTargets
    : ["Gemini", "ChatGPT", "Claude"];
  const shareTargetsJs = JSON.stringify(shareTargets.map(escapeJs));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<meta name="theme-color" content="#0f172a">
<title>${title}</title>
<style>
  :root {
    --bg: #0f172a;
    --card: #1e293b;
    --border: #334155;
    --text: #e2e8f0;
    --muted: #94a3b8;
    --accent: #22d3ee;
    --ok: #4ade80;
    --warn: #fbbf24;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--bg); color: var(--text); min-height: 100vh; padding: 16px; }
  .wrap { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 1.4rem; margin: 8px 0 4px; }
  .sub { color: var(--muted); font-size: 0.85rem; margin-bottom: 16px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px;
    padding: 16px; margin: 12px 0; }
  .pair { text-align: center; padding: 24px 16px; }
  .pair-code { font-size: 2.6rem; letter-spacing: 0.15em; font-weight: 700;
    color: var(--accent); margin: 8px 0; user-select: all; }
  .sas { font-size: 2.2rem; letter-spacing: 0.2em; margin: 8px 0; }
  .sas-label { color: var(--muted); font-size: 0.8rem; }
  .countdown { color: var(--warn); font-weight: 600; }
  .actions { display: grid; gap: 8px; margin-top: 12px; }
  .btn { display: block; padding: 14px 16px; border-radius: 10px; border: 1px solid var(--border);
    background: #0b1220; color: var(--text); text-decoration: none; cursor: pointer;
    font-size: 1rem; text-align: left; transition: background 0.15s; }
  .btn:hover { background: #172033; }
  .btn-primary { background: var(--accent); color: #001821; border-color: var(--accent); font-weight: 600; }
  .btn-primary:hover { filter: brightness(1.1); }
  .body-preview { background: #020617; border: 1px solid var(--border); border-radius: 8px;
    padding: 12px; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.8rem; white-space: pre-wrap; word-break: break-word; max-height: 260px;
    overflow-y: auto; }
  .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: var(--ok); color: #001821; padding: 12px 20px; border-radius: 8px;
    font-weight: 600; opacity: 0; transition: opacity 0.2s; pointer-events: none; }
  .toast.show { opacity: 1; }
  .footer { color: var(--muted); font-size: 0.75rem; text-align: center; margin-top: 24px; }
  .footer a { color: var(--accent); }
</style>
</head>
<body>
<div class="wrap">
  <h1>🧬 ${title}</h1>
  <div class="sub">From parent: <strong>${parent}</strong></div>

  <div class="card pair">
    <div class="sas-label">Verify parent &amp; child show SAME emoji:</div>
    <div class="sas">${emoji}</div>
    <div style="border-top: 1px solid var(--border); margin: 16px 0; padding-top: 12px;">
      <div class="sas-label">Pair code (one-shot):</div>
      <div class="pair-code">${pairCode}</div>
      <div>⏱ expires in <span class="countdown" id="countdown">${expiresIn}s</span></div>
    </div>
  </div>

  <div class="card">
    <h2 style="margin-top: 0;">Send the handoff to your AI tool</h2>
    <div class="actions" id="actions">
      <button class="btn" onclick="copyBody()">📋 Copy handoff to clipboard</button>
    </div>
  </div>

  <div class="card">
    <h2 style="margin-top: 0;">Preview</h2>
    <div class="body-preview" id="preview"></div>
  </div>

  <div class="footer">
    Mneme HANDOFF v${PROTOCOL_VERSION} · local-first · no external requests<br>
    <a href="https://www.npmjs.com/package/mneme-ai">npmjs.com/mneme-ai</a>
  </div>
</div>

<div class="toast" id="toast">Copied</div>

<script>
(function() {
  var BODY = '${body}';
  var PAIR_CODE = '${escapeJs(input.pairCode)}';
  var SHARE_TARGETS = ${shareTargetsJs};

  var pre = document.getElementById('preview');
  if (pre) pre.textContent = BODY;

  var sec = ${expiresIn};
  var cd = document.getElementById('countdown');
  var timer = setInterval(function() {
    sec--;
    if (cd) cd.textContent = sec + 's';
    if (sec <= 0) {
      clearInterval(timer);
      if (cd) { cd.textContent = 'EXPIRED'; cd.style.color = '#ef4444'; }
    }
  }, 1000);

  var ua = (navigator.userAgent || '').toLowerCase();
  var isAndroid = /android/.test(ua);
  var isIOS = /iphone|ipad|ipod/.test(ua);
  var isMobile = isAndroid || isIOS || /mobile/.test(ua);
  var isTablet = /tablet|ipad/.test(ua);
  var hasWebShare = typeof navigator.share === 'function';
  var hasClipboard = !!(navigator.clipboard && navigator.clipboard.writeText);

  var actions = document.getElementById('actions');
  if (actions) actions.innerHTML = '';

  function addBtn(label, onclick, primary) {
    var b = document.createElement('button');
    b.className = 'btn' + (primary ? ' btn-primary' : '');
    b.textContent = label;
    b.onclick = onclick;
    if (actions) actions.appendChild(b);
  }

  function showToast(msg, color) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    if (color) t.style.background = color;
    t.classList.add('show');
    setTimeout(function() { t.classList.remove('show'); }, 1800);
  }

  window.copyBody = function() {
    if (hasClipboard) {
      navigator.clipboard.writeText(BODY).then(function() {
        showToast('✓ Copied — paste into your AI tool');
      }).catch(function() {
        fallbackCopy();
      });
    } else {
      fallbackCopy();
    }
  };

  function fallbackCopy() {
    var ta = document.createElement('textarea');
    ta.value = BODY;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showToast('✓ Copied'); }
    catch (e) { showToast('Copy failed — long-press preview', '#ef4444'); }
    document.body.removeChild(ta);
  }

  if (isMobile && hasWebShare) {
    addBtn('📤 Share to AI app (Gemini / ChatGPT / Claude)', function() {
      navigator.share({
        title: 'Mneme Handoff',
        text: BODY,
      }).then(function() {
        showToast('✓ Shared');
      }).catch(function(err) {
        if (err && err.name === 'AbortError') return;
        showToast('Share failed — copy fallback', '#ef4444');
      });
    }, true);
  }

  if (!isMobile) {
    var deeplinks = [
      { label: '💻 Open in Cursor',     url: 'cursor://anysphere.cursor-deeplink/prompt?text=' + encodeURIComponent(BODY) },
      { label: '💻 Open in VS Code',    url: 'vscode://file//?text=' + encodeURIComponent(BODY) },
      { label: '💻 Open in Claude Code', url: 'claude-code://open?text=' + encodeURIComponent(BODY) },
      { label: '🧠 Open in Mneme CLI',   url: 'mneme://receive?code=' + encodeURIComponent(PAIR_CODE) },
    ];
    for (var i = 0; i < deeplinks.length; i++) {
      (function(d) {
        addBtn(d.label, function() {
          window.location.href = d.url;
          setTimeout(function() {
            showToast('Opened deep link — if nothing happened, click Copy below', '#fbbf24');
          }, 800);
        });
      })(deeplinks[i]);
    }
  }

  addBtn('💾 Download handoff.json', function() {
    var blob = new Blob([BODY], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'mneme-handoff-' + PAIR_CODE + '.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('✓ Downloaded');
  });

  addBtn('📋 Copy to clipboard', window.copyBody, !isMobile);
})();
</script>
</body>
</html>`;
}

export interface PwaStats {
  htmlBytes: number;
  hasEmoji: boolean;
  embeddedBodyBytes: number;
}

export function computePwaStats(input: HandoffPwaInput, html: string): PwaStats {
  return {
    htmlBytes: html.length,
    hasEmoji: Array.isArray(input.sasEmoji) && input.sasEmoji.length === 4,
    embeddedBodyBytes: (input.body ?? "").length,
  };
}

export const HANDOFF_PWA_TUNABLES = Object.freeze({
  PROTOCOL_VERSION,
});
