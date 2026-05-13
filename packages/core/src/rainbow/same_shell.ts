/**
 * v1.92.0 -- RAINBOW: SAME-SHELL (same-machine 1-click clone).
 *
 * The forgotten case: when the user is on ONE machine running editor AI
 * (Cursor / Claude Code) AND wants to continue with Web AI (ChatGPT.com,
 * Gemini.com) in a browser ON THE SAME machine, the existing RAINBOW
 * path forces them through QR → tunnel → phone scan → page → copy →
 * back to PC → paste. Eight steps for a zero-network handoff.
 *
 * SAME-SHELL collapses this to two steps:
 *
 *   1. Editor AI:  mneme.rainbow.show_local()
 *      → opens default browser at http://localhost:PORT
 *      → page auto-copies soul to clipboard on load
 *
 *   2. User opens chatgpt.com/gemini.com/claude.ai (link on page),
 *      Ctrl+V, done.
 *
 * Zero QR. Zero tunnel. Zero dpaste. Zero risk of 404 because no
 * external network is involved at all. THIS IS THE FASTEST PATH AND
 * THE LEAST FRAGILE -- but we never told the user it existed.
 */

export interface SameShellPageInput {
  soulText: string;
  /** Port the local HTTP server is on. Used in the URL displayed for context. */
  port: number;
  defaultLang?: "en" | "th";
  /** If set, the page shows a return-pad textarea posting to `${returnEndpoint}`. */
  returnEndpoint?: string;
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

/** Render the same-machine page. Single big COPY button + auto-clipboard
 *  on load + four AI deep-links. */
export function renderSameShellPage(input: SameShellPageInput): string {
  const lang = input.defaultLang ?? "en";
  const port = Math.max(1, Math.floor(input.port));
  const returnEndpoint = input.returnEndpoint ?? null;

  return `<!doctype html><html lang="${lang}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mneme — Clone to another AI on this PC</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,"Segoe UI",sans-serif;background:linear-gradient(135deg,#16a085 0%,#2c3e50 100%);color:#fff;min-height:100vh;padding:32px 24px}
.wrap{max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:22px}
.lang-btn{position:fixed;top:14px;right:14px;background:rgba(0,0,0,0.4);border:0;color:#fff;padding:10px 18px;border-radius:8px;font-weight:700;cursor:pointer}
h1{font-size:38px;text-align:center;font-weight:800}
.tagline{font-size:19px;opacity:0.92;text-align:center;line-height:1.5}
.copy-btn{background:#fff;color:#16a085;border:0;padding:28px;border-radius:18px;font-weight:800;font-size:24px;cursor:pointer;box-shadow:0 14px 30px rgba(0,0,0,0.4);width:100%}
.copy-btn:active{transform:scale(0.98)}
.copy-btn.done{background:#27ae60;color:#fff}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.grid a{display:flex;flex-direction:column;align-items:center;gap:6px;background:rgba(255,255,255,0.18);padding:22px 14px;border-radius:14px;text-decoration:none;color:#fff;font-weight:700;font-size:17px;border:2px solid rgba(255,255,255,0.1)}
.grid a:hover{background:rgba(255,255,255,0.28);border-color:rgba(255,255,255,0.4)}
.grid a span.hint{font-size:12px;opacity:0.7;font-weight:500}
.matrix{background:rgba(0,0,0,0.3);padding:22px;border-radius:14px;font-size:15px;line-height:1.6}
.matrix h3{font-size:19px;margin-bottom:12px}
.matrix table{width:100%;border-collapse:collapse;font-size:14px}
.matrix td{padding:8px 4px;border-bottom:1px solid rgba(255,255,255,0.15)}
.matrix td:last-child{text-align:center;font-weight:700;width:42px}
.return-pad{background:rgba(0,0,0,0.4);padding:22px;border-radius:14px;display:flex;flex-direction:column;gap:14px}
.return-pad h3{font-size:20px}
.return-pad textarea{width:100%;min-height:140px;padding:14px;border-radius:10px;border:0;font-family:monospace;font-size:13px;background:rgba(255,255,255,0.95);color:#222}
.return-pad button{background:#9b59b6;color:#fff;border:0;padding:18px;border-radius:12px;font-weight:800;font-size:18px;cursor:pointer}
.return-pad button:active{transform:scale(0.98)}
.return-pad .status{font-size:14px;opacity:0.9;text-align:center}
footer{font-size:13px;opacity:0.7;text-align:center;line-height:1.6}
</style></head><body>
<button class="lang-btn" id="lang">ไทย</button>
<div class="wrap">
<h1 data-en="🧬 Clone to another AI on this PC" data-th="🧬 Clone ไป AI ตัวอื่นบนเครื่องนี้"></h1>
<div class="tagline" data-en="Brain already copied to clipboard. Click an AI below, paste (Ctrl+V), continue." data-th="ความจำก๊อปลง clipboard แล้ว. กด AI ข้างล่าง, paste (Ctrl+V), คุยต่อได้เลย"></div>
<button class="copy-btn" id="c" data-en="📋 Copy brain again" data-th="📋 ก๊อปสมองอีกครั้ง"></button>
<div class="grid">
  <a href="https://chatgpt.com/" target="_blank" id="lk-cg">🟢 <span>ChatGPT</span><span class="hint" data-en="opens in new tab" data-th="เปิด tab ใหม่"></span></a>
  <a href="https://gemini.google.com/app" target="_blank" id="lk-gm">🔵 <span>Gemini</span><span class="hint" data-en="opens in new tab" data-th="เปิด tab ใหม่"></span></a>
  <a href="https://claude.ai/new" target="_blank" id="lk-cl">🟣 <span>Claude</span><span class="hint" data-en="opens in new tab" data-th="เปิด tab ใหม่"></span></a>
  <a href="https://www.perplexity.ai/" target="_blank" id="lk-pp">⚪ <span>Perplexity</span><span class="hint" data-en="opens in new tab" data-th="เปิด tab ใหม่"></span></a>
</div>
<div class="matrix">
  <h3 data-en="🎯 Paste-only — what works / what doesn't" data-th="🎯 Paste-only ใช้ทำอะไรได้/ไม่ได้"></h3>
  <table>
    <tr><td data-en="On a train, only have your phone" data-th="อยู่บนรถไฟ มีแค่มือถือ"></td><td>✅</td></tr>
    <tr><td data-en="Switch models for a second opinion" data-th="อยากเปลี่ยน model ดู second opinion"></td><td>✅</td></tr>
    <tr><td data-en="Share with a teammate (PM, designer)" data-th="ส่งให้เพื่อน/PM/designer คุยต่อ"></td><td>✅</td></tr>
    <tr><td data-en="Backup the whole conversation" data-th="Backup บทสนทนา"></td><td>✅</td></tr>
    <tr><td data-en="Brainstorm with the best model per task" data-th="Brainstorm กับ model ที่เก่งสุดต่อ task"></td><td>✅</td></tr>
    <tr><td data-en="Call Mneme tools (apoptosis / scan / audit)" data-th="เรียก Mneme tools (apoptosis / scan / audit)"></td><td>❌</td></tr>
    <tr><td data-en="Read .mneme/ files on your PC" data-th="อ่าน .mneme/ บน PC"></td><td>❌</td></tr>
    <tr><td data-en="Upgrade Mneme / install" data-th="อัปเกรด Mneme / install"></td><td>❌</td></tr>
    <tr><td data-en="Modify your code" data-th="แก้ code ของคุณ"></td><td>❌</td></tr>
  </table>
  <div style="margin-top:14px;padding:12px;background:rgba(255,255,255,0.1);border-radius:8px;font-size:13px;line-height:1.6">
    <span data-en="✱ The Web AI can SUGGEST next actions back via HOMUNCULUS RETURN block. Paste that back below, your editor AI executes it. Web AI = brain. Editor AI = hands. You = courier (2 paste ops)." data-th="✱ Web AI สามารถ SUGGEST next actions กลับมาเป็น HOMUNCULUS RETURN block ได้. paste กลับช่องล่าง editor AI ของคุณจะ execute. Web AI = สมอง. Editor AI = มือ. คุณ = courier (paste 2 ครั้ง)"></span>
  </div>
</div>
${returnEndpoint ? `<div class="return-pad">
  <h3 data-en="🪃 BOOMERANG — paste the Web AI reply back here" data-th="🪃 BOOMERANG — paste คำตอบ Web AI กลับมาตรงนี้"></h3>
  <div style="font-size:14px;opacity:0.92;line-height:1.5" data-en="Paste the Web AI's full reply (must include the HOMUNCULUS RETURN block). Your editor AI on this PC will pick it up via Mneme MCP and surface next_actions for execution." data-th="paste คำตอบ Web AI ทั้งหมด (ต้องมี HOMUNCULUS RETURN block). editor AI บนเครื่องนี้จะรับผ่าน Mneme MCP แล้วโชว์ next_actions ให้ execute"></div>
  <textarea id="rp" placeholder="# HOMUNCULUS RETURN&#10;originator: claude-opus-4-7&#10;returning_from: gemini-2.5-pro&#10;..."></textarea>
  <button id="rb" data-en="🪃 Send back to editor AI" data-th="🪃 ส่งกลับ editor AI"></button>
  <div class="status" id="rs"></div>
</div>` : ""}
<footer>
  <span data-en="localhost:${port} · same-machine handoff · no QR, no tunnel, no network needed" data-th="localhost:${port} · ส่งผ่านเครื่องเดียวกัน · ไม่ต้องใช้ QR / tunnel / network"></span>
</footer>
</div>
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

async function copySoul(showToast) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(SOUL);
    } else { throw new Error("no clipboard api"); }
    const c = document.getElementById("c");
    c.classList.add("done");
    c.textContent = lang === "th" ? "✓ ก๊อปแล้ว — paste ได้เลย" : "✓ Copied — ready to paste";
    if (showToast === false) return;
    setTimeout(() => {
      c.classList.remove("done");
      c.textContent = lang === "th" ? "📋 ก๊อปสมองอีกครั้ง" : "📋 Copy brain again";
    }, 3500);
  } catch (e) {
    const c = document.getElementById("c");
    c.textContent = lang === "th" ? "❌ ก๊อปไม่ได้ — กดที่ textarea ข้างล่าง → Select All → Copy" : "❌ Copy failed — use the textarea below";
  }
}
copySoul(false);
document.getElementById("c").onclick = () => copySoul(true);
${["cg","gm","cl","pp"].map(k => `document.getElementById("lk-${k}").addEventListener("click", () => copySoul(false));`).join("\n")}
${returnEndpoint ? `
const RETURN_URL = ${jsSafe(returnEndpoint)};
document.getElementById("rb").onclick = async () => {
  const body = document.getElementById("rp").value;
  if (!body.trim()) {
    document.getElementById("rs").textContent = lang === "th" ? "⚠ ใส่ HOMUNCULUS RETURN block ก่อน" : "⚠ paste a HOMUNCULUS RETURN block first";
    return;
  }
  document.getElementById("rs").textContent = lang === "th" ? "⏳ กำลังส่ง..." : "⏳ sending...";
  try {
    const r = await fetch(RETURN_URL, { method: "POST", headers: { "content-type": "text/plain;charset=utf-8" }, body });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) {
      document.getElementById("rs").textContent = lang === "th" ? ("✓ ส่งถึง editor AI แล้ว — id=" + j.id) : ("✓ delivered to editor AI — id=" + j.id);
      document.getElementById("rp").value = "";
    } else {
      document.getElementById("rs").textContent = lang === "th" ? ("✗ ไม่สำเร็จ: " + (j.error || r.status)) : ("✗ failed: " + (j.error || r.status));
    }
  } catch (e) {
    document.getElementById("rs").textContent = lang === "th" ? ("✗ network: " + e.message) : ("✗ network: " + e.message);
  }
};
` : ""}
</script>
</body></html>`;
}
