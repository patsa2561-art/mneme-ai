/**
 * `mneme pager` (v2.201.0) — Cosmic Pager: approve an agent's sensitive actions from your
 * phone (Telegram), lid closed. The 4-diamond CORE (signed authority · Trust-Tide · dead-man
 * · court-admissible receipts) lives in @mneme-ai/core; this is the I/O: config, the local
 * decision path (used by the agent hook), the Telegram long-poll loop, and best-effort
 * power "breathing". Behind NAT, the laptop reaches OUT to Telegram — NO server, NO public IP.
 */
import type { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, chmodSync, renameSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
/** The version on disk (the installed package.json) — used to self-heal a stale survivor daemon. */
function installedVersion(): string { try { return JSON.parse(readFileSync(join(dirname(process.argv[1] || ""), "..", "package.json"), "utf8")).version || ""; } catch { return ""; } }
import { spawn, spawnSync } from "node:child_process";
import * as https from "node:https";
import * as http from "node:http";
import { pager, notary, preflight, keryx, live, opGrant } from "@mneme-ai/core";
import { createHmac as _hmac } from "node:crypto";
import { sendAsk, clearMessage, type ProviderCfg } from "./keryx_providers.js";

function out(s: string): void { process.stdout.write(s + "\n"); }

/** The computer surface — a tiny local approval page (127.0.0.1 only). Approve/reject right on the
 *  machine you're sitting at, in parallel with your phone; the first tap wins, the rest clear. */
const PAGER_UI_HTML = `<!doctype html><meta charset=utf-8><title>Mneme — approvals</title><meta name=viewport content="width=device-width,initial-scale=1">
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:640px;margin:24px auto;padding:0 16px;color:#1a1a1a;background:#fafafa}h1{font-size:18px}.card{border:1px solid #e3e3e3;border-radius:12px;padding:14px 16px;margin:12px 0;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.05)}.muted{color:#888;font-size:13px}.b{display:inline-block;margin:8px 8px 0 0;padding:9px 18px;border-radius:9px;border:0;font-weight:600;cursor:pointer;color:#fff}.y{background:#16a34a}.n{background:#dc2626}.c{background:#2563eb}.empty{color:#999;text-align:center;margin-top:40px}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#16a34a;margin-right:6px;animation:p 1.4s infinite}@keyframes p{50%{opacity:.3}}</style>
<h1><span class=dot></span>Mneme approvals <span class=muted>· this computer</span></h1><div id=app class=empty>loading…</div>
<script>
async function load(){try{const r=await fetch('/pager/pending');const {pending}=await r.json();const a=document.getElementById('app');
if(!pending.length){a.className='empty';a.innerHTML='✓ nothing waiting — your agent is clear.';return}
a.className='';a.innerHTML=pending.map(p=>{const ico=p.blast==='destructive'?'🟠':p.blast==='moderate'?'🟡':'🟢';
const btns=p.kind==='approve'?'<button class="b y" onclick="decide(\\''+p.id+'\\',\\'allow\\')">✅ Approve</button><button class="b n" onclick="decide(\\''+p.id+'\\',\\'deny\\')">⛔ Reject</button>':p.kind==='choice'?p.choices.map(c=>'<button class="b c" onclick="decide(\\''+p.id+'\\',\\''+c.replace(/'/g,"")+'\\')">'+c+'</button>').join(''):'<input id="t_'+p.id+'" placeholder="type your answer" style="padding:8px;width:60%"><button class="b c" onclick="decide(\\''+p.id+'\\',document.getElementById(\\'t_'+p.id+'\\').value)">Send</button>';
return '<div class=card>'+ico+' <b>'+p.agent+'</b><div>'+p.summary+'</div><div class=muted>'+p.kind+' · '+p.blast+'</div>'+btns+'</div>'}).join('')}catch(e){}}
async function decide(id,answer){await fetch('/pager/decide',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,answer})});load()}
load();setInterval(load,1500);
</script>`;
/** Claude Code delivers PreToolUse input as JSON on STDIN (tool_input.command, session_id) —
 *  NOT via env vars. Read it synchronously (the hook pipes it + closes stdin). */
function readHookStdin(): { command?: string; session?: string; toolName?: string } | null {
  try {
    if (process.stdin.isTTY) return null;                 // manual run, no piped hook JSON
    const raw = readFileSync(0, "utf8");                  // fd 0 = stdin, read to EOF
    if (!raw.trim()) return null;
    const j = JSON.parse(raw) as { tool_input?: { command?: string }; session_id?: string; tool_name?: string };
    return { command: j?.tool_input?.command, session: j?.session_id, toolName: j?.tool_name };
  } catch { return null; }
}
/** Resolve the REAL binary for a command (skipping our shim dir), baked into the shim at install. */
function resolveRealBinary(cmd: string, shimDir: string): string | null {
  try {
    const isWin = process.platform === "win32";
    const r = spawnSync(isWin ? "where" : "command", isWin ? [cmd] : ["-v", cmd], { encoding: "utf8", shell: !isWin });
    const lines = String(r.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    for (const p of lines) { if (!p.toLowerCase().startsWith(shimDir.toLowerCase())) return p; }   // skip the shim itself
    return null;
  } catch { return null; }
}
const dir = (cwd: string) => join(cwd, ".mneme", "pager");
const cfgPath = (cwd: string) => join(dir(cwd), "config.json");
const statePath = (cwd: string) => join(dir(cwd), "state.json");

interface PagerConfig { telegramToken?: string; chatId?: string; mode?: string; wakeIntervalMin?: number; ttlMs?: number; lineToken?: string; lineTo?: string; httpPort?: number; attend?: string; keryxRelay?: string }
interface PagerState { trust: pager.TrustState; pendings: PagerPending[]; usedNonces: string[]; receipts: pager.ApprovalReceipt[]; decisions?: pager.HumanDecisionRecord[]; answers?: Record<string, string>; speculative?: Record<string, preflight.SpeculativeEntry>; classStats?: Record<string, { seen: number; succeeded: number; recentFails: number }>; surfaces?: Record<string, Array<{ provider: string; messageId: string }>>; clearedSurfaces?: Record<string, string[]> }
type PagerPending = pager.Pending & { tgMessageId?: number };

const loadCfg = (cwd: string): PagerConfig => { try { return existsSync(cfgPath(cwd)) ? JSON.parse(readFileSync(cfgPath(cwd), "utf8")) : {}; } catch { return {}; } };
const loadState = (cwd: string): PagerState => { try { return existsSync(statePath(cwd)) ? JSON.parse(readFileSync(statePath(cwd), "utf8")) : { trust: pager.emptyTrust(), pendings: [], usedNonces: [], receipts: [], decisions: [], answers: {} }; } catch { return { trust: pager.emptyTrust(), pendings: [], usedNonces: [], receipts: [], decisions: [], answers: {} }; } };
const saveState = (cwd: string, s: PagerState): void => { mkdirSync(dir(cwd), { recursive: true }); const p = statePath(cwd); const tmp = p + "." + process.pid + ".tmp"; try { writeFileSync(tmp, JSON.stringify(s, null, 2), "utf8"); renameSync(tmp, p); } catch { writeFileSync(p, JSON.stringify(s, null, 2), "utf8"); } };
const hbPath = (cwd: string) => join(dir(cwd), "daemon.heartbeat");

/** Is the long-poll daemon alive? (it touches a heartbeat every poll cycle). */
function daemonAlive(cwd: string): boolean {
  try { if (!existsSync(hbPath(cwd))) return false; return Date.now() - Number(readFileSync(hbPath(cwd), "utf8")) < 90_000; } catch { return false; }
}
/** AUTOMATIC SELF-HEAL: if the daemon is down, spawn it detached. Returns true if alive/spawned. */
function ensureDaemon(cwd: string): boolean {
  if (daemonAlive(cwd)) return true;
  try { mkdirSync(dir(cwd), { recursive: true }); spawn(process.execPath, [process.argv[1], "pager", "start"], { cwd, stdio: "ignore", detached: true }).unref(); return true; } catch { return false; }
}

/** Deterministic blast classifier (heph can plug in later for the full gate). */
function classify(cmd: string): { blast: pager.Blast; klass: string } {
  const c = String(cmd).toLowerCase().trim();
  const klass = (c.split(/\s+/).slice(0, 2).join(" ") || "unknown").replace(/[^\w .-]/g, "");
  if (/\brm\s+-rf|\bdd\b|mkfs|:\s*\(\)\s*\{|drop\s+table|truncate\s+table|git\s+push\s+.*--force|--no-verify|shutdown|reboot|>\s*\/dev\/sd/.test(c)) return { blast: "destructive", klass };
  if (/\bgit\s+push\b|\bdeploy\b|\bnpm\s+publish\b|\bkubectl\b|terraform|\bcurl\b.*\|\s*(sh|bash)|chmod\s+-R/.test(c)) return { blast: "moderate", klass };
  return { blast: "safe", klass };
}

function tg(token: string, method: string, body: object): Promise<{ ok: boolean; result?: unknown }> {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = https.request({ hostname: "api.telegram.org", path: `/bot${token}/${method}`, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) }, timeout: 65_000 },
      (res) => { let buf = ""; res.on("data", (d) => (buf += d)); res.on("end", () => { try { resolve(JSON.parse(buf)); } catch { resolve({ ok: false }); } }); });
    req.on("error", () => resolve({ ok: false })); req.on("timeout", () => { req.destroy(); resolve({ ok: false }); });
    req.write(data); req.end();
  });
}

/** LINE push (outbound notify-mirror). Telegram stays the answer channel (buttons + long-poll
 *  behind NAT); LINE mirrors the text so LINE users get pinged too. Answer-back over LINE needs
 *  a webhook (a public endpoint via `gephyra serve` + a tunnel) — honest, not wired here. */
