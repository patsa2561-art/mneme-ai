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
import { spawn } from "node:child_process";
import * as https from "node:https";
import { pager, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }
const dir = (cwd: string) => join(cwd, ".mneme", "pager");
const cfgPath = (cwd: string) => join(dir(cwd), "config.json");
const statePath = (cwd: string) => join(dir(cwd), "state.json");

interface PagerConfig { telegramToken?: string; chatId?: string; mode?: string; wakeIntervalMin?: number; ttlMs?: number }
interface PagerState { trust: pager.TrustState; pendings: pager.Pending[]; usedNonces: string[]; receipts: pager.ApprovalReceipt[] }

const loadCfg = (cwd: string): PagerConfig => { try { return existsSync(cfgPath(cwd)) ? JSON.parse(readFileSync(cfgPath(cwd), "utf8")) : {}; } catch { return {}; } };
const loadState = (cwd: string): PagerState => { try { return existsSync(statePath(cwd)) ? JSON.parse(readFileSync(statePath(cwd), "utf8")) : { trust: pager.emptyTrust(), pendings: [], usedNonces: [], receipts: [] }; } catch { return { trust: pager.emptyTrust(), pendings: [], usedNonces: [], receipts: [] }; } };
const saveState = (cwd: string, s: PagerState): void => { mkdirSync(dir(cwd), { recursive: true }); writeFileSync(statePath(cwd), JSON.stringify(s, null, 2), "utf8"); };

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

async function page(cfg: PagerConfig, req: pager.ApprovalRequest): Promise<void> {
  if (!cfg.telegramToken || !cfg.chatId) return;
  const icon = req.blast === "destructive" ? "🔴" : req.blast === "moderate" ? "🟡" : "🟢";
  await tg(cfg.telegramToken, "sendMessage", {
    chat_id: cfg.chatId,
    text: `${icon} *${req.agent}* wants to run:\n_${req.summary}_\nclass: \`${req.klass}\` · blast: ${req.blast}\nhash: \`${req.commandHash.slice(0, 12)}\` · id: \`${req.id}\``,
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: [[{ text: "✅ Approve", callback_data: `a:${req.id}:${req.nonce}` }, { text: "⛔ Deny", callback_data: `d:${req.id}` }]] },
  });
}

