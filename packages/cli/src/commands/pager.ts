/**
 * `mneme pager` (v2.201.0) — Cosmic Pager: approve an agent's sensitive actions from your
 * phone (Telegram), lid closed. The 4-diamond CORE (signed authority · Trust-Tide · dead-man
 * · court-admissible receipts) lives in @mneme-ai/core; this is the I/O: config, the local
 * decision path (used by the agent hook), the Telegram long-poll loop, and best-effort
 * power "breathing". Behind NAT, the laptop reaches OUT to Telegram — NO server, NO public IP.
 */
import type { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import * as https from "node:https";
import * as http from "node:http";
import { pager, notary, preflight, keryx } from "@mneme-ai/core";
import { sendAsk, clearMessage, type ProviderCfg } from "./keryx_providers.js";

function out(s: string): void { process.stdout.write(s + "\n"); }
const dir = (cwd: string) => join(cwd, ".mneme", "pager");
const cfgPath = (cwd: string) => join(dir(cwd), "config.json");
const statePath = (cwd: string) => join(dir(cwd), "state.json");

interface PagerConfig { telegramToken?: string; chatId?: string; mode?: string; wakeIntervalMin?: number; ttlMs?: number; lineToken?: string; lineTo?: string; httpPort?: number; attend?: string; keryxRelay?: string }
interface PagerState { trust: pager.TrustState; pendings: PagerPending[]; usedNonces: string[]; receipts: pager.ApprovalReceipt[]; decisions?: pager.HumanDecisionRecord[]; answers?: Record<string, string>; speculative?: Record<string, preflight.SpeculativeEntry>; classStats?: Record<string, { seen: number; succeeded: number; recentFails: number }> }
type PagerPending = pager.Pending & { tgMessageId?: number };

const loadCfg = (cwd: string): PagerConfig => { try { return existsSync(cfgPath(cwd)) ? JSON.parse(readFileSync(cfgPath(cwd), "utf8")) : {}; } catch { return {}; } };
const loadState = (cwd: string): PagerState => { try { return existsSync(statePath(cwd)) ? JSON.parse(readFileSync(statePath(cwd), "utf8")) : { trust: pager.emptyTrust(), pendings: [], usedNonces: [], receipts: [], decisions: [], answers: {} }; } catch { return { trust: pager.emptyTrust(), pendings: [], usedNonces: [], receipts: [], decisions: [], answers: {} }; } };
const saveState = (cwd: string, s: PagerState): void => { mkdirSync(dir(cwd), { recursive: true }); writeFileSync(statePath(cwd), JSON.stringify(s, null, 2), "utf8"); };
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
const relayGet = (url: string): Promise<Record<string, unknown>> => new Promise((res) => { (url.startsWith("https:") ? https : http).get(url, (r) => { let s = ""; r.on("data", (d) => (s += d)); r.on("end", () => { try { res(JSON.parse(s || "{}")); } catch { res({}); } }); }).on("error", () => res({})); });
const relayPost = (url: string, body: object): Promise<void> => new Promise((res) => { const u = new URL(url); const data = JSON.stringify(body); const rq = (url.startsWith("https:") ? https : http).request({ hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: u.pathname, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) } }, (x) => { x.on("data", () => {}); x.on("end", () => res()); }); rq.on("error", () => res()); rq.write(data); rq.end(); });

