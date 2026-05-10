/**
 * Path 8 -- Email notifier.
 *
 * Two modes:
 *   1. SMTP (free Gmail with app password / Sendgrid free tier / etc.):
 *      Set MNEME_SMTP_HOST + MNEME_SMTP_PORT + MNEME_SMTP_USER +
 *      MNEME_SMTP_PASS + MNEME_SMTP_FROM + MNEME_SMTP_TO. We construct
 *      raw SMTP frames over TLS via node:net + node:tls. No `nodemailer`
 *      dep -- pure stdlib so npm install stays lean.
 *
 *   2. File spool (default when no SMTP env):
 *      Writes a `.eml`-style file to .mneme/notifier/outbox/. Good for
 *      local logging + testing + audit. User can ship these via cron.
 *
 * Both modes log to .mneme/notifier/email.log so the audit module can
 * confirm delivery.
 */

import { existsSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createConnection } from "node:net";
import { connect as tlsConnect } from "node:tls";
import type { Notifier, NotifyNotice, NotifyResult, Severity } from "./types.js";

export interface EmailOptions {
  minSeverity?: Severity;
  /** Spool directory override. Default .mneme/notifier/outbox. */
  spoolDir?: string;
  /** Mode override. "auto" picks SMTP if env vars set, file otherwise. */
  mode?: "auto" | "smtp" | "file";
}

export function emailNotifier(repoRoot: string, opts: EmailOptions = {}): Notifier {
  return {
    id: "email-smtp",
    label: "Email (SMTP or file spool)",
    minSeverity: opts.minSeverity ?? "warning",
    async available(): Promise<boolean> {
      const mode = pickMode(opts.mode);
      if (mode === "smtp") return Boolean(process.env["MNEME_SMTP_HOST"] && process.env["MNEME_SMTP_TO"]);
      // File mode is always available.
      return true;
    },
    async send(notice: NotifyNotice): Promise<NotifyResult> {
      const t0 = Date.now();
      const mode = pickMode(opts.mode);
      try {
        if (mode === "smtp") {
          const r = await sendSmtp(notice);
          logResult(repoRoot, notice, r);
          return r;
        }
        // File mode.
        const r = sendFile(repoRoot, notice, opts.spoolDir);
        logResult(repoRoot, notice, r);
        return r;
      } catch (e) {
        const r: NotifyResult = { notifierId: "email-smtp", ok: false, ms: Date.now() - t0, error: (e as Error).message };
        logResult(repoRoot, notice, r);
        return r;
      }
    },
  };
}

function pickMode(override?: "auto" | "smtp" | "file"): "smtp" | "file" {
  if (override === "smtp" || override === "file") return override;
  return process.env["MNEME_SMTP_HOST"] ? "smtp" : "file";
}

function logResult(repoRoot: string, n: NotifyNotice, r: NotifyResult): void {
  try {
    const dir = join(repoRoot, ".mneme/notifier");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      noticeId: n.id, severity: n.severity, ok: r.ok, ms: r.ms,
      detail: r.detail, error: r.error,
    }) + "\n";
    appendFileSync(join(dir, "email.log"), line, "utf8");
  } catch { /* best-effort */ }
}

