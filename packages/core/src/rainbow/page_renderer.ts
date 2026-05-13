/**
 * v1.91.0 -- RAINBOW: PC + mobile page renderers.
 *
 * Was previously inline JS inside `.brain-show*.mjs` scripts. v1.91
 * promotes them into proper, testable, reusable modules.
 *
 *   renderMobilePage({ soulText, lang })
 *     → HTML page served from LAN/tunnel; phone scans → opens here
 *     → green Share button + blue Copy button (3-tier fallback)
 *     → bilingual EN/TH toggle
 *     → honest capability matrix (paste vs editor-AI MCP truth)
 *
 *   renderPcPage({ primaryUrl, label, note, soulTokens, hasTunnel })
 *     → Page that opens in PC default browser
 *     → ONE big primary QR (no second-QR confusion)
 *     → STOP button (no Ctrl+C jargon)
 *     → bilingual toggle
 *
 * Both pages: zero external CSS/JS deps. Single-file output.
 */

export interface MobilePageInput {
  soulText: string;
  /** Optional override for default lang. Default "en" with toggle. */
  defaultLang?: "en" | "th";
}

export interface PcPageInput {
  primaryUrl: string;
  /** Channel label (e.g. "Same Wi-Fi · 1 tap" / "Works ANYWHERE · 1 tap"). */
  label: { en: string; th: string };
  /** Channel note (e.g. "Phone MUST be on the SAME WiFi"). */
  note: { en: string; th: string };
  /** Soul prompt size in tokens (for footer). */
  soulTokens: number;
  /** True if cloudflared tunnel is in use (footer mention). */
  hasTunnel: boolean;
  /** True if a paste fallback exists. */
  hasPaste: boolean;
  defaultLang?: "en" | "th";
}