function linePush(cfg: PagerConfig, text: string): Promise<{ ok: boolean }> {
  if (!cfg.lineToken || !cfg.lineTo) return Promise.resolve({ ok: false });
  return new Promise((resolve) => {
    const data = JSON.stringify({ to: cfg.lineTo, messages: [{ type: "text", text: String(text).slice(0, 4900) }] });
    const r = https.request({ hostname: "api.line.me", path: "/v2/bot/message/push", method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${cfg.lineToken}`, "content-length": Buffer.byteLength(data) }, timeout: 15000 },
      (res) => { res.on("data", () => {}); res.on("end", () => resolve({ ok: (res.statusCode ?? 500) < 300 })); });
    r.on("error", () => resolve({ ok: false })); r.on("timeout", () => { r.destroy(); resolve({ ok: false }); });
    r.write(data); r.end();
  });
}
/** Fan a notification to every configured secondary channel (LINE today; extensible). */
function notifyMirror(cfg: PagerConfig, text: string): void { void linePush(cfg, text).catch(() => { /* best-effort */ }); }

// ── KERYX multi-chat: fan the SAME ask out to every configured provider (LINE/Slack/Discord/
//    WhatsApp) alongside Telegram, and collect the reply from the relay. First answer wins;
//    the others are cleared. All gated on cfg.keryxRelay — if unset, the Telegram path is unchanged.
function keryxProviders(cwd: string): Record<string, ProviderCfg> {
  try { const p = join(cwd, ".mneme", "keryx", "providers.json"); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {}; } catch { return {}; }
}
/** This machine's relay routing key (multi-tenant). Set by `mneme keryx connect`; "default" otherwise. */
function daemonIdOf(cwd: string): string {
  try { const p = join(cwd, ".mneme", "keryx", "daemon-id"); return existsSync(p) ? (readFileSync(p, "utf8").trim() || "default") : "default"; } catch { return "default"; }
}
interface RdvLink { daemonId: string; provider: string; conversation: string; at: number }
function loadLinks(cwd: string): RdvLink[] { try { const p = join(cwd, ".mneme", "keryx", "links.json"); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : []; } catch { return []; } }
function saveLinks(cwd: string, links: RdvLink[]): void { try { mkdirSync(join(cwd, ".mneme", "keryx"), { recursive: true }); writeFileSync(join(cwd, ".mneme", "keryx", "links.json"), JSON.stringify(links, null, 2), "utf8"); } catch { /* */ } }
const relayGet = (url: string, headers?: Record<string, string>): Promise<Record<string, unknown>> => new Promise((res) => { (url.startsWith("https:") ? https : http).get(url, { headers: headers ?? {} }, (r) => { let s = ""; r.on("data", (d) => (s += d)); r.on("end", () => { try { res(JSON.parse(s || "{}")); } catch { res({}); } }); }).on("error", () => res({})); });
/** This machine's secret relay bearer key (set by `mneme keryx connect`); "" if none. */
function daemonKeyOf(cwd: string): string { try { const p = join(cwd, ".mneme", "keryx", "rendezvous-secret"); return existsSync(p) ? readFileSync(p, "utf8").trim() : ""; } catch { return ""; } }
// ── OPERATION GRANTS — human pre-approves a scoped plan once; matching commands auto-allow (consumed) ──
const grantsPath = (cwd: string) => join(dir(cwd), "grants.json");
function loadGrants(cwd: string): opGrant.OpGrant[] { try { return existsSync(grantsPath(cwd)) ? JSON.parse(readFileSync(grantsPath(cwd), "utf8")) : []; } catch { return []; } }
function saveGrants(cwd: string, g: opGrant.OpGrant[]): void { try { mkdirSync(dir(cwd), { recursive: true }); writeFileSync(grantsPath(cwd), JSON.stringify(g, null, 2), "utf8"); } catch { /* */ } }
function grantSecret(cwd: string): string { const p = join(dir(cwd), "grant-secret"); try { if (existsSync(p)) return readFileSync(p, "utf8").trim(); } catch { /* */ } const s = _hmac("sha256", "mneme-grant").update(cwd + "|" + process.pid).digest("hex"); try { mkdirSync(dir(cwd), { recursive: true }); writeFileSync(p, s, "utf8"); } catch { /* */ } return s; }
const relayPost = (url: string, body: object): Promise<void> => new Promise((res) => { const u = new URL(url); const data = JSON.stringify(body); const rq = (url.startsWith("https:") ? https : http).request({ hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: u.pathname, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) } }, (x) => { x.on("data", () => {}); x.on("end", () => res()); }); rq.on("error", () => res()); rq.write(data); rq.end(); });

/** Fan an approve/deny ask out to every configured KERYX provider IN PARALLEL; the secretary
 *  retries a failed lane once + reports per-lane delivery. Registers the relay expectation. */
async function fanOutKeryx(cwd: string, cfg: PagerConfig, req: pager.ApprovalRequest, requested?: string[] | null): Promise<{ sent: Array<{ provider: string; messageId: string }>; attempts: Array<{ provider: string; ok: boolean }> }> {
  const provs = keryxProviders(cwd);
  const kinds = (req.kind ?? "approve") as "approve" | "choice" | "text";
  const lanes = keryx.dispatchPlan(keryx.ALL_PROVIDERS as unknown as string[], ["telegram"], requested ?? undefined)
    .filter((p) => { const pc = provs[p]; return pc && (pc.token || (p === "line" && pc.channelId && pc.channelSecret)); });
  const spec = { id: req.id, nonce: req.nonce ?? req.id, question: req.summary, kind: kinds, choices: req.choices, agent: req.agent };
  const did = daemonIdOf(cwd); const links = loadLinks(cwd);
  const trySend = async (p: string): Promise<{ provider: string; ok: boolean; messageId: string }> => {
    // RENDEZVOUS: if this provider is paired, push to the SPECIFIC linked conversation (precise, not broadcast-to-all)
    const lk = links.find((l) => l.daemonId === did && l.provider === p);
    const pc = lk ? { ...provs[p], to: lk.conversation } : provs[p];
    try { let r = await sendAsk(p, pc, spec); if (!r.ok) r = await sendAsk(p, pc, spec); return { provider: p, ok: !!r.ok, messageId: r.messageId ?? "" }; }   // secretary: one retry
    catch { return { provider: p, ok: false, messageId: "" }; }
  };
  const results = await Promise.all(lanes.map(trySend));
  const sent = results.filter((r) => r.ok).map((r) => ({ provider: r.provider, messageId: r.messageId }));
  if (sent.length && cfg.keryxRelay) await relayPost(`${cfg.keryxRelay.replace(/\/$/, "")}/keryx/expect`, { daemonId: did, askId: req.id });
  return { sent, attempts: results.map((r) => ({ provider: r.provider, ok: r.ok })) };
}
/** Poll the relay for a reply to this ask (LINE/Slack/Discord/WhatsApp taps land here). */
async function drainKeryxAnswer(cfg: PagerConfig, id: string): Promise<{ provider: string; answer: string } | null> {
  if (!cfg.keryxRelay) return null;
  const r = await relayGet(`${cfg.keryxRelay.replace(/\/$/, "")}/keryx/drain?daemon=default`);
  const answers = (r.answers as Array<{ id: string; payload: string; channel: string }>) ?? [];
  const hit = answers.find((a) => a.id === id); return hit ? { provider: hit.channel, answer: hit.payload } : null;
}
/** Clear the question on every provider the human did NOT answer on (Telegram strip + provider clear). */
async function clearKeryxOthers(cwd: string, cfg: PagerConfig, sent: Array<{ provider: string; messageId: string }>, answeredOn: string): Promise<void> {
  const provs = keryxProviders(cwd);
  for (const act of keryx.clearPlan(sent, answeredOn)) { try { await clearMessage(act.provider, provs[act.provider], act.messageId, answeredOn); } catch { /* */ } }
}
/** AUTHORITATIVE cross-surface reconcile (the Approval Matrix, wired live): clear EVERY surface the
 *  human did NOT answer on — from ANY process (request loop, long-poll daemon, computer web tap) —
 *  idempotently, so a tap on Telegram clears LINE/Slack/Discord/WhatsApp and vice-versa, and the
 *  same surface is never cleared twice. Reads the broadcast surfaces persisted at request time. */
async function clearOthersFor(cwd: string, cfg: PagerConfig, id: string, answeredOn: string): Promise<void> {
  const st = loadState(cwd);
  const sent = st.surfaces?.[id] ?? [];
  const done = new Set(st.clearedSurfaces?.[id] ?? []);
  const provs = keryxProviders(cwd);
  for (const s of sent) {
    if (!s?.provider || s.provider === answeredOn || done.has(s.provider)) continue;
    try { await clearMessage(s.provider, provs[s.provider], s.messageId, answeredOn); } catch { /* best-effort */ }
    done.add(s.provider);
  }
  const s2 = loadState(cwd); s2.clearedSurfaces = s2.clearedSurfaces ?? {}; s2.clearedSurfaces[id] = [...done]; saveState(cwd, s2);
}

/** THE SPIDER'S REFLEX — handle a tap from ANY surface (Telegram or a keryx provider). The daemon is
 *  the SOLE authority, so this is the one place a tap is resolved: FIRST-WINS (resolvePending guards
 *  on status), then every OTHER surface is cleared once + the human is confirmed on Telegram; a LATE
 *  tap on an already-decided request (a stale LINE/WhatsApp button that can't be removed) gets an
 *  honest "already decided" reply instead of silence. Mirrors the 1900-scenario-proven processTap. */
async function reconcileTap(cwd: string, cfg: PagerConfig, id: string, decision: string, surface: string): Promise<"accepted" | "already" | "none"> {
  const st = loadState(cwd); const cur = st.pendings.find((x) => x.req.id === id);
  if (!cur) return "none";
  const ag = cur.req.agent || "the agent";
  const tgSay = async (text: string) => { try { if (cfg.telegramToken && cfg.chatId) await tg(cfg.telegramToken, "sendMessage", { chat_id: cfg.chatId, text }); } catch { /* */ } };
  if (cur.status !== "pending") {                       // LATE TAP — calm the thread, never re-act
    const ans = st.answers?.[id] ?? "?";
    if (surface === "telegram") await tgSay(`ℹ️ Already decided (${ans}) — no action needed.`);
    else { try { await clearMessage(surface, keryxProviders(cwd)[surface], "", `already:${ans}`); } catch { /* */ } }
    return "already";
  }
  if (!resolvePending(cwd, id, decision, "human", surface, Date.now())) return "already";   // lost the race
  const isApprove = (cur.req.kind ?? "approve") === "approve"; const allow = decision === "allow";
  try { const mid = loadState(cwd).pendings.find((x) => x.req.id === id)?.tgMessageId; if (mid && cfg.telegramToken && cfg.chatId) await tg(cfg.telegramToken, "editMessageReplyMarkup", { chat_id: cfg.chatId, message_id: mid, reply_markup: { inline_keyboard: [] } }); } catch { /* */ }
  await clearOthersFor(cwd, cfg, id, surface);          // clear EVERY other surface (idempotent)
  await tgSay(!isApprove ? `✅ "${decision}" on ${surface} — ${ag} is proceeding.` : allow ? `✅ Approved on ${surface} — ${ag} is proceeding.` : `⛔ Denied on ${surface} — ${ag} will not run it.`);
  return "accepted";
}

async function page(cfg: PagerConfig, req: pager.ApprovalRequest): Promise<number | undefined> {
  if (!cfg.telegramToken || !cfg.chatId) return undefined;
  const icon = req.blast === "destructive" ? "🔴" : req.blast === "moderate" ? "🟡" : "🟢";
  const r = await tg(cfg.telegramToken, "sendMessage", {
    chat_id: cfg.chatId,
    text: `${icon} *${req.agent}* wants to run:\n_${req.summary}_\nclass: \`${req.klass}\` · blast: ${req.blast}\nhash: \`${req.commandHash.slice(0, 12)}\` · id: \`${req.id}\`\n💻 or approve on your computer: \`mneme pager approve ${req.id}\` _(any surface — first tap wins, the rest clear)_`,
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: [[{ text: "✅ Approve", callback_data: `a:${req.id}:${req.nonce}` }, { text: "⛔ Deny", callback_data: `d:${req.id}` }]] },
  });
  return (r?.result as { message_id?: number })?.message_id;
}

/** Resolve a pending with a normalized answer ("allow"/"deny" | a choice | typed text).
 *  Records BOTH the decision receipt AND the signed, vendor-portable Proxy-of-Record. */
/** Page a question of any kind. Returns the Telegram message_id (for text force-reply matching). */
async function pageQuestion(cfg: PagerConfig, req: pager.ApprovalRequest): Promise<number | undefined> {
  const kind = req.kind ?? "approve"; const q = req.question || req.summary;
  notifyMirror(cfg, `❓ ${req.agent} asks (${kind}): ${q}${(req.choices ?? []).length ? "\noptions: " + (req.choices ?? []).join(" / ") : ""}\n(answer on Telegram)`);
  if (!cfg.telegramToken || !cfg.chatId) return undefined;
  if (kind === "text") {
    const r = await tg(cfg.telegramToken, "sendMessage", { chat_id: cfg.chatId, text: `✍️ *${req.agent}* ถาม:\n${q}\n\n_ตอบกลับข้อความนี้ด้วยการพิมพ์_`, parse_mode: "Markdown", reply_markup: { force_reply: true } });
    return (r.result as { message_id?: number })?.message_id;
  }
  if (kind === "choice") {
    const rows = (req.choices ?? []).map((c, i) => [{ text: c, callback_data: `c:${req.id}:${i}` }]);
    const r = await tg(cfg.telegramToken, "sendMessage", { chat_id: cfg.chatId, text: `🔢 *${req.agent}* ถาม:\n${q}`, parse_mode: "Markdown", reply_markup: { inline_keyboard: rows } });
    return (r.result as { message_id?: number })?.message_id;
  }
  const r = await tg(cfg.telegramToken, "sendMessage", { chat_id: cfg.chatId, text: `❓ *${req.agent}* ถาม:\n${q}`, parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "✅ Yes", callback_data: `a:${req.id}:${req.nonce}` }, { text: "⛔ No", callback_data: `d:${req.id}` }]] } });
  return (r.result as { message_id?: number })?.message_id;
}