/** Fan an approve/deny ask out to every configured KERYX provider; register the relay expectation. */
async function fanOutKeryx(cwd: string, cfg: PagerConfig, req: pager.ApprovalRequest, requested?: string[] | null): Promise<Array<{ provider: string; messageId: string }>> {
  const provs = keryxProviders(cwd);
  const kinds = (req.kind ?? "approve") as "approve" | "choice" | "text";
  // BROADCAST MATRIX: Telegram is the long-poll lane (paged already) → exclude; fire the rest in
  // PARALLEL. `requested` (optional) restricts to a chosen subset — "only line,whatsapp".
  const lanes = keryx.dispatchPlan(keryx.ALL_PROVIDERS as unknown as string[], ["telegram"], requested ?? undefined)
    .filter((p) => { const pc = provs[p]; return pc && (pc.token || (p === "line" && pc.channelId && pc.channelSecret)); });
  const results = await Promise.all(lanes.map(async (p) => {
    try { const r = await sendAsk(p, provs[p], { id: req.id, nonce: req.nonce ?? req.id, question: req.summary, kind: kinds, choices: req.choices, agent: req.agent }); return r.ok ? { provider: p, messageId: r.messageId ?? "" } : null; } catch { return null; }
  }));
  const sent = results.filter((x): x is { provider: string; messageId: string } => x !== null);
  if (sent.length && cfg.keryxRelay) await relayPost(`${cfg.keryxRelay.replace(/\/$/, "")}/keryx/expect`, { daemonId: "default", askId: req.id });
  return sent;
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

async function page(cfg: PagerConfig, req: pager.ApprovalRequest): Promise<number | undefined> {
  if (!cfg.telegramToken || !cfg.chatId) return undefined;
  const icon = req.blast === "destructive" ? "🔴" : req.blast === "moderate" ? "🟡" : "🟢";
  const r = await tg(cfg.telegramToken, "sendMessage", {
    chat_id: cfg.chatId,
    text: `${icon} *${req.agent}* wants to run:\n_${req.summary}_\nclass: \`${req.klass}\` · blast: ${req.blast}\nhash: \`${req.commandHash.slice(0, 12)}\` · id: \`${req.id}\``,
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
    const cmd = "mneme pager request --command \"$TOOL_INPUT_command\" --agent claude-code --session \"$CLAUDE_SESSION_ID\"";
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
      spawn("schtasks", ["/Create", "/TN", "MnemeCosmicPager", "/TR", `node "${cliBin}" pager start`, "/SC", "ONLOGON", "/F"], { stdio: "ignore", cwd });
      return "Windows: auto-start task 'MnemeCosmicPager' registered (runs on every login).";
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

  p.command("request").description("THE CLAUDE CODE HOOK — decide on a command: AUTO_ALLOW (Trust-Tide) or BROADCAST the ask to your chats (Telegram + LINE/Slack/Discord/WhatsApp in parallel) + BLOCK-AND-WAIT for the first signed answer from any of them, then emit Claude Code's permissionDecision. Dead-man default on TTL.")
    .requiredOption("--command <c>", "the raw command").option("--agent <a>", "agent id", "agent").option("--session <s>", "session id", "default")
    .option("--channels <list>", "which chats to broadcast to: 'all' (default) or a subset like 'line,whatsapp'")
    .option("--json", "non-blocking: print {decision} instead of blocking + the Claude Code hook JSON")
    .action(async (o: { command: string; agent?: string; session?: string; json?: boolean; channels?: string }) => {
      const cwd = process.cwd(); const cfg = loadCfg(cwd); const st = loadState(cwd); const now = Date.now();
      const { blast, klass } = classify(o.command);
      const nonce = Math.abs([...`${o.command}${now}${Math.random?.() ?? 0}`].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36);
      const req = pager.mintApprovalRequest({ rawCommand: o.command, summary: o.command.slice(0, 120), agent: o.agent ?? "agent", session: o.session ?? "default", klass, blast, nonce, now, ttlMs: cfg.ttlMs });
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
      st.pendings.push({ req, status: "pending", lane: d.lane }); saveState(cwd, st);
      ensureDaemon(cwd);                 // AUTO self-heal: if the long-poll daemon is down, revive it
      // DYNAMIC LANES: agent passes "all" / "line,whatsapp" / or the user's own words
      // ("ส่งไป line กับ whatsapp พอ") — extractChannels understands EN + Thai. null = all.
      const lanes = o.channels ? keryx.extractChannels(o.channels) : null;
      const wantTelegram = !lanes || lanes.includes("telegram");
      const tgMid = wantTelegram ? await page(cfg, req) : undefined;
      if (tgMid) { const s = loadState(cwd); const pp = s.pendings.find((x) => x.req.id === req.id); if (pp) { pp.tgMessageId = tgMid; saveState(cwd, s); } }
      const keryxSent = await fanOutKeryx(cwd, cfg, req, lanes);   // fan out to the chosen LINE/Slack/Discord/WhatsApp lanes IN PARALLEL
      if (o.json) { out(JSON.stringify({ decision: "pending", id: req.id, lane: d.lane, reason: d.reason, paged: !!(cfg.telegramToken && cfg.chatId) })); return; }
      // ── PRE-FLIGHT (Wait-State compute window) — FIRE-AND-FORGET so it NEVER delays the
      // human's answer or the dead-man timeout. Sends a decision brief; for provably read-only
      // commands, speculatively pre-runs (time-boxed) so the human approves with foresight.
      void (async () => {
        try {
          const cs0 = loadState(cwd).classStats?.[klass];   // real outcome history (Gap-1 fix)
          const brief = preflight.buildPreflight({ command: o.command, blast, history: cs0 ? { seen: cs0.seen, succeeded: cs0.succeeded, recentFails: cs0.recentFails } : undefined });
          if (cfg.telegramToken && cfg.chatId) await tg(cfg.telegramToken, "sendMessage", { chat_id: cfg.chatId, text: "📊 " + preflight.renderBrief(brief) });
          if (brief.speculatable) {
            const key = preflight.speculativeKey(o.command); const now2 = Date.now();
            const cached = loadState(cwd).speculative?.[key];
            let okRun: boolean, preview: string, fromCache = false;
            if (preflight.freshSpeculative(cached, now2)) { okRun = cached!.exitOk; preview = cached!.output; fromCache = true; }   // #3 anticipatory: warm result, no re-run
            else {
              const r = spawnSync(o.command, { shell: true, timeout: 8000, encoding: "utf8", cwd });
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
        const verb = answer === "allow" ? "✅ Yes" : "⛔ No";
        if (keryxSent.length) await clearKeryxOthers(cwd, cfg, keryxSent, answeredOn);   // LINE/Slack/Discord/WhatsApp: edit or "answered elsewhere"
        // Telegram was also paged → if the human answered on another chat, update Telegram too (status sync)
        if (answeredOn !== "telegram" && answeredOn !== "policy" && answeredOn !== "" && cfg.telegramToken && cfg.chatId) {
          try { await tg(cfg.telegramToken, "sendMessage", { chat_id: cfg.chatId, text: `${verb} — answered on ${answeredOn}. This request is now closed.` }); } catch { /* */ }
          const mid = loadState(cwd).pendings.find((x) => x.req.id === req.id)?.tgMessageId;
          if (mid) { try { await tg(cfg.telegramToken, "editMessageReplyMarkup", { chat_id: cfg.chatId, message_id: mid, reply_markup: { inline_keyboard: [] } }); } catch { /* */ } }
        }
        emit(answer, reason);
      };
      for (;;) {
        const ans = loadState(cwd).answers?.[req.id];
        if (ans === "allow") { await settle("allow", "telegram", "approved by the human (phone/local)"); return; }
        if (ans === "deny") { await settle("deny", "telegram", "denied by the human (phone/local)"); return; }
        // KERYX: a tap on LINE/Slack/Discord/WhatsApp lands at the relay — first answer wins
        const kx = await drainKeryxAnswer(cfg, req.id);
        if (kx) {
          const a = keryx.normalizeDecision(kx.answer);
          resolvePending(cwd, req.id, a, "human", kx.provider, Date.now());
          await settle(a, kx.provider, `${a === "allow" ? "approved" : "denied"} by the human on ${kx.provider}`); return;
        }
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

  p.command("approve <id>").description("Approve a pending request locally (testing without the phone).").option("--deny", "deny instead")
    .action((id: string, o: { deny?: boolean }) => { const r = resolvePending(process.cwd(), id, o.deny ? "deny" : "allow", "human", "local", Date.now()); out(r ? `✓ ${o.deny ? "denied" : "approved"} ${id}` : "no such pending request"); });

  p.command("status").description("Pending queue + Trust-Tide state.").action(() => {
    const cwd = process.cwd(); const st = loadState(cwd); const cfg = loadCfg(cwd);
    const pend = st.pendings.filter((x) => x.status === "pending");
    out(`📟 pager · telegram ${cfg.telegramToken ? "configured" : "NOT set"} · mode ${cfg.mode ?? "hybrid"}`);
    out(`   pending: ${pend.length}${pend.length ? " — " + pend.map((x) => `${x.req.id}(${x.req.blast})`).join(", ") : ""}`);
    const classes = Object.entries(st.trust.classes ?? {});
    if (classes.length) out(`   trust: ${classes.map(([k, c]) => `${k} ${Math.round(pager.classTrust(st.trust, k) * 100)}%(${c.approvals}/${c.approvals + c.denials})`).join(" · ")}`);
  });

  p.command("hook").description("Print the Claude Code PreToolUse hook snippet (paste into .claude/settings.json).").action(() => {
    out(JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "mneme pager request --command \"$TOOL_INPUT_command\" --agent claude-code --session \"$CLAUDE_SESSION_ID\"" }] }] } }, null, 2));
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
              const id = data.split(":")[1]; const cur = findById(id);
              if (cur && cur.status !== "pending") { await ack("ตอบไปแล้ว"); await confirm(`ℹ️ คำถามนี้ตอบไปแล้ว (${loadState(cwd).answers?.[id] ?? "?"})`); }
              else { const allow = data.startsWith("a:"); if (resolvePending(cwd, id, allow ? "allow" : "deny", "human", "telegram", Date.now())) { await ack(allow ? "✅ approved" : "⛔ denied"); await stripButtons(id); await confirm(allow ? "✅ อนุมัติแล้ว — คำสั่งถูกปลดล็อก (Claude Code รันต่อ)" : "⛔ ปฏิเสธแล้ว — คำสั่งถูกบล็อก"); } }
            }
            else if (data.startsWith("c:")) { const [, id, idxS] = data.split(":"); const cur = findById(id); const choice = cur?.req.choices?.[parseInt(idxS, 10)];
              if (cur && cur.status !== "pending") { await ack("ตอบไปแล้ว"); await confirm(`ℹ️ คำถามนี้เลือกไปแล้ว (${loadState(cwd).answers?.[id] ?? "?"})`); }
              else if (cur && choice && resolvePending(cwd, id, choice, "human", "telegram", Date.now())) { await ack(`✅ ${choice}`); await stripButtons(id); await confirm(`✅ เลือกแล้ว: ${choice}`); } }
            else if (u.message?.reply_to_message?.message_id) { // typed text answer
              const mid = u.message.reply_to_message.message_id; const txt = (u.message.text ?? "").trim();
              const st0 = loadState(cwd); const pp = st0.pendings.find((x) => x.tgMessageId === mid && x.status === "pending");
              const already = st0.pendings.find((x) => x.tgMessageId === mid && x.status !== "pending");
              if (pp && txt) { resolvePending(cwd, pp.req.id, txt, "human", "telegram", Date.now()); await confirm(`✅ รับคำตอบแล้ว: "${txt}"`); }
              else if (already) { await confirm(`ℹ️ คำถามนี้ตอบไปแล้วว่า "${st0.answers?.[already.req.id] ?? "?"}" — ถ้าต้องการสั่งใหม่ ให้ agent ถามคำถามใหม่ครับ`); }
              else if (txt) { await confirm("ℹ️ ไม่พบคำถามที่ยังรอคำตอบสำหรับข้อความนี้ (อาจหมดเวลา) — รอคำถามใหม่ได้เลย"); }
            }
          }
        }
       } catch { await new Promise((r) => setTimeout(r, 2000)); } // self-heal: never die on a transient blip
      }
    });
}