function sendFile(repoRoot: string, n: NotifyNotice, spoolDirOverride?: string): NotifyResult {
  const t0 = Date.now();
  const dir = spoolDirOverride ?? join(repoRoot, ".mneme/notifier/outbox");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "");
  const path = join(dir, `${ts}-${n.id}.eml`);
  const eml = [
    `From: Mneme <mneme@local>`,
    `To: ${process.env["MNEME_SMTP_TO"] ?? "user@local"}`,
    `Subject: [Mneme ${n.severity}] ${n.title.slice(0, 80)}`,
    `Date: ${new Date().toUTCString()}`,
    `X-Mneme-Notice-Id: ${n.id}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    n.body,
    ``,
    n.href ? `Link: ${n.href}` : "",
    n.autoAction ? `Auto-action: ${n.autoAction.tool}(${JSON.stringify(n.autoAction.args)})` : "",
  ].filter(Boolean).join("\r\n");
  writeFileSync(path, eml, "utf8");
  return { notifierId: "email-smtp", ok: true, ms: Date.now() - t0, detail: `spool=${path}` };
}

interface SmtpConfig {
  host: string; port: number;
  user?: string; pass?: string;
  from: string; to: string;
  startTls: boolean;
}

function readSmtpConfig(): SmtpConfig | null {
  const host = process.env["MNEME_SMTP_HOST"];
  const to = process.env["MNEME_SMTP_TO"];
  if (!host || !to) return null;
  return {
    host,
    port: parseInt(process.env["MNEME_SMTP_PORT"] ?? "587", 10),
    user: process.env["MNEME_SMTP_USER"],
    pass: process.env["MNEME_SMTP_PASS"],
    from: process.env["MNEME_SMTP_FROM"] ?? `mneme@${host}`,
    to,
    startTls: (process.env["MNEME_SMTP_TLS"] ?? "auto") !== "off",
  };
}

/** Minimal SMTP client. Implements: EHLO, STARTTLS (when port 587),
 *  AUTH LOGIN, MAIL FROM, RCPT TO, DATA, body, QUIT.
 *  Pure stdlib (node:net + node:tls). No external deps. */
async function sendSmtp(n: NotifyNotice): Promise<NotifyResult> {
  const t0 = Date.now();
  const cfg = readSmtpConfig();
  if (!cfg) return { notifierId: "email-smtp", ok: false, ms: Date.now() - t0, error: "MNEME_SMTP_* not configured" };

  return await new Promise<NotifyResult>((resolve) => {
    const useTls = cfg.port === 465; // implicit TLS
    let socket = useTls
      ? tlsConnect({ host: cfg.host, port: cfg.port, servername: cfg.host })
      : createConnection({ host: cfg.host, port: cfg.port });
    let buf = "";
    let stage: "greet" | "ehlo" | "starttls" | "ehlo2" | "auth-user" | "auth-pass" | "mail-from" | "rcpt-to" | "data" | "body" | "quit" = "greet";
    const finish = (ok: boolean, error?: string, detail?: string): void => {
      try { socket.end(); } catch { /* ignore */ }
      resolve({ notifierId: "email-smtp", ok, ms: Date.now() - t0, error, detail });
    };
    const upgradeTls = (): void => {
      const upgraded = tlsConnect({ socket, host: cfg.host, servername: cfg.host });
      socket = upgraded;
      bindData();
      stage = "ehlo2";
      send(`EHLO mneme\r\n`);
    };
    const send = (s: string): void => { socket.write(s); };
    const bindData = (): void => {
      socket.on("data", (chunk) => {
        buf += chunk.toString();
        const lines = buf.split("\r\n");
        buf = lines.pop() ?? "";
        for (const ln of lines) handleLine(ln);
      });
      socket.on("error", (err) => finish(false, err.message));
      socket.on("end", () => { /* will resolve via QUIT or error */ });
    };
    const handleLine = (line: string): void => {
      const code = parseInt(line.slice(0, 3), 10);
      if (code >= 400) { finish(false, `SMTP ${line}`); return; }
      // We only act on "final lines" (4th char is space, not '-').
      if (line[3] === "-") return;
      try {
        if (stage === "greet" && code === 220) { stage = "ehlo"; send(`EHLO mneme\r\n`); return; }
        if (stage === "ehlo" && code === 250) {
          if (cfg.startTls && !useTls) { stage = "starttls"; send(`STARTTLS\r\n`); return; }
          if (cfg.user) { stage = "auth-user"; send(`AUTH LOGIN\r\n`); return; }
          stage = "mail-from"; send(`MAIL FROM:<${cfg.from}>\r\n`); return;
        }
        if (stage === "starttls" && code === 220) { upgradeTls(); return; }
        if (stage === "ehlo2" && code === 250) {
          if (cfg.user) { stage = "auth-user"; send(`AUTH LOGIN\r\n`); return; }
          stage = "mail-from"; send(`MAIL FROM:<${cfg.from}>\r\n`); return;
        }
        if (stage === "auth-user" && code === 334) { stage = "auth-pass"; send(Buffer.from(cfg.user!).toString("base64") + "\r\n"); return; }
        if (stage === "auth-pass" && code === 334) { stage = "mail-from"; send(Buffer.from(cfg.pass ?? "").toString("base64") + "\r\n"); return; }
        if (stage === "mail-from" && code === 235) { send(`MAIL FROM:<${cfg.from}>\r\n`); return; }
        if (stage === "mail-from" && code === 250) { stage = "rcpt-to"; send(`RCPT TO:<${cfg.to}>\r\n`); return; }
        if (stage === "rcpt-to" && code === 250) { stage = "data"; send(`DATA\r\n`); return; }
        if (stage === "data" && code === 354) {
          stage = "body";
          const body = buildEml(n, cfg);
          send(body + "\r\n.\r\n");
          return;
        }
        if (stage === "body" && code === 250) { stage = "quit"; send(`QUIT\r\n`); return; }
        if (stage === "quit" && code === 221) { finish(true, undefined, `${cfg.host}:${cfg.port}`); return; }
      } catch (e) { finish(false, (e as Error).message); }
    };
    bindData();
    setTimeout(() => finish(false, "SMTP timeout"), 15000);
  });
}

function buildEml(n: NotifyNotice, cfg: SmtpConfig): string {
  const headers = [
    `From: Mneme <${cfg.from}>`,
    `To: ${cfg.to}`,
    `Subject: [Mneme ${n.severity}] ${n.title.slice(0, 80)}`,
    `Date: ${new Date().toUTCString()}`,
    `X-Mneme-Notice-Id: ${n.id}`,
    `Content-Type: text/plain; charset=utf-8`,
  ].join("\r\n");
  const body = [
    n.body,
    "",
    n.href ? `Link: ${n.href}` : "",
    n.autoAction ? `Auto-action: ${n.autoAction.tool}(${JSON.stringify(n.autoAction.args)})` : "",
  ].filter(Boolean).join("\r\n");
  return `${headers}\r\n\r\n${body}`;
}