function resolvePending(cwd: string, id: string, answer: string, decidedBy: pager.ApprovalReceipt["decidedBy"], channel: string, now: number, vendor?: string): PagerPending | null {
  const st = loadState(cwd); const p = st.pendings.find((x) => x.req.id === id && x.status === "pending");
  if (!p) return null;
  const isApprove = (p.req.kind ?? "approve") === "approve";
  const allowed = isApprove ? answer === "allow" : true;   // choice/text are "answered", not allow/deny
  p.status = allowed ? "approved" : "denied";
  st.usedNonces.push(p.req.nonce);
  st.answers = st.answers ?? {}; st.answers[id] = answer;
  const receipt = pager.buildReceipt(p.req, allowed ? "allow" : "deny", decidedBy, channel, p.lane, now);
  st.receipts.push(receipt);
  if (isApprove) st.trust = pager.updateTrust(st.trust, p.req.klass, allowed ? "approved" : "denied");
  // ★ Proxy of Record — signed, vendor-portable human decision bound to THIS question.
  const decision = pager.recordHumanDecision(p.req, answer, channel, vendor ?? p.req.vendor ?? "unknown", now);
  st.decisions = st.decisions ?? []; st.decisions.push(decision);
  try { notary.issueReceipt(cwd, { kind: "claim-verdict", subject: `pager-decision:${id}`, payload: decision, includePayload: true, issuedAt: now }); } catch { /* */ }
  saveState(cwd, st);
  return p;
}

/** Merge the PreToolUse hook into .claude/settings.json so the USER never pastes anything. */
function wireClaudeHook(cwd: string): { ok: boolean; path: string } {
  const dirp = join(cwd, ".claude"); const sp = join(dirp, "settings.json");
  try {
    mkdirSync(dirp, { recursive: true });
    let s: { hooks?: Record<string, unknown[]> } = {};
    if (existsSync(sp)) { try { s = JSON.parse(readFileSync(sp, "utf8")); } catch { s = {}; } }
    s.hooks = s.hooks ?? {};
    const pre = (s.hooks.PreToolUse as unknown[]) ?? (s.hooks.PreToolUse = []);
    const cmd = "mneme pager request --agent claude-code";   // reads tool_input.command + session_id from the hook's stdin JSON
    if (!JSON.stringify(pre).includes("mneme pager request")) pre.push({ matcher: "Bash", hooks: [{ type: "command", command: cmd }] });
    // Stop hook — when a turn ends with a question AND mode=unattended, route it to the phone.
    const stop = (s.hooks.Stop as unknown[]) ?? (s.hooks.Stop = []);
    if (!JSON.stringify(stop).includes("mneme pager turn-end")) stop.push({ hooks: [{ type: "command", command: "mneme pager turn-end" }] });
    writeFileSync(sp, JSON.stringify(s, null, 2), "utf8");
    return { ok: true, path: sp };
  } catch { return { ok: false, path: sp }; }
}

/** Best-effort: set the laptop lid-close action to "do nothing" so closing the lid keeps the
 *  agent running + paging (the user does not have to know any OS setting). */
function setLidStayAwake(): string {
  try {
    if (process.platform === "win32") {
      spawn("powercfg", ["/setacvalueindex", "SCHEME_CURRENT", "4f971e89-eebd-4455-a8de-9e59040e7347", "5ca83367-6e45-459f-a27b-476b1d01c936", "0"], { stdio: "ignore" });
      spawn("powercfg", ["/setdcvalueindex", "SCHEME_CURRENT", "4f971e89-eebd-4455-a8de-9e59040e7347", "5ca83367-6e45-459f-a27b-476b1d01c936", "0"], { stdio: "ignore" });
      spawn("powercfg", ["/S", "SCHEME_CURRENT"], { stdio: "ignore" });
      return "Windows: lid-close set to 'do nothing' (lid can close, machine stays awake).";
    }
    if (process.platform === "linux") return "Linux: set HandleLidSwitch=ignore in /etc/systemd/logind.conf (needs sudo) — or the daemon's systemd-inhibit holds sleep while work pends.";
    return "macOS: lid-close on battery sleeps by firmware — keep on AC, or run `sudo pmset -c disablesleep 1` once for clamshell stay-awake.";
  } catch { return "lid setting skipped (best-effort)."; }
}