function resolvePending(cwd: string, id: string, decision: "allow" | "deny", decidedBy: pager.ApprovalReceipt["decidedBy"], channel: string, now: number): pager.Pending | null {
  const st = loadState(cwd); const p = st.pendings.find((x) => x.req.id === id && x.status === "pending");
  if (!p) return null;
  p.status = decision === "allow" ? "approved" : "denied";
  st.usedNonces.push(p.req.nonce);
  const receipt = pager.buildReceipt(p.req, decision, decidedBy, channel, p.lane, now);
  st.receipts.push(receipt);
  st.trust = pager.updateTrust(st.trust, p.req.klass, decision === "allow" ? "approved" : "denied");
  try { notary.issueReceipt(cwd, { kind: "claim-verdict", subject: `pager-approval:${id}`, payload: receipt, includePayload: true, issuedAt: now }); } catch { /* */ }
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
    const already = JSON.stringify(pre).includes("mneme pager request");
    if (!already) pre.push({ matcher: "Bash", hooks: [{ type: "command", command: cmd }] });
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
    .description("🚀 ONE COMMAND, ZERO USER STEPS — the AI agent runs this for the user: wires the Claude Code hook, sets lid-stay-awake, registers auto-start, and launches the pager. The user only creates a Telegram bot once (BotFather) and hands over the token + chat-id.")
    .requiredOption("--telegram-token <t>", "from @BotFather").requiredOption("--chat-id <id>", "the user's Telegram chat id")
    .option("--no-service", "don't register login auto-start").option("--no-start", "don't launch now")
    .action(async (o: { telegramToken: string; chatId: string; service?: boolean; start?: boolean }) => {
      const cwd = process.cwd();
      mkdirSync(dir(cwd), { recursive: true });
      writeFileSync(cfgPath(cwd), JSON.stringify({ telegramToken: o.telegramToken, chatId: o.chatId, mode: "hybrid", wakeIntervalMin: 5, ttlMs: 5 * 60_000 }, null, 2), "utf8");
      const hook = wireClaudeHook(cwd);
      const lid = setLidStayAwake();
      const svc = o.service === false ? "auto-start: skipped" : installPagerService(cwd);
      // send a confirmation page so the user SEES it works on their phone immediately
      const test = await tg(o.telegramToken, "sendMessage", { chat_id: o.chatId, text: "📟 Cosmic Pager is live. You'll get approval requests here when an agent needs your OK — tap ✅ / ⛔. (Lid can close.)" });
      if (o.start !== false) { try { spawn(process.execPath, [process.argv[1], "pager", "start"], { cwd, stdio: "ignore", detached: true }).unref(); } catch { /* */ } }
      out("📟 Cosmic Pager — autosetup complete");
      out(`   ✓ config saved · ${hook.ok ? "✓ Claude Code hook wired (" + hook.path + ")" : "✗ hook not wired"}`);
      out(`   ✓ ${lid}`);
      out(`   ✓ ${svc}`);
      out(`   ${test.ok ? "✓ test message sent to your Telegram — check your phone" : "⚠ could not reach Telegram — re-check the token/chat-id"}`);
      out(`   ${o.start !== false ? "✓ pager started in the background (long-polling Telegram)" : "· not started (use --start)"}`);
      out("\n   The user did ONE thing: created a Telegram bot. Everything else is wired. Close the lid and go.");
    });

  p.command("setup").description("Configure the Telegram bot + policy.")
    .requiredOption("--telegram-token <t>", "BotFather token").requiredOption("--chat-id <id>", "your Telegram chat id")
    .option("--mode <m>", "hybrid (default)", "hybrid").option("--wake-min <n>", "RTC wake interval (min)", "5").option("--ttl-min <n>", "approval TTL (min)", "5")
    .action((o: { telegramToken: string; chatId: string; mode?: string; wakeMin?: string; ttlMin?: string }) => {
      mkdirSync(dir(process.cwd()), { recursive: true });
      writeFileSync(cfgPath(process.cwd()), JSON.stringify({ telegramToken: o.telegramToken, chatId: o.chatId, mode: o.mode ?? "hybrid", wakeIntervalMin: parseInt(o.wakeMin ?? "5", 10), ttlMs: parseInt(o.ttlMin ?? "5", 10) * 60_000 }, null, 2), "utf8");
      out("✓ pager configured. Test with `mneme pager test`, run with `mneme pager start`, wire the hook with `mneme pager hook`.");
    });

  p.command("request").description("Decide on a command (used by the agent hook): AUTO_ALLOW / page+hold. Prints a JSON decision.")
    .requiredOption("--command <c>", "the raw command").option("--agent <a>", "agent id", "agent").option("--session <s>", "session id", "default")
    .action(async (o: { command: string; agent?: string; session?: string }) => {
      const cwd = process.cwd(); const cfg = loadCfg(cwd); const st = loadState(cwd); const now = Date.now();
      const { blast, klass } = classify(o.command);
      const nonce = Math.abs([...`${o.command}${now}${Math.random?.() ?? 0}`].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36);
      const req = pager.mintApprovalRequest({ rawCommand: o.command, summary: o.command.slice(0, 120), agent: o.agent ?? "agent", session: o.session ?? "default", klass, blast, nonce, now, ttlMs: cfg.ttlMs });
      const d = pager.decide(req, st.trust);
      if (d.action === "AUTO_ALLOW") {
        st.trust = pager.updateTrust(st.trust, klass, "approved"); st.receipts.push(pager.buildReceipt(req, "allow", "policy-auto", "trust-tide", d.lane, now)); saveState(cwd, st);
        out(JSON.stringify({ decision: "allow", lane: d.lane, reason: d.reason })); return;
      }
      st.pendings.push({ req, status: "pending", lane: d.lane }); saveState(cwd, st);
      await page(cfg, req);
      out(JSON.stringify({ decision: "pending", id: req.id, lane: d.lane, reason: d.reason, paged: !!(cfg.telegramToken && cfg.chatId) }));
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
      // long-poll loop
      for (;;) {
        const r = await tg(cfg.telegramToken, "getUpdates", { offset, timeout: 50, allowed_updates: ["callback_query"] }) as { ok: boolean; result?: Array<{ update_id: number; callback_query?: { id: string; data?: string } }> };
        if (r.ok && Array.isArray(r.result)) {
          for (const u of r.result) {
            offset = u.update_id + 1;
            const data = u.callback_query?.data ?? "";
            if (data.startsWith("a:")) { const [, id] = data.split(":"); const p2 = resolvePending(cwd, id, "allow", "human", "telegram", Date.now()); if (p2) await tg(cfg.telegramToken, "answerCallbackQuery", { callback_query_id: u.callback_query!.id, text: "✅ approved — running" }); }
            else if (data.startsWith("d:")) { const [, id] = data.split(":"); const p2 = resolvePending(cwd, id, "deny", "human", "telegram", Date.now()); if (p2) await tg(cfg.telegramToken, "answerCallbackQuery", { callback_query_id: u.callback_query!.id, text: "⛔ denied" }); }
          }
        }
      }
    });
}