function jsSafe(s: string): string {
  return JSON.stringify(s).replace(/<\/(script)/gi, "<\\/$1");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildQrUrl(payload: string, size = 360): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&format=svg&margin=10&data=${encodeURIComponent(payload)}`;
}

export function renderMobilePage(input: MobilePageInput): string {
  const lang = input.defaultLang ?? "en";
  return `<!doctype html><html lang="${lang}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mneme</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,sans-serif;background:#1abc9c;color:#fff;min-height:100vh;padding:24px 18px}
.wrap{max-width:540px;margin:0 auto;display:flex;flex-direction:column;gap:18px}
h1{font-size:32px;text-align:center;font-weight:800}
.lang{position:fixed;top:14px;right:14px;background:rgba(0,0,0,0.4);border:0;color:#fff;padding:10px 16px;border-radius:8px;font-weight:700;cursor:pointer;font-size:15px}
.btn{width:100%;background:#fff;color:#16a085;border:0;padding:24px;border-radius:14px;font-weight:800;font-size:22px;cursor:pointer;box-shadow:0 8px 20px rgba(0,0,0,0.3)}
.btn:active{transform:scale(0.97)}
.btn.blue{background:#3498db;color:#fff}
.step{background:rgba(0,0,0,0.25);padding:18px;border-radius:12px;font-size:18px;line-height:1.6}
.matrix{background:rgba(0,0,0,0.3);padding:18px;border-radius:12px;font-size:14px;line-height:1.6}
.matrix h3{font-size:17px;margin-bottom:10px}
.matrix table{width:100%;border-collapse:collapse}
.matrix td{padding:8px 4px;border-bottom:1px solid rgba(255,255,255,0.15)}
.matrix td:last-child{text-align:center;font-weight:700}
.ok{display:none;background:#27ae60;padding:18px;border-radius:12px;text-align:center;font-weight:800;font-size:17px}
textarea{width:100%;height:1px;opacity:0;position:absolute;left:-9999px}
.preview{background:rgba(0,0,0,0.4);padding:14px;border-radius:8px;font-family:monospace;font-size:11px;line-height:1.4;max-height:140px;overflow:auto;white-space:pre-wrap;word-break:break-word;-webkit-user-select:all;user-select:all}
details summary{cursor:pointer;padding:14px;background:rgba(0,0,0,0.25);border-radius:10px;font-weight:700;font-size:16px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.grid a{display:block;background:rgba(255,255,255,0.18);padding:16px;border-radius:10px;text-align:center;text-decoration:none;color:#fff;font-weight:700;font-size:15px}
</style></head><body>
<button class="lang" id="lang">ไทย</button>
<div class="wrap">
<h1 data-en="Mneme handoff" data-th="ส่งสมอง Mneme"></h1>
<div class="step" data-en="Tap GREEN to send. If share menu doesn't appear, tap BLUE COPY then paste in any AI." data-th="กดปุ่มเขียวเพื่อส่ง. ถ้าไม่มี share menu ขึ้น กด COPY สีฟ้าแล้ว paste ใน AI"></div>
<button id="s" class="btn">📤 Send to AI app</button>
<div id="ok" class="ok" data-en="✓ Sent! Open your AI to check." data-th="✓ ส่งแล้ว เปิด AI ดู"></div>
<button id="c" class="btn blue">📋 Copy soul prompt</button>
<details>
  <summary data-en="🔧 Backup: long-press to copy" data-th="🔧 สำรอง: กดค้างเพื่อก๊อป"></summary>
  <div style="padding:10px 0;font-size:14px" data-en="If both buttons fail, long-press the box → Select All → Copy:" data-th="ถ้าปุ่มทั้งสองไม่ work กดค้างกล่องล่าง → Select All → Copy:"></div>
  <div class="preview" id="prev"></div>
</details>
<div class="grid">
  <a href="https://chatgpt.com/" target="_blank">🟢 ChatGPT</a>
  <a href="https://gemini.google.com/app" target="_blank">🔵 Gemini</a>
  <a href="https://claude.ai/new" target="_blank">🟣 Claude</a>
  <a href="https://www.perplexity.ai/" target="_blank">⚪ Perplexity</a>
</div>
<div class="matrix">
  <h3 data-en="🎯 What this AI can do AFTER you paste" data-th="🎯 หลัง paste แล้ว AI ทำอะไรได้บ้าง"></h3>
  <table>
    <tr><td data-en="Read this conversation" data-th="อ่านบทสนทนานี้"></td><td>✅</td></tr>
    <tr><td data-en="Continue discussing it" data-th="คุยต่อจากเดิม"></td><td>✅</td></tr>
    <tr><td data-en="Understand recent decisions" data-th="เข้าใจการตัดสินใจล่าสุด"></td><td>✅</td></tr>
    <tr><td data-en="Suggest next actions back" data-th="เสนอ next actions กลับมา"></td><td>✅</td></tr>
    <tr><td data-en="Call Mneme MCP tools (live)" data-th="เรียก MCP tools จริง"></td><td>❌</td></tr>
    <tr><td data-en="Read your .mneme/ files" data-th="อ่านไฟล์ .mneme/ บน PC"></td><td>❌</td></tr>
    <tr><td data-en="True real-time sync" data-th="sync แบบ real-time จริง"></td><td>❌</td></tr>
  </table>
  <div style="margin-top:12px;padding:12px;background:rgba(255,255,255,0.1);border-radius:8px;font-size:13px;line-height:1.5">
    <span data-en="The soul prompt gives the AI MEMORY (read-only). The HOMUNCULUS request inside it asks the AI to emit a HOMUNCULUS RETURN block with suggestions you paste BACK to your editor AI for execution. Web AI = brain. Editor AI = hands. You = courier." data-th="soul prompt ให้ AI เห็น MEMORY (อ่านอย่างเดียว). HOMUNCULUS request ที่อยู่ในนั้นจะขอให้ AI ตอบกลับเป็น HOMUNCULUS RETURN block ที่คุณ paste กลับไป editor AI เพื่อ execute. Web AI = สมอง. Editor AI = มือ. คุณ = courier"></span>
  </div>
</div>
</div>
<textarea id="ta"></textarea>
<script>
const SOUL = ${jsSafe(input.soulText)};
let lang = ${JSON.stringify(lang)};
function applyLang() {
  document.querySelectorAll("[data-en]").forEach(el => { el.textContent = el.dataset[lang] || el.dataset.en; });
  document.getElementById("lang").textContent = lang === "en" ? "ไทย" : "EN";
  document.documentElement.lang = lang;
}
applyLang();
document.getElementById("lang").onclick = () => { lang = lang === "en" ? "th" : "en"; applyLang(); };
document.getElementById("prev").textContent = SOUL;
document.getElementById("ta").value = SOUL;
document.getElementById("s").onclick = async () => {
  if (navigator.share) {
    try { await navigator.share({ text: SOUL, title: "Mneme" }); document.getElementById("ok").style.display = "block"; return; }
    catch (e) {}
  }
  copySoul();
};
function copySoul() {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(SOUL).then(() => {
      document.getElementById("c").textContent = lang === "th" ? "✓ ก๊อปแล้ว เปิด AI app paste เลย" : "✓ Copied! Open AI app and paste.";
    }).catch(() => fallbackCopy());
  } else { fallbackCopy(); }
}
function fallbackCopy() {
  const ta = document.getElementById("ta");
  ta.value = SOUL; ta.style.opacity = "1"; ta.style.position = "static"; ta.style.height = "60px"; ta.style.left = "0";
  ta.focus(); ta.select(); ta.setSelectionRange(0, SOUL.length);
  try {
    if (document.execCommand("copy")) {
      document.getElementById("c").textContent = lang === "th" ? "✓ ก๊อปแล้ว" : "✓ Copied!";
      ta.style.opacity = "0"; ta.style.position = "absolute"; ta.style.height = "1px"; ta.style.left = "-9999px";
      return;
    }
  } catch (e) {}
  document.getElementById("c").textContent = lang === "th" ? "⬇ กดค้างกล่อง → Select All → Copy" : "⬇ Long-press box → Select All → Copy";
}
document.getElementById("c").onclick = copySoul;
</script></body></html>`;
}

export function renderPcPage(input: PcPageInput): string {
  const lang = input.defaultLang ?? "en";
  const labelEn = escapeHtml(input.label.en);
  const labelTh = escapeHtml(input.label.th);
  const noteEn = escapeHtml(input.note.en);
  const noteTh = escapeHtml(input.note.th);
  const url = escapeHtml(input.primaryUrl);
  const tunnelMention = input.hasTunnel ? "Cloudflare tunnel + " : "";
  const pasteMention = input.hasPaste ? " · paste fallback" : "";

  return `<!doctype html><html lang="${lang}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mneme — Send brain to phone</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,"Segoe UI",sans-serif;background:linear-gradient(135deg,#1abc9c 0%,#16a085 50%,#2c3e50 100%);color:#fff;min-height:100vh;padding:32px 24px}
.wrap{max-width:760px;margin:0 auto;display:flex;flex-direction:column;align-items:center;gap:28px}
.lang-btn,.stop-btn{position:fixed;top:18px;background:rgba(0,0,0,0.4);border:0;color:#fff;padding:12px 20px;border-radius:10px;font-weight:700;font-size:16px;cursor:pointer;z-index:99}
.lang-btn{right:18px}
.stop-btn{right:130px;background:#c0392b}
.stop-btn:hover{background:#e74c3c}
h1{font-size:46px;text-align:center;font-weight:800}
.tagline{font-size:22px;opacity:0.92;text-align:center;line-height:1.5;max-width:600px}
.primary{background:rgba(255,255,255,0.1);border:2px solid rgba(255,255,255,0.25);border-radius:24px;padding:32px;display:flex;flex-direction:column;align-items:center;gap:18px;width:100%;max-width:520px;box-shadow:0 24px 70px rgba(0,0,0,0.4)}
.pill{display:inline-block;background:#27ae60;padding:10px 22px;border-radius:99px;font-size:18px;font-weight:800}
h2{font-size:32px;text-align:center}
.qr-box{background:#fff;padding:22px;border-radius:18px}
.qr-box img{display:block;width:320px;height:320px}
.url{font-family:monospace;font-size:16px;background:rgba(0,0,0,0.35);padding:12px 18px;border-radius:8px;word-break:break-all;text-align:center;max-width:100%}
.note{font-size:20px;text-align:center;line-height:1.5;opacity:0.95}
.howto{background:rgba(0,0,0,0.3);border-radius:14px;padding:22px;font-size:19px;line-height:1.7;width:100%;max-width:600px}
.howto h3{font-size:22px;margin-bottom:12px}
.howto ol{padding-left:28px}
.howto li{margin:8px 0}
.warn-soft{background:rgba(241,196,15,0.2);border:1px solid rgba(241,196,15,0.4);padding:18px;border-radius:12px;font-size:17px;line-height:1.5;text-align:center;max-width:600px}
.stop-help{background:rgba(0,0,0,0.35);padding:16px;border-radius:12px;font-size:14px;line-height:1.6;max-width:600px}
.stop-help h4{font-size:16px;margin-bottom:8px}
footer{font-size:14px;opacity:0.7;text-align:center;line-height:1.6;max-width:700px;padding:16px;background:rgba(0,0,0,0.2);border-radius:10px}
</style></head><body>
<button class="lang-btn" id="lang">ไทย</button>
<button class="stop-btn" id="stop" data-en="🛑 STOP" data-th="🛑 หยุด"></button>
<div class="wrap">
<h1 data-en="Send brain to phone" data-th="ส่งสมองไปมือถือ"></h1>
<div class="tagline" data-en="Open your phone camera. Scan the QR. Tap the link. Tap green button." data-th="เปิดกล้องมือถือ → สแกน QR → กดที่ link → กดปุ่มเขียว"></div>
<div class="primary">
  <span class="pill" data-en="${labelEn}" data-th="${labelTh}"></span>
  <h2 data-en="Scan this QR" data-th="สแกน QR นี้"></h2>
  <div class="qr-box"><img src="${escapeHtml(buildQrUrl(input.primaryUrl, 360))}" alt=""></div>
  <div class="url">${url}</div>
  <div class="note" data-en="${noteEn}" data-th="${noteTh}"></div>
</div>
<div class="howto">
  <h3 data-en="📱 What happens after you scan" data-th="📱 หลังสแกน QR จะเกิดอะไรขึ้น"></h3>
  <ol>
    <li data-en="Phone camera shows the URL — tap it." data-th="กล้องมือถือแสดง URL — กดที่ URL"></li>
    <li data-en="Mobile browser opens a page with a green button + capability matrix." data-th="เบราว์เซอร์เปิดหน้าเว็บที่มีปุ่มเขียว + ตารางความสามารถ"></li>
    <li data-en="Tap green → pick AI app from share menu → tap send." data-th="กดปุ่มเขียว → เลือก AI app จาก share menu → กด send"></li>
    <li data-en="If share menu doesn't appear, tap blue COPY → open AI app → paste." data-th="ถ้าไม่มี share menu ขึ้น กด COPY สีฟ้า → เปิด AI app → paste"></li>
  </ol>
</div>
<div class="warn-soft">
  <span data-en="⚠ Honest truth: paste gives the AI READ-ONLY memory. For LIVE Mneme tool execution that AI must have Mneme installed (Cursor / Claude Code / Codex / VS Code MCP). Web AIs (chatgpt.com, gemini.com) read but can NOT call MCP. They CAN suggest next actions back via HOMUNCULUS RETURN block — paste it back to your editor AI to execute." data-th="⚠ ความจริง: paste ให้ AI เห็น MEMORY แบบอ่านอย่างเดียว. ถ้าจะให้ AI เรียก Mneme tools จริง AI ตัวนั้นต้องติดตั้ง Mneme (Cursor / Claude Code / Codex / VS Code MCP). Web AIs อ่านได้แต่เรียก MCP ไม่ได้. แต่มัน suggest next actions กลับมาเป็น HOMUNCULUS RETURN block ได้ — paste กลับไป editor AI เพื่อ execute"></span>
</div>
<div class="stop-help">
  <h4 data-en="🛑 What the STOP button does" data-th="🛑 ปุ่ม STOP ทำอะไร"></h4>
  <div data-en="Press STOP when you're DONE. It shuts down: (1) the local LAN server on this PC, (2) the public tunnel (if any), and (3) makes this page stop working. The QR will 404." data-th="กด STOP ตอนเสร็จแล้ว — มันจะปิด: (1) LAN server บน PC, (2) public tunnel (ถ้ามี), (3) หน้านี้จะใช้ไม่ได้แล้ว และ QR จะ 404"></div>
  <div style="margin-top:8px" data-en="If you DON'T press STOP: server keeps running until you close this terminal or reboot. That's fine — it's local only. Public quick-tunnels self-expire after ~30 min of idle anyway." data-th="ถ้าไม่กด STOP: server จะรันไปเรื่อยๆ จนกว่าจะปิด terminal หรือ reboot. ไม่อันตราย เพราะเป็น local only. ส่วน quick-tunnel จะตายเองหลัง idle ~30 นาที"></div>
  <div style="margin-top:8px" data-en="Closed the browser by accident? Just say to your editor AI: 'show handoff again'. The page regenerates with a fresh URL." data-th="เผลอปิด browser ไปแล้ว? บอก editor AI ของคุณ: 'show handoff again' หน้าจะ generate ใหม่พร้อม URL ใหม่"></div>
</div>
<footer>
  <span data-en="Soul ${input.soulTokens} tokens · ${tunnelMention}LAN :7741${pasteMention}" data-th="สมอง ${input.soulTokens} โทเค็น · ${tunnelMention}LAN :7741${pasteMention}"></span><br>
  <span data-en="Done? Click the red STOP button at top-right." data-th="เสร็จแล้ว? กดปุ่ม STOP สีแดงมุมขวาบน"></span>
</footer>
</div>
<script>
let lang = ${JSON.stringify(lang)};
function applyLang() {
  document.querySelectorAll("[data-en]").forEach(el => { el.textContent = el.dataset[lang] || el.dataset.en; });
  document.getElementById("lang").textContent = lang === "en" ? "ไทย" : "EN";
  document.documentElement.lang = lang;
}
applyLang();
document.getElementById("lang").onclick = () => { lang = lang === "en" ? "th" : "en"; applyLang(); };
document.getElementById("stop").onclick = async () => {
  if (!confirm(lang === "th" ? "หยุด server? หน้านี้จะใช้ไม่ได้แล้ว" : "Stop the server? This page will stop working.")) return;
  try { await fetch(${jsSafe(input.primaryUrl)} + "/stop"); } catch (e) {}
  document.body.innerHTML = '<div style="padding:60px;text-align:center;font-size:24px;color:#fff;background:#16a085;min-height:100vh">' + (lang === "th" ? "✓ Server หยุดแล้ว ปิด tab นี้ได้" : "✓ Server stopped. You can close this tab.") + '</div>';
};
</script>
</body></html>`;
}