/** Register `mneme pager start` to auto-start on login (so the user never runs a command). */
function installPagerService(cwd: string): string {
  const cliBin = process.argv[1] ?? "mneme";
  try {
    if (process.platform === "win32") {
      // schtasks /Create needs elevation on many machines (Access denied) — the old fire-and-forget
      // reported success even when it silently failed. Try schtasks, VERIFY, and fall back to a
      // Startup-folder VBS (current-user, no admin, hidden window) so auto-start actually works.
      const r = spawnSync("schtasks", ["/Create", "/TN", "MnemeCosmicPager", "/TR", `cmd /c cd /d "${cwd}" && node "${cliBin}" pager start`, "/SC", "ONLOGON", "/F"], { stdio: "ignore" });
      if (r.status === 0) return "Windows: auto-start task 'MnemeCosmicPager' registered (runs on every login).";
      const startup = join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
      mkdirSync(startup, { recursive: true });
      const vbs = join(startup, "MnemeCosmicPager.vbs");
      writeFileSync(vbs, `CreateObject("WScript.Shell").Run "cmd /c cd /d ""${cwd}"" && node ""${cliBin}"" pager start", 0, False`, "ascii");
      return existsSync(vbs) ? "Windows: auto-start added to your Startup folder (runs hidden every login — no admin needed)." : "Windows: could not register auto-start — run `mneme pager start` manually.";
    }
    if (process.platform === "darwin") {
      const plist = join(process.env.HOME ?? "", "Library", "LaunchAgents", "dev.mneme.pager.plist");
      mkdirSync(join(process.env.HOME ?? "", "Library", "LaunchAgents"), { recursive: true });
      writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>dev.mneme.pager</string><key>ProgramArguments</key><array><string>node</string><string>${cliBin}</string><string>pager</string><string>start</string></array><key>WorkingDirectory</key><string>${cwd}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/></dict></plist>\n`, "utf8");
      spawn("launchctl", ["load", plist], { stdio: "ignore" });
      return "macOS: LaunchAgent 'dev.mneme.pager' registered (runs at login).";
    }
    const unit = join(process.env.HOME ?? "", ".config", "systemd", "user", "mneme-pager.service");
    mkdirSync(join(process.env.HOME ?? "", ".config", "systemd", "user"), { recursive: true });
    writeFileSync(unit, `[Unit]\nDescription=Mneme Cosmic Pager\n[Service]\nExecStart=node ${cliBin} pager start\nWorkingDirectory=${cwd}\nRestart=always\n[Install]\nWantedBy=default.target\n`, "utf8");
    spawn("systemctl", ["--user", "enable", "--now", "mneme-pager.service"], { stdio: "ignore" });
    return "Linux: systemd-user unit 'mneme-pager' registered + started.";
  } catch { return "service registration skipped (best-effort) — run `mneme pager start` manually."; }
}

export function registerPagerCommands(program: Command): void {
  const p = program.command("pager").description("📟 COSMIC PAGER — approve an agent's sensitive actions from your phone (Telegram), lid closed. Signed authority · self-tuning Trust-Tide · dead-man queue · court-admissible. NO server (the laptop long-polls Telegram behind NAT).");

  p.command("grant").description("🔑 OPERATION GRANT — pre-approve a SCOPED plan ONCE (the human taps yes to the whole plan); commands matching its patterns then auto-allow (consumed + audited), while anything off-plan still pages. Informed batch consent, not a bypass — TTL + max-uses + signed.")
    .requiredOption("--plan <text>", "what this operation does (the human sees + approves this)")
    .requiredOption("--for <patterns>", "comma-separated command substrings the grant covers (e.g. 'systemctl,caddy,redis-cli')")
    .option("--ttl <min>", "lifetime in minutes (default 30)")
    .option("--max <n>", "max commands it may auto-allow (default 25)")
    .option("--agent <id>", "agent label", "agent")
    .option("--yes", "you ARE the human at this terminal — skip the phone approval")
    .action(async (o: { plan: string; for: string; ttl?: string; max?: string; agent?: string; yes?: boolean }) => {
      const cwd = process.cwd(); const cfg = loadCfg(cwd); const now = Date.now();
      const patterns = String(o.for).split(",").map((s) => s.trim()).filter(Boolean);
      if (!patterns.length) { out("✗ --for needs at least one command pattern"); process.exitCode = 2; return; }
      const ttlMin = Number(o.ttl) || 30; const maxUses = Number(o.max) || 25;
      if (!o.yes && cfg.telegramToken && cfg.chatId) {
        // page the WHOLE plan for ONE informed approval
        const nonce = _hmac("sha256", "grant").update(o.plan + now).digest("hex").slice(0, 16);
        const req = pager.mintApprovalRequest({ rawCommand: "OPERATION-GRANT", summary: `🔑 OPERATION GRANT — approve this plan?\n${o.plan}\nCovers: ${patterns.join(", ")}\nExpires in ${ttlMin}m · up to ${maxUses} commands`, agent: o.agent ?? "agent", session: "grant", klass: "grant", blast: "moderate", nonce, now, ttlMs: ttlMin * 60_000 });
        const mid = await page(cfg, req); const st = loadState(cwd); st.pendings.push({ req, status: "pending", lane: "conservative", tgMessageId: mid }); saveState(cwd, st); ensureDaemon(cwd);
        try { await fanOutKeryx(cwd, cfg, req, null); } catch { /* */ }
        out("⏳ sent the plan to your phone — tap ✅ to grant…");
        const deadline = now + ttlMin * 60_000;
        for (;;) {
          const ans = loadState(cwd).answers?.[req.id];
          if (ans === "allow") break;
          if (ans === "deny") { out("✗ grant denied on your phone."); process.exitCode = 2; return; }
          if (Date.now() > deadline) { out("✗ no approval in time — grant not created."); process.exitCode = 2; return; }
          await new Promise((r) => setTimeout(r, 600));
        }
      }
      const g = opGrant.mintGrant(o.plan, patterns, { now: Date.now(), ttlMs: ttlMin * 60_000, maxUses, secret: grantSecret(cwd), by: "human" });
      saveGrants(cwd, [...opGrant.pruneGrants(loadGrants(cwd), Date.now()), g]);
      out(`🔑 GRANT ACTIVE — ${g.id}\n   plan: ${g.plan}\n   covers: ${patterns.join(", ")}\n   ${ttlMin}m · ${maxUses} uses · commands matching these patterns now auto-allow (off-plan still pages)`);
    });

  p.command("grants").description("List active operation grants (the human-pre-approved plans).").action(() => {
    const cwd = process.cwd(); const live2 = opGrant.pruneGrants(loadGrants(cwd), Date.now());
    if (!live2.length) { out("no active operation grants."); return; }
    for (const g of live2) out(`🔑 ${g.id} · "${g.plan}" · covers [${g.patterns.join(", ")}] · uses ${g.uses}/${g.maxUses} · expires ${new Date(g.exp).toISOString()}`);
  });
  p.command("revoke-grant <id>").description("Revoke an operation grant by id.").action((id: string) => {
    const cwd = process.cwd(); const before = loadGrants(cwd); const after = before.filter((g) => g.id !== id);
    saveGrants(cwd, after); out(after.length < before.length ? `✓ revoked ${id}` : `no grant ${id}`);
  });

  p.command("autosetup")
    .description("🚀 ONE COMMAND, ZERO USER STEPS — the AI agent runs this for the user: auto-discovers the chat-id, wires the Claude Code hook, sets lid-stay-awake, registers auto-start, and launches the pager. The user only creates a Telegram bot once (BotFather) + taps START — then hands over JUST the token.")
    .requiredOption("--telegram-token <t>", "from @BotFather").option("--chat-id <id>", "(optional — auto-discovered if you've tapped START on the bot)")
    .option("--no-service", "don't register login auto-start").option("--no-start", "don't launch now")
    .action(async (o: { telegramToken: string; chatId?: string; service?: boolean; start?: boolean }) => {
      const cwd = process.cwd();
      // ZERO-BURDEN: auto-discover the chat-id. getUpdates is a CONSUMING queue, so we
      // long-poll-WAIT for a fresh message (telling the user to message the bot now) — robust
      // even if a previous run/daemon already drained the old updates.
      let chatId = o.chatId;
      if (!chatId) {
        const ping = await tg(o.telegramToken, "getMe", {}) as { ok: boolean };
        if (!ping.ok) { out("❌ token ใช้ไม่ได้ (Unauthorized) — ตรวจ token จาก @BotFather อีกครั้ง"); process.exitCode = 2; return; }
        out("👉 เปิด Telegram → บอตของคุณ → กด START หรือพิมพ์อะไรก็ได้ส่งไป \"ตอนนี้\" (กำลังรอ 45 วิ)…");
        const deadline = Date.now() + 45_000; let offset = 0; let found: number | null = null;
        while (Date.now() < deadline && found === null) {
          const upd = await tg(o.telegramToken, "getUpdates", { offset, timeout: 20 }) as { ok: boolean; result?: Array<{ update_id: number; message?: { chat?: { id?: number } }; my_chat_member?: { chat?: { id?: number } } }> };
          for (const u of upd.result ?? []) { offset = u.update_id + 1; const id = u.message?.chat?.id ?? u.my_chat_member?.chat?.id; if (typeof id === "number") found = id; }
        }
        if (found === null) { out("⚠️ ยังไม่ได้รับข้อความ — ลองรัน autosetup อีกครั้งแล้วพิมพ์หาบอตเลย (หรือใส่ --chat-id เอง)"); process.exitCode = 2; return; }
        chatId = String(found);
        out(`✓ auto-discovered chat-id: ${chatId}`);
      }
      mkdirSync(dir(cwd), { recursive: true });
      writeFileSync(cfgPath(cwd), JSON.stringify({ telegramToken: o.telegramToken, chatId, mode: "hybrid", wakeIntervalMin: 5, ttlMs: 5 * 60_000 }, null, 2), "utf8");
      const hook = wireClaudeHook(cwd);
      const lid = setLidStayAwake();
      const svc = o.service === false ? "auto-start: skipped" : installPagerService(cwd);
      // send a confirmation page so the user SEES it works on their phone immediately
      const test = await tg(o.telegramToken, "sendMessage", { chat_id: chatId, text: "📟 Cosmic Pager is live. You'll get approval requests here when an agent needs your OK — tap ✅ / ⛔. (Lid can close.)" });
      if (o.start !== false) { try { spawn(process.execPath, [process.argv[1], "pager", "start"], { cwd, stdio: "ignore", detached: true }).unref(); } catch { /* */ } }
      out("📟 Cosmic Pager — autosetup complete");
      out(`   ✓ config saved · ${hook.ok ? "✓ Claude Code hook wired (" + hook.path + ")" : "✗ hook not wired"}`);
      out(`   ✓ ${lid}`);
      out(`   ✓ ${svc}`);
      out(`   ${test.ok ? "✓ test message sent to your Telegram — check your phone" : "⚠ could not reach Telegram — re-check the token/chat-id"}`);
      out(`   ${o.start !== false ? "✓ pager started in the background (long-polling Telegram)" : "· not started (use --start)"}`);
      out("\n   The user did ONE thing: created a Telegram bot. Everything else is wired. Close the lid and go.");
    });

  p.command("setup").description("Configure the Telegram bot + policy (+ optional LINE notify-mirror).")
    .requiredOption("--telegram-token <t>", "BotFather token").requiredOption("--chat-id <id>", "your Telegram chat id")
    .option("--mode <m>", "hybrid (default)", "hybrid").option("--wake-min <n>", "RTC wake interval (min)", "5").option("--ttl-min <n>", "approval TTL (min)", "5")
    .option("--line-token <t>", "(optional) LINE channel access token — mirrors questions to LINE").option("--line-to <id>", "(optional) LINE user/group id")
    .action((o: { telegramToken: string; chatId: string; mode?: string; wakeMin?: string; ttlMin?: string; lineToken?: string; lineTo?: string }) => {
      mkdirSync(dir(process.cwd()), { recursive: true });
      const cfg: PagerConfig = { ...loadCfg(process.cwd()), telegramToken: o.telegramToken, chatId: o.chatId, mode: o.mode ?? "hybrid", wakeIntervalMin: parseInt(o.wakeMin ?? "5", 10), ttlMs: parseInt(o.ttlMin ?? "5", 10) * 60_000 };
      if (o.lineToken && o.lineTo) { cfg.lineToken = o.lineToken; cfg.lineTo = o.lineTo; }
      writeFileSync(cfgPath(process.cwd()), JSON.stringify(cfg, null, 2), "utf8");
      out(`✓ pager configured${cfg.lineToken ? " (+ LINE notify-mirror)" : ""}. Run with \`mneme pager start\`, wire the hook with \`mneme pager hook\`.`);
    });

  p.command("add-chat <provider>").description("Add a chat lane to the BROADCAST MATRIX (so an approval also fans out to LINE/Slack/Discord/WhatsApp, not just Telegram). Sets the relay + the provider creds in one shot — repeatable + stable.")
    .option("--relay <url>", "the KERYX relay base URL (where provider replies land; your own or a shared one)")
    .option("--token <t>", "bot/access token (slack xoxb-… / discord / whatsapp)")
    .option("--channel <c>", "channel id (slack C… / discord channel id)")
    .option("--channel-id <id>", "LINE channel id").option("--channel-secret <s>", "LINE channel secret")
    .option("--to <id>", "LINE user id / WhatsApp recipient number").option("--phone-id <id>", "WhatsApp phone-number id")
    .action((provider: string, o: { relay?: string; token?: string; channel?: string; channelId?: string; channelSecret?: string; to?: string; phoneId?: string }) => {
      const cwd = process.cwd(); const p = provider.toLowerCase();
      if (!keryx.ALL_PROVIDERS.includes(p as never)) { out(`✗ unknown provider "${p}". One of: ${keryx.ALL_PROVIDERS.join(", ")}`); process.exitCode = 2; return; }
      const entry: ProviderCfg = {};
      if (o.token) entry.token = o.token; if (o.channel) entry.channel = o.channel;
      if (o.channelId) entry.channelId = o.channelId; if (o.channelSecret) entry.channelSecret = o.channelSecret;
      if (o.to) entry.to = o.to; if (o.phoneId) entry.phoneId = o.phoneId;
      const ok = entry.token || (p === "line" && entry.channelId && entry.channelSecret);
      if (!ok) { out(`✗ ${p} needs ${p === "line" ? "--channel-id + --channel-secret" : "--token (+ --channel where applicable)"}`); process.exitCode = 2; return; }
      // 1) provider creds → .mneme/keryx/providers.json
      const kdir = join(cwd, ".mneme", "keryx"); mkdirSync(kdir, { recursive: true });
      const kp = join(kdir, "providers.json");
      let provs: Record<string, ProviderCfg> = {}; try { if (existsSync(kp)) provs = JSON.parse(readFileSync(kp, "utf8")); } catch { /* */ }
      provs[p] = { ...provs[p], ...entry }; writeFileSync(kp, JSON.stringify(provs, null, 2), "utf8");
      // 2) relay → pager config (so the wait-loop drains replies)
      if (o.relay) { const cfg = loadCfg(cwd); cfg.keryxRelay = o.relay.replace(/\/$/, ""); mkdirSync(dir(cwd), { recursive: true }); writeFileSync(cfgPath(cwd), JSON.stringify(cfg, null, 2), "utf8"); }
      const relay = o.relay || loadCfg(cwd).keryxRelay;
      const lanes = keryx.ALL_PROVIDERS.filter((x) => { const c = provs[x]; return c && (c.token || (x === "line" && c.channelId && c.channelSecret)); });
      if (loadCfg(cwd).telegramToken) lanes.unshift("telegram" as never);
      out(`✓ added ${p} to the broadcast matrix${relay ? ` · relay = ${relay}` : ""}`);
      out(`   connected lanes now: ${Array.from(new Set(lanes)).join(", ")}`);
      if (!relay) out("   ⚠ no relay set — replies from LINE/Slack/etc need a relay (re-run with --relay <url>); Telegram works without one.");
      else { out(`   webhook for this provider → ${relay}/keryx/webhook/${p}`); out(`   verify outbound: mneme keryx test-send ${p}`); }
    });

  p.command("request").description("THE CLAUDE CODE HOOK — decide on a command: AUTO_ALLOW (Trust-Tide) or BROADCAST the ask to your chats (Telegram + LINE/Slack/Discord/WhatsApp in parallel) + BLOCK-AND-WAIT for the first signed answer from any of them, then emit Claude Code's permissionDecision. Dead-man default on TTL.")
    .option("--command <c>", "the raw command (optional — read from the Claude Code hook JSON on stdin if omitted)").option("--agent <a>", "agent id", "agent").option("--session <s>", "session id", "default")
    .option("--channels <list>", "which chats to broadcast to: 'all' (default) or a subset like 'line,whatsapp'")
    .option("--json", "non-blocking: print {decision} instead of blocking + the Claude Code hook JSON")
    .action(async (o: { command?: string; agent?: string; session?: string; json?: boolean; channels?: string }) => {
      const cwd = process.cwd(); const cfg = loadCfg(cwd); const st = loadState(cwd); const now = Date.now();
      // Claude Code PreToolUse hooks deliver the tool input as JSON on STDIN (NOT $TOOL_INPUT_command).
      // Read it: command = tool_input.command, session = session_id. Falls back to --command for manual/testing.
      const hookIn = readHookStdin();
      const command = (o.command ?? hookIn?.command ?? "").toString();
      const session = o.session && o.session !== "default" ? o.session : (hookIn?.session ?? "default");
      const emitPlain = (decision: "allow" | "deny" | "ask", reason: string) => out(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason } }));
      if (!command.trim()) { emitPlain("allow", "no command to gate"); return; }   // nothing to decide → don't block the agent
      o = { ...o, command, session };
      const { blast, klass } = classify(command);
      const nonce = Math.abs([...`${command}${now}${Math.random?.() ?? 0}`].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36);
      const req = pager.mintApprovalRequest({ rawCommand: command, summary: command.slice(0, 120), agent: o.agent ?? "agent", session, klass, blast, nonce, now, ttlMs: cfg.ttlMs });
      const d = pager.decide(req, st.trust);
      const emit = (decision: "allow" | "deny" | "ask", reason: string) => {
        if (o.json) { out(JSON.stringify({ decision, lane: d.lane, reason, id: req.id })); return; }
        // Claude Code PreToolUse hook contract.
        out(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason } }));
      };
      if (d.action === "AUTO_ALLOW") {
        st.trust = pager.updateTrust(st.trust, klass, "approved"); st.receipts.push(pager.buildReceipt(req, "allow", "policy-auto", "trust-tide", d.lane, now)); saveState(cwd, st);
        emit("allow", `Trust-Tide: ${d.reason}`); return;
      }
      // OPERATION GRANT: did the human pre-approve a plan that COVERS this exact command? Auto-allow it
      // (consume one use, audit), so a pre-approved batch op runs without a tap-per-command — while
      // anything OUTSIDE the approved patterns still pages. Destructive-but-in-the-plan is allowed only
      // because the human saw + approved that pattern; off-plan destructive still pages.
      const grants = loadGrants(cwd);
      const cover = opGrant.coveringGrant(grants, command, now, grantSecret(cwd));
      if (cover) {
        saveGrants(cwd, opGrant.consumeGrant(grants, cover.id));
        st.receipts.push(pager.buildReceipt(req, "allow", "policy-auto", `op-grant:${cover.id}`, d.lane, now)); saveState(cwd, st);
        try { notary.issueReceipt(cwd, { kind: "claim-verdict", subject: `op-grant-use:${cover.id}`, payload: command.slice(0, 120), includePayload: true, issuedAt: now }); } catch { /* */ }
        emit("allow", `Operation grant — pre-approved plan: ${cover.plan} (use ${(cover.uses ?? 0) + 1}/${cover.maxUses})`); return;
      }
      st.pendings.push({ req, status: "pending", lane: d.lane }); saveState(cwd, st);
      ensureDaemon(cwd);                 // AUTO self-heal: if the long-poll daemon is down, revive it
      // DYNAMIC LANES: agent passes "all" / "line,whatsapp" / or the user's own words
      // ("ส่งไป line กับ whatsapp พอ") — extractChannels understands EN + Thai. null = all.
      const lanes = o.channels ? keryx.extractChannels(o.channels) : null;
      const wantTelegram = !lanes || lanes.includes("telegram");
      const tgMid = wantTelegram ? await page(cfg, req) : undefined;
      if (tgMid) { const s = loadState(cwd); const pp = s.pendings.find((x) => x.req.id === req.id); if (pp) { pp.tgMessageId = tgMid; saveState(cwd, s); } }
      const fo = await fanOutKeryx(cwd, cfg, req, lanes);   // fan out to the chosen LINE/Slack/Discord/WhatsApp lanes IN PARALLEL
      const keryxSent = fo.sent;
      // ★ persist EVERY surface this ask was offered on (incl. Telegram + the computer) so ANY process
      //   — request loop, long-poll daemon, or the computer web tap — can reconcile + clear the rest.
      { const s = loadState(cwd); s.surfaces = s.surfaces ?? {}; s.surfaces[req.id] = [...(tgMid ? [{ provider: "telegram", messageId: String(tgMid) }] : []), ...keryxSent]; saveState(cwd, s); }
      // ── THE SECRETARY: confirm the broadcast actually reached every chat (delivery report) ──
      const attempts = [
        ...(wantTelegram && cfg.telegramToken ? [{ provider: "telegram", ok: !!tgMid }] : []),
        ...fo.attempts,
      ];
      const rep = keryx.deliveryReport(attempts);
      if (rep.failed.length && cfg.telegramToken && cfg.chatId && tgMid) { try { await tg(cfg.telegramToken, "sendMessage", { chat_id: cfg.chatId, text: `⚠️ couldn't reach: ${rep.failed.join(", ")} — delivered to: ${rep.delivered.join(", ") || "none"}` }); } catch { /* */ } }
      if (o.json) { out(JSON.stringify({ decision: "pending", id: req.id, lane: d.lane, reason: d.reason, paged: !!(cfg.telegramToken && cfg.chatId) })); return; }
      // ── PRE-FLIGHT (Wait-State compute window) — FIRE-AND-FORGET so it NEVER delays the
      // human's answer or the dead-man timeout. Sends a decision brief; for provably read-only
      // commands, speculatively pre-runs (time-boxed) so the human approves with foresight.
      void (async () => {
        try {
          const cs0 = loadState(cwd).classStats?.[klass];   // real outcome history (Gap-1 fix)
          const brief = preflight.buildPreflight({ command, blast, history: cs0 ? { seen: cs0.seen, succeeded: cs0.succeeded, recentFails: cs0.recentFails } : undefined });
          if (cfg.telegramToken && cfg.chatId) await tg(cfg.telegramToken, "sendMessage", { chat_id: cfg.chatId, text: "📊 " + preflight.renderBrief(brief) });
          if (brief.speculatable) {
            const key = preflight.speculativeKey(command); const now2 = Date.now();
            const cached = loadState(cwd).speculative?.[key];
            let okRun: boolean, preview: string, fromCache = false;
            if (preflight.freshSpeculative(cached, now2)) { okRun = cached!.exitOk; preview = cached!.output; fromCache = true; }   // #3 anticipatory: warm result, no re-run
            else {
              const r = spawnSync(command, { shell: true, timeout: 8000, encoding: "utf8", cwd });
              okRun = !r.error && (r.status === 0 || r.status === null); preview = String(r.stdout || r.stderr || "").trim().slice(0, 280);
              try { const s2 = loadState(cwd); s2.speculative = s2.speculative ?? {}; s2.speculative[key] = { commandHash: key, output: preview, exitOk: okRun, ranAt: now2 }; saveState(cwd, s2); } catch { /* */ }
            }
            // record the real outcome per command-class → next pre-flight is proactive ("failed Nx")
            if (!fromCache) { try { const s3 = loadState(cwd); s3.classStats = s3.classStats ?? {}; const c3 = s3.classStats[klass] ?? { seen: 0, succeeded: 0, recentFails: 0 }; c3.seen++; if (okRun) c3.succeeded++; else c3.recentFails++; s3.classStats[klass] = c3; saveState(cwd, s3); } catch { /* */ } }
            if (cfg.telegramToken && cfg.chatId) await tg(cfg.telegramToken, "sendMessage", { chat_id: cfg.chatId, text: okRun ? `✅ pre-ran in a safe read-only check${fromCache ? " (cached · instant)" : ""} — looks clean:\n${preview || "(no output)"}` : `⚠️ heads-up: this would FAIL if approved:\n${preview || "error"}` });
          }
        } catch { /* pre-flight is best-effort; it never affects the decision path */ }
      })();
      // DUAL-SURFACE BLOCK-AND-WAIT: poll state.answers[id] — written by the phone (daemon) OR
      // a local `mneme pager approve <id>`. First to answer wins. Dead-man default on TTL.
      const ttl = cfg.ttlMs ?? 5 * 60_000; const deadline = Date.now() + ttl; let n = 0;
      const settle = async (answer: "allow" | "deny", answeredOn: string, reason: string) => {
        await clearOthersFor(cwd, cfg, req.id, answeredOn);   // authoritative: clear EVERY other surface, idempotent across processes
        // ── THE SECRETARY: post the agent-received RECEIPT so the human SEES the agent got it 100% ──
        if (answeredOn !== "policy" && answeredOn !== "") {
          const receipt = keryx.receiptLine(req.agent, answer, answeredOn);
          if (cfg.telegramToken && cfg.chatId) { try { await tg(cfg.telegramToken, "sendMessage", { chat_id: cfg.chatId, text: receipt }); } catch { /* */ } }
          // confirm on the answered keryx provider too (so the user who tapped LINE/Slack sees it landed)
          if (answeredOn !== "telegram") { try { await clearMessage(answeredOn, keryxProviders(cwd)[answeredOn], "", req.agent); } catch { /* */ } }
          const mid = loadState(cwd).pendings.find((x) => x.req.id === req.id)?.tgMessageId;
          if (answeredOn !== "telegram" && mid && cfg.telegramToken && cfg.chatId) { try { await tg(cfg.telegramToken, "editMessageReplyMarkup", { chat_id: cfg.chatId, message_id: mid, reply_markup: { inline_keyboard: [] } }); } catch { /* */ } }
        }
        emit(answer, reason);
      };
      // The DAEMON is the sole authority that drains every surface (Telegram long-poll + the keryx
      // relay for LINE/Slack/Discord/WhatsApp) and resolves via reconcileTap. This request just waits
      // for the resolution to land in state.answers — no draining here (that caused lost/late taps).
      for (;;) {
        const ans = loadState(cwd).answers?.[req.id];
        if (ans === "allow") { emit("allow", "approved by the human"); return; }
        if (ans === "deny") { emit("deny", "denied by the human"); return; }
        if (Date.now() > deadline) {
          if (blast === "destructive") { resolvePending(cwd, req.id, "deny", "deadman", "policy", Date.now()); await settle("deny", "", "dead-man: destructive timed out unattended → DENY"); return; }
          emit("ask", "no answer in time → defer to Claude Code's own prompt"); return;
        }
        if (++n % 20 === 0) ensureDaemon(cwd);    // keep the daemon alive while we wait
        await new Promise((r) => setTimeout(r, 500));   // snappy ~realtime local pickup
      }
    });

  p.command("doctor").description("🩺 SELF-CHECK — is the pager daemon alive? Auto-restart it if not. (Run by the hook automatically; here for manual peace of mind.)")
    .action(() => {
      const cwd = process.cwd();
      if (daemonAlive(cwd)) { out("✓ pager daemon is alive (heartbeat fresh)."); return; }
      const ok = ensureDaemon(cwd);
      out(ok ? "⚠ daemon was down — restarted ✓ (long-polling Telegram again)" : "✗ could not restart — run `mneme pager start`.");
    });

  p.command("tool-schema").description("Emit the `ask_human` function-calling tool (OpenAI/xAI/Anthropic schema) + REST examples — register it with ANY vendor's agent so the model can ask you via Telegram over the local HTTP bridge.")
    .action(() => {
      const cwd = process.cwd(); const port = (loadCfg(cwd) as { httpPort?: number }).httpPort ?? 17782;
      const tool = { type: "function", function: { name: "ask_human", description: "Ask the human user a question and wait for their answer (delivered to their phone via Telegram). Use when you need approval (yes/no), a choice, or a typed value before continuing.", parameters: { type: "object", properties: { question: { type: "string" }, kind: { type: "string", enum: ["approve", "choice", "text"] }, choices: { type: "array", items: { type: "string" } } }, required: ["question"] } } };
      out("// 1) Register this tool with your agent (OpenAI/xAI/Anthropic function-calling):");
      out(JSON.stringify(tool, null, 2));
      out("\n// 2) Your tool-runner implements ask_human by calling the LOCAL bridge (daemon must be running):");
      out(`//   POST http://127.0.0.1:${port}/pager/ask   {"question":"...","kind":"approve|choice|text","choices":[...]}  -> {id}`);
      out(`//   GET  http://127.0.0.1:${port}/pager/answer?id=<id>  -> {answer}   (poll until answer != null)`);
      out("// The human's answer is signed (Proxy-of-Record) + bound to the exact question. Works for Cursor/Cline/Codex/aider/any local Grok·xAI·OpenAI agent.");
    });

  p.command("mode [set]").description("ATTENDED (default — conversational questions stay in chat) vs UNATTENDED (away/lid-closed — the AI's questions auto-route to your phone). Tool/command approvals always route regardless.")
    .action((set?: string) => {
      const cwd = process.cwd(); const cfg = loadCfg(cwd);
      if (set === "attended" || set === "unattended") { writeFileSync(cfgPath(cwd), JSON.stringify({ ...cfg, attend: set }, null, 2), "utf8"); out(`✓ pager mode → ${set}${set === "unattended" ? " — the AI's questions now auto-page your phone" : " — questions stay in chat (you're at the keyboard)"}`); return; }
      out(`pager mode: ${(cfg as { attend?: string }).attend ?? "attended"} (use \`mneme pager mode unattended\` when you step away)`);
    });

  p.command("turn-end").description("THE STOP HOOK — classify the AI's finished turn; if it's a question AND mode=unattended, route it to the phone, wait, and feed the answer back so the agent continues. Pass --reply or pipe the assistant's last message on stdin.")
    .option("--reply <text>", "the assistant's last message").option("--agent <a>", "agent", "claude-code").option("--vendor <v>", "vendor", "claude")
    .action(async (o: { reply?: string; agent?: string; vendor?: string }) => {
      const cwd = process.cwd(); const cfg = loadCfg(cwd); const attend = (cfg as { attend?: pager.PagerMode }).attend ?? "attended";
      let reply = o.reply ?? "";
      if (!reply) {
        let stdin = ""; try { stdin = readFileSync(0, "utf8"); } catch { /* no stdin */ }
        // Claude Code Stop hook passes JSON { transcript_path, … }; else treat stdin as the reply.
        try {
          const j = JSON.parse(stdin) as { transcript_path?: string };
          if (j.transcript_path && existsSync(j.transcript_path)) {
            const lines = readFileSync(j.transcript_path, "utf8").trim().split("\n");
            for (let i = lines.length - 1; i >= 0 && !reply; i--) {
              try { const e = JSON.parse(lines[i]) as { type?: string; message?: { role?: string; content?: unknown } }; const msg = e.message ?? (e as { role?: string; content?: unknown }); if (e.type === "assistant" || msg.role === "assistant") { const ct = msg.content; reply = Array.isArray(ct) ? ct.filter((c: { type?: string }) => c.type === "text").map((c: { text?: string }) => c.text ?? "").join("\n") : String(ct ?? ""); } } catch { /* */ }
            }
          } else reply = stdin;
        } catch { reply = stdin; }
      }
      const cls = pager.classifyTurn(reply);
      const route = pager.decideRoute(cls, attend);
      if (!route.page) { out("{}"); return; } // let the turn end normally (Claude Code Stop hook: no block)
      ensureDaemon(cwd);
      const now = Date.now();
      const nonce = Math.abs([...`${cls.question}${now}`].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36);
      const req = pager.mintQuestion({ rawContext: cls.question, question: cls.question, kind: cls.kind, choices: cls.choices, agent: o.agent ?? "claude-code", session: "turn", vendor: o.vendor, nonce, now, ttlMs: cfg.ttlMs });
      const tgMessageId = await pageQuestion(cfg, req);
      const st = loadState(cwd); st.pendings.push({ req, status: "pending", lane: "conservative", tgMessageId }); saveState(cwd, st);
      const deadline = Date.now() + (cfg.ttlMs ?? 5 * 60_000); let n = 0;
      for (;;) {
        const ans = loadState(cwd).answers?.[req.id];
        if (ans !== undefined) { out(JSON.stringify({ decision: "block", reason: `The user answered on their phone: "${ans}". Continue with this.` })); return; }
        if (Date.now() > deadline) { out("{}"); return; }
        if (++n % 20 === 0) ensureDaemon(cwd);
        await new Promise((r) => setTimeout(r, 500));
      }
    });

  p.command("ask").description("🌐 VENDOR-AGNOSTIC — any agent (any vendor) asks the human a question → Telegram → signed answer back. Kinds: approve (yes/no) · choice (pick-one) · text (typed). Prints {id}; pair with `mneme pager await <id>`.")
    .requiredOption("--question <q>", "the question to ask the human")
    .option("--kind <k>", "approve | choice | text", "approve").option("--choices <list>", "comma-separated options (kind=choice)")
    .option("--agent <a>", "agent id", "agent").option("--session <s>", "session", "default").option("--vendor <v>", "vendor (claude/cursor/xai/…)", "unknown")
    .action(async (o: { question: string; kind?: string; choices?: string; agent?: string; session?: string; vendor?: string }) => {
      const cwd = process.cwd(); const cfg = loadCfg(cwd); const st = loadState(cwd); const now = Date.now();
      const kind = (["approve", "choice", "text"].includes(o.kind ?? "") ? o.kind : "approve") as pager.QuestionKind;
      const choices = o.choices ? o.choices.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
      const nonce = Math.abs([...`${o.question}${now}`].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36);
      const req = pager.mintQuestion({ rawContext: o.question, question: o.question, kind, choices, agent: o.agent ?? "agent", session: o.session ?? "default", vendor: o.vendor, nonce, now, ttlMs: cfg.ttlMs });
      const tgMessageId = await pageQuestion(cfg, req);
      st.pendings.push({ req, status: "pending", lane: "conservative", tgMessageId }); saveState(cwd, st);
      out(JSON.stringify({ id: req.id, kind, paged: !!(cfg.telegramToken && cfg.chatId) }));
    });

  p.command("await <id>").description("Block until the human answers on Telegram, then print {answer}. (The daemon must be running to receive the reply.)")
    .option("--timeout <s>", "seconds", "300")
    .action(async (id: string, o: { timeout?: string }) => {
      const cwd = process.cwd(); const deadline = Date.now() + parseInt(o.timeout ?? "300", 10) * 1000;
      for (;;) {
        const st = loadState(cwd);
        if (st.answers && st.answers[id] !== undefined) { out(JSON.stringify({ id, answer: st.answers[id] })); return; }
        if (Date.now() > deadline) { out(JSON.stringify({ id, answer: null, timeout: true })); process.exitCode = 2; return; }
        await new Promise((r) => setTimeout(r, 1500));
      }
    });

  p.command("shim").description("🌐 UNIVERSAL GATE — gate the COMMAND, not the agent. Installs PATH-first shims for high-risk commands so the approve-from-chat flow works for ANY agent (Claude/Grok/Gemini/Cursor/aider) AND a human — because the shell layer is vendor-neutral. action: install | uninstall | status.")
    .argument("<action>", "install | uninstall | status")
    .option("--commands <list>", "comma-separated commands to guard (default: high-risk set)")
    .action((action: string, o: { commands?: string }) => {
      const shimDir = join(homedir(), ".mneme", "shims");
      const isWin = process.platform === "win32";
      const list = o.commands ? o.commands.split(",").map((s) => s.trim()).filter(Boolean) : [...keryx.DEFAULT_GUARDED];
      if (action === "status") {
        const have = existsSync(shimDir) ? readdirSync(shimDir) : [];
        out(have.length ? `🌐 ${have.length} shim(s) in ${shimDir}: ${have.join(", ")}\n   ensure this is FIRST on PATH for your agent's shell.` : `no shims installed. Run \`mneme pager shim install\`.`);
        return;
      }
      if (action === "uninstall") { if (existsSync(shimDir)) rmSync(shimDir, { recursive: true, force: true }); out(`✓ removed ${shimDir}. (Also remove it from PATH.)`); return; }
      if (action !== "install") { out("action must be install | uninstall | status"); process.exitCode = 2; return; }
      mkdirSync(shimDir, { recursive: true });
      const resolved: string[] = []; const skipped: string[] = [];
      for (const cmd of list) {
        const real = resolveRealBinary(cmd, shimDir);
        if (!real) { skipped.push(cmd); continue; }
        if (isWin) { writeFileSync(join(shimDir, `${cmd}.ps1`), keryx.shimScriptPs1(cmd, real), "utf8"); writeFileSync(join(shimDir, `${cmd}.cmd`), `@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0${cmd}.ps1" %*\r\n`, "utf8"); }
        else { const p = join(shimDir, cmd); writeFileSync(p, keryx.shimScriptSh(cmd, real), "utf8"); try { chmodSync(p, 0o755); } catch { /* */ } }
        resolved.push(cmd);
      }
      out(`🌐 UNIVERSAL GATE installed ${resolved.length} shim(s) → ${shimDir}`);
      if (resolved.length) out(`   guarded: ${resolved.join(", ")}`);
      if (skipped.length) out(`   skipped (not found on PATH): ${skipped.join(", ")}`);
      out(isWin ? `   ▶ add to PATH (front): $env:PATH = "${shimDir};" + $env:PATH   (set it in the env your AI agent runs in)`
        : `   ▶ add to PATH (front): export PATH="${shimDir}:$PATH"   (put this where your AI agent's shell sources it)`);
      out(`   Now ANY agent (or you) running a guarded command is gated through the pager — vendor-neutral.`);
    });

  p.command("approve <id>").description("Approve a pending request from THIS computer (in parallel with your phone — the first tap wins, the rest clear).").option("--deny", "deny instead")
    .action(async (id: string, o: { deny?: boolean }) => {
      const cwd = process.cwd();
      const r = await reconcileTap(cwd, loadCfg(cwd), id, o.deny ? "deny" : "allow", "computer");   // same spider reflex as every surface
      out(r === "accepted" ? `✓ ${o.deny ? "denied" : "approved"} ${id} on this computer — every other surface cleared.` : r === "already" ? `· ${id} was already decided (no-op).` : "no such pending request");
    });

  p.command("open").description("💻 Open the local approval page in your browser — approve/reject right here on the computer, in parallel with your phone.")
    .action(() => {
      const cwd = process.cwd(); ensureDaemon(cwd);
      const port = (loadCfg(cwd) as { httpPort?: number }).httpPort ?? 17782; const url = `http://127.0.0.1:${port}/pager/ui`;
      const cmd = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
      try { spawn(cmd, [url], { shell: process.platform === "win32", stdio: "ignore", detached: true }).unref(); } catch { /* */ }
      out(`💻 approval page → ${url}  (approve/reject here; the first tap across any surface wins)`);
    });

  p.command("status").description("Pending queue + Trust-Tide state.").action(() => {
    const cwd = process.cwd(); const st = loadState(cwd); const cfg = loadCfg(cwd);
    const pend = st.pendings.filter((x) => x.status === "pending");
    out(`📟 pager · telegram ${cfg.telegramToken ? "configured" : "NOT set"} · mode ${cfg.mode ?? "hybrid"}`);
    out(`   pending: ${pend.length}${pend.length ? " — " + pend.map((x) => `${x.req.id}(${x.req.blast})`).join(", ") : ""}`);
    const classes = Object.entries(st.trust.classes ?? {});
    if (classes.length) out(`   trust: ${classes.map(([k, c]) => `${k} ${Math.round(pager.classTrust(st.trust, k) * 100)}%(${c.approvals}/${c.approvals + c.denials})`).join(" · ")}`);
  });

  p.command("hook").description("Print the Claude Code PreToolUse hook snippet (paste into .claude/settings.json).").action(() => {
    out(JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "mneme pager request --agent claude-code" }] }] } }, null, 2));
    out("# AUTO_ALLOW → {\"decision\":\"allow\"}; otherwise paged to your phone and held. Wire your runner to await `mneme pager status`.");
  });

  p.command("start").description("Run the pager loop: best-effort power 'breathing' + Telegram long-poll + dead-man on each wake.")
    .action(async () => {
      const cwd = process.cwd(); const cfg = loadCfg(cwd);
      if (!cfg.telegramToken || !cfg.chatId) { out("not configured — run `mneme pager setup` first"); process.exitCode = 2; return; }
      out("📟 pager running — long-polling Telegram (Ctrl-C to stop). Lid can close; set OS lid-action to 'do nothing' for stay-awake.");
      // best-effort sleep inhibitor (breathing power) — spawn the OS tool; harmless if absent.
      const plat = process.platform;
      try {
        if (plat === "darwin") spawn("caffeinate", ["-s"], { stdio: "ignore", detached: true }).unref();
        else if (plat === "linux") spawn("systemd-inhibit", ["--what=sleep", "--why=mneme-pager", "sleep", "infinity"], { stdio: "ignore", detached: true }).unref();
        else if (plat === "win32") spawn("powershell", ["-NoProfile", "-Command", "Add-Type -Name P -Namespace W -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint e);'; while($true){[W.P]::SetThreadExecutionState(0x80000001); Start-Sleep 50}"], { stdio: "ignore", detached: true }).unref();
      } catch { /* power best-effort */ }
      let offset = 0;
      const deadmanTick = () => { const st = loadState(cwd); const r = pager.deadmanResolve(st.pendings.filter((x) => x.status === "pending"), Date.now()); for (const res of r.resolved) resolvePending(cwd, res.id, res.decision, "deadman", "policy", Date.now()); };
      setInterval(deadmanTick, (cfg.wakeIntervalMin ?? 5) * 60_000);
      // ── KERYX DRAIN on a FAST, INDEPENDENT interval (every 3s) — NOT gated behind the 50s Telegram
      //    long-poll, so a LINE/Slack/Discord/WhatsApp tap is reconciled promptly + consistently.
      //    The daemon is the SOLE drainer (no lost answers); reconcileTap handles first-wins + clear +
      //    late-reply. A re-entrancy guard prevents overlapping drains. ──
      let draining = false;
      const keryxTick = async () => {
        if (draining || !cfg.keryxRelay) return; draining = true;
        try {
          const dk = daemonKeyOf(cwd);
          const dr = await relayGet(`${cfg.keryxRelay.replace(/\/$/, "")}/keryx/drain?daemon=${encodeURIComponent(daemonIdOf(cwd))}`, dk ? { "x-keryx-key": dk } : undefined);
          const lk = dr.links as RdvLink[] | undefined; if (Array.isArray(lk)) saveLinks(cwd, lk);   // learn paired conversations (for precise outbound push)
          for (const a of (dr.answers as Array<{ id?: string; payload?: string; channel?: string }>) ?? []) {
            if (!a?.id) continue;
            await reconcileTap(cwd, cfg, a.id, keryx.normalizeDecision(String(a.payload ?? "")), a.channel || "line");
          }
        } catch { /* relay blip — retry next tick */ } finally { draining = false; }
      };
      setInterval(() => { void keryxTick(); }, 3000);
      // ── CONTINUOUS SELF-VERIFY — every 60s run the end-to-end pipeline CANARY + snapshot vitals so a
      //    silent regression is caught + surfaced (the pulse/boot read .mneme/pager/vitals.json). The
      //    daemon being alive is itself the heal for daemon-down (ensureDaemon revives it on the next
      //    agent action), so this tick's job is to PROVE correctness + ALERT, not restart blindly. ──
      const startVersion = installedVersion();   // capture at boot; if it changes on disk, we're stale
      const vitalsTick = () => {
        try {
          // SELF-HEAL: a newer Mneme was installed but THIS daemon still runs the old code (the "stale
          // survivor" class). Exit cleanly → ensureDaemon respawns fresh on the next agent action.
          const nowV = installedVersion();
          if (startVersion && nowV && nowV !== startVersion) { try { appendFileSync(join(cwd, ".mneme", "supernova.jsonl"), JSON.stringify({ ts: new Date().toISOString(), cycle: "pager_self_heal", outcome: "STALE_VERSION", from: startVersion, to: nowV }) + "\n"); } catch { /* */ } process.exit(0); }
          const canary = live.approvalCanary();
          const provs = keryxProviders(cwd);
          const rep = live.evaluateLiveness({
            daemonHeartbeatAgeMs: 0, hookWired: true, canaryOk: canary.ok,
            relay: cfg.keryxRelay ? { configured: true, reachable: null } : { configured: false, reachable: null },
            providers: [
              { name: "telegram", cfg: cfg.telegramToken ? { token: cfg.telegramToken } : null },
              { name: "line", cfg: (provs.line as never) ?? null }, { name: "slack", cfg: (provs.slack as never) ?? null },
              { name: "discord", cfg: (provs.discord as never) ?? null }, { name: "whatsapp", cfg: (provs.whatsapp as never) ?? null },
            ],
          });
          try { writeFileSync(join(dir(cwd), "vitals.json"), JSON.stringify({ ts: Date.now(), verdict: rep.verdict, canaryOk: canary.ok, summary: rep.summary, probes: rep.probes }), "utf8"); } catch { /* */ }
          if (!canary.ok || rep.verdict === "down") {
            try { appendFileSync(join(cwd, ".mneme", "supernova.jsonl"), JSON.stringify({ ts: new Date().toISOString(), cycle: "vitals_canary", outcome: canary.ok ? "PROVIDER_DOWN" : "CANARY_FAIL", verdict: rep.verdict, detail: rep.summary }) + "\n"); } catch { /* */ }
          }
        } catch { /* never let the self-check crash the daemon */ }
      };
      setInterval(vitalsTick, 60_000); vitalsTick();
      // daemon-scope helpers (shared by the long-poll loop AND the computer web surface)
      const dStrip = (id: string) => { const mid = loadState(cwd).pendings.find((x) => x.req.id === id)?.tgMessageId; return (mid && cfg.telegramToken && cfg.chatId) ? tg(cfg.telegramToken, "editMessageReplyMarkup", { chat_id: cfg.chatId, message_id: mid, reply_markup: { inline_keyboard: [] } }) : Promise.resolve({ ok: true }); };
      const dConfirm = (t: string) => (cfg.telegramToken && cfg.chatId) ? tg(cfg.telegramToken, "sendMessage", { chat_id: cfg.chatId, text: t }) : Promise.resolve({ ok: true });

      // ── LOCAL HTTP/A2A BRIDGE — the universal channel: ANY local agent (Cursor/Cline/Codex/
      // aider, or a Grok/xAI/OpenAI tool-runner) can POST to ask the human via Telegram + poll
      // the signed answer over plain REST. 127.0.0.1 only (never exposed off the machine).
      const httpPort = (cfg as { httpPort?: number }).httpPort ?? 17782;
      const server = http.createServer((rq, rs) => {
        const send = (code: number, obj: unknown) => { rs.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" }); rs.end(JSON.stringify(obj)); };
        try {
          const url = new URL(rq.url ?? "/", "http://127.0.0.1");
          if (rq.method === "GET" && url.pathname === "/health") return send(200, { ok: true, service: "mneme-pager" });
          if (rq.method === "GET" && url.pathname === "/pager/answer") { const id = url.searchParams.get("id") ?? ""; const st = loadState(cwd); const pp = st.pendings.find((x) => x.req.id === id); return send(200, { id, answer: st.answers?.[id] ?? null, status: pp?.status ?? "unknown" }); }
          // ── THE COMPUTER SURFACE — approve/reject right here on the machine you're sitting at,
          //    in parallel with your phone. First tap on ANY surface wins; the rest clear. ──
          if (rq.method === "GET" && url.pathname === "/pager/pending") { const st = loadState(cwd); return send(200, { pending: st.pendings.filter((x) => x.status === "pending").map((p) => ({ id: p.req.id, agent: p.req.agent, summary: p.req.summary, blast: p.req.blast, kind: p.req.kind ?? "approve", choices: p.req.choices ?? [] })) }); }
          if (rq.method === "POST" && url.pathname === "/pager/decide") {
            let body = ""; rq.on("data", (d) => (body += d)); rq.on("end", async () => {
              try {
                const b = JSON.parse(body || "{}") as { id?: string; answer?: string };
                const id = String(b.id ?? ""); const ans = String(b.answer ?? "");
                const cur = loadState(cwd).pendings.find((x) => x.req.id === id);
                if (!cur) return send(404, { error: "no such request" });
                if (cur.status !== "pending") return send(200, { ok: true, status: cur.status, note: "already decided" });
                if (!resolvePending(cwd, id, ans, "human", "computer", Date.now())) return send(409, { error: "could not resolve" });
                await dStrip(id); await clearOthersFor(cwd, cfg, id, "computer");
                const ag = cur.req.agent || "the agent";
                await dConfirm(ans === "allow" ? `💻 Approved on the computer — command unlocked (${ag} is proceeding).` : ans === "deny" ? `💻 Denied on the computer — command blocked.` : `💻 Answered on the computer: "${ans}".`);
                send(200, { ok: true, status: "resolved", answeredOn: "computer" });
              } catch (e) { send(400, { error: String((e as Error).message) }); }
            });
            return;
          }
          if (rq.method === "GET" && url.pathname === "/pager/ui") { rs.writeHead(200, { "content-type": "text/html; charset=utf-8" }); rs.end(PAGER_UI_HTML); return; }
          if (rq.method === "POST" && url.pathname === "/pager/ask") {
            let body = ""; rq.on("data", (d) => (body += d)); rq.on("end", async () => {
              try {
                const b = JSON.parse(body || "{}") as { question?: string; kind?: string; choices?: string[]; vendor?: string; agent?: string };
                const kind = (["approve", "choice", "text"].includes(b.kind ?? "") ? b.kind : "approve") as pager.QuestionKind;
                const nowL = Date.now(); const nonce = Math.abs([...`${b.question}${nowL}`].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36);
                const req = pager.mintQuestion({ rawContext: b.question ?? "", question: b.question ?? "", kind, choices: b.choices, agent: b.agent ?? "agent", session: "http", vendor: b.vendor, nonce, now: nowL, ttlMs: cfg.ttlMs });
                const tgMessageId = await pageQuestion(cfg, req);
                const st = loadState(cwd); st.pendings.push({ req, status: "pending", lane: "conservative", tgMessageId }); saveState(cwd, st);
                send(200, { id: req.id, kind, paged: !!(cfg.telegramToken && cfg.chatId) });
              } catch (e) { send(400, { error: String((e as Error).message) }); }
            });
            return;
          }
          send(404, { error: "not found" });
        } catch (e) { send(500, { error: String((e as Error).message) }); }
      });
      server.on("error", () => { /* port in use → another daemon already serving */ });
      server.listen(httpPort, "127.0.0.1");
      // long-poll loop — handles approve (a:/d:), choice (c:), and typed text replies.
      // SELF-HEALING: each cycle touches a heartbeat; any error is caught + retried (the loop
      // never dies on a transient network blip), so the pager keeps itself alive 24/7.
      for (;;) {
       try {
        try { writeFileSync(hbPath(cwd), String(Date.now()), "utf8"); } catch { /* */ }
        const r = await tg(cfg.telegramToken, "getUpdates", { offset, timeout: 50, allowed_updates: ["callback_query", "message"] }) as { ok: boolean; result?: Array<{ update_id: number; callback_query?: { id: string; data?: string }; message?: { text?: string; reply_to_message?: { message_id?: number } } }> };
        if (r.ok && Array.isArray(r.result)) {
          for (const u of r.result) {
            offset = u.update_id + 1;
            const ack = (t: string) => u.callback_query ? tg(cfg.telegramToken!, "answerCallbackQuery", { callback_query_id: u.callback_query.id, text: t }) : Promise.resolve({ ok: true });
            const confirm = (t: string) => tg(cfg.telegramToken!, "sendMessage", { chat_id: cfg.chatId!, text: t }); // visible chat confirmation (a button tap alone only shows a tiny toast)
            const stripButtons = (id: string) => { const mid = loadState(cwd).pendings.find((x) => x.req.id === id)?.tgMessageId; return mid ? tg(cfg.telegramToken!, "editMessageReplyMarkup", { chat_id: cfg.chatId!, message_id: mid, reply_markup: { inline_keyboard: [] } }) : Promise.resolve({ ok: true }); };
            const findById = (id: string) => loadState(cwd).pendings.find((x) => x.req.id === id);
            const data = u.callback_query?.data ?? "";
            if (data.startsWith("a:") || data.startsWith("d:")) {
              const id = data.split(":")[1]; const allow = data.startsWith("a:");
              const r = await reconcileTap(cwd, cfg, id, allow ? "allow" : "deny", "telegram");   // unified handler (first-wins + clear-all + late-reply)
              await ack(r === "accepted" ? (allow ? "✅ approved" : "⛔ denied") : "already answered");
            }
            else if (data.startsWith("c:")) { const [, id, idxS] = data.split(":"); const cur = findById(id); const choice = cur?.req.choices?.[parseInt(idxS, 10)];
              if (cur && cur.status !== "pending") { await ack("already answered"); await confirm(`ℹ️ Already chosen (${loadState(cwd).answers?.[id] ?? "?"}).`); }
              else if (cur && choice && resolvePending(cwd, id, choice, "human", "telegram", Date.now())) { await ack(`✅ ${choice}`); await stripButtons(id); await clearOthersFor(cwd, cfg, id, "telegram"); await confirm(`✅ Chosen: ${choice} (${cur?.req.agent || "the agent"} is proceeding).`); } }
            else if (u.message?.reply_to_message?.message_id) { // typed text answer
              const mid = u.message.reply_to_message.message_id; const txt = (u.message.text ?? "").trim();
              const st0 = loadState(cwd); const pp = st0.pendings.find((x) => x.tgMessageId === mid && x.status === "pending");
              const already = st0.pendings.find((x) => x.tgMessageId === mid && x.status !== "pending");
              if (pp && txt) { resolvePending(cwd, pp.req.id, txt, "human", "telegram", Date.now()); await confirm(`✅ Got your answer: "${txt}" (${pp.req.agent || "the agent"} is proceeding).`); }
              else if (already) { await confirm(`ℹ️ Already answered "${st0.answers?.[already.req.id] ?? "?"}" — ask a new question to make a new request.`); }
              else if (txt) { await confirm("ℹ️ No pending question matches this reply (it may have timed out) — waiting for a new one."); }
            }
          }
        }
       } catch { await new Promise((r) => setTimeout(r, 2000)); } // self-heal: never die on a transient blip
      }
    });
}
