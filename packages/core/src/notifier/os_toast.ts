/**
 * Path 1 -- OS-level toast notification.
 *
 *   Windows: BurntToast (PowerShell module) OR fall back to msg.exe
 *            OR fall back to PowerShell New-BurntToastNotification
 *            shell-out via powershell.exe -Command.
 *   macOS:   `osascript -e 'display notification ...'`
 *   Linux:   `notify-send` (libnotify, ships with most desktops)
 *
 * Zero external npm deps. All shells out via spawnSync. Best-effort.
 */

import { spawnSync } from "node:child_process";
import { platform as osPlatform } from "node:os";
import type { Notifier, NotifyNotice, NotifyResult, Severity } from "./types.js";

export function osToastNotifier(opts: { minSeverity?: Severity } = {}): Notifier {
  return {
    id: "os-toast",
    label: "OS native toast",
    minSeverity: opts.minSeverity ?? "info",
    async available(): Promise<boolean> {
      const p = osPlatform();
      if (p === "win32") return true; // PowerShell always present on Win10+
      if (p === "darwin") {
        const r = spawnSync("which", ["osascript"], { encoding: "utf8", timeout: 2000 });
        return r.status === 0;
      }
      if (p === "linux") {
        const r = spawnSync("which", ["notify-send"], { encoding: "utf8", timeout: 2000 });
        return r.status === 0;
      }
      return false;
    },
    async send(notice: NotifyNotice): Promise<NotifyResult> {
      const t0 = Date.now();
      const p = osPlatform();
      try {
        if (p === "win32") return await sendWindows(notice, t0);
        if (p === "darwin") return await sendDarwin(notice, t0);
        if (p === "linux") return await sendLinux(notice, t0);
        return { notifierId: "os-toast", ok: false, ms: Date.now() - t0, error: `unsupported platform '${p}'` };
      } catch (e) {
        return { notifierId: "os-toast", ok: false, ms: Date.now() - t0, error: (e as Error).message };
      }
    },
  };
}

function escapePowerShell(s: string): string {
  return s.replace(/'/g, "''");
}

async function sendWindows(n: NotifyNotice, t0: number): Promise<NotifyResult> {
  // Use the built-in WinRT toast via PowerShell (no extra modules needed).
  const title = escapePowerShell(n.title.slice(0, 80));
  const body = escapePowerShell(n.body.slice(0, 200));
  const ps = `
$xml = @'
<toast>
  <visual>
    <binding template="ToastGeneric">
      <text>${title}</text>
      <text>${body}</text>
    </binding>
  </visual>
</toast>
'@
$XmlDocument = New-Object Windows.Data.Xml.Dom.XmlDocument
$XmlDocument.LoadXml($xml)
$toast = New-Object Windows.UI.Notifications.ToastNotification $XmlDocument
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Mneme').Show($toast)
`.trim();
  const r = spawnSync("powershell.exe",
    ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps],
    { encoding: "utf8", timeout: 5000 },
  );
  if (r.status === 0) {
    return { notifierId: "os-toast", ok: true, ms: Date.now() - t0 };
  }
  // Fallback: msg.exe (visible only when interactive session present).
  const r2 = spawnSync("msg.exe", ["*", `${n.title}: ${n.body.slice(0, 100)}`],
    { encoding: "utf8", timeout: 3000 });
  if (r2.status === 0) return { notifierId: "os-toast", ok: true, ms: Date.now() - t0, detail: "msg.exe-fallback" };
  return { notifierId: "os-toast", ok: false, ms: Date.now() - t0, error: (r.stderr || r2.stderr || "powershell + msg.exe both failed").slice(0, 200) };
}

async function sendDarwin(n: NotifyNotice, t0: number): Promise<NotifyResult> {
  const title = n.title.replace(/"/g, '\\"').slice(0, 80);
  const body = n.body.replace(/"/g, '\\"').slice(0, 200);
  const script = `display notification "${body}" with title "${title}" subtitle "Mneme"`;
  const r = spawnSync("osascript", ["-e", script], { encoding: "utf8", timeout: 5000 });
  if (r.status === 0) return { notifierId: "os-toast", ok: true, ms: Date.now() - t0 };
  return { notifierId: "os-toast", ok: false, ms: Date.now() - t0, error: (r.stderr ?? "osascript failed").slice(0, 200) };
}

async function sendLinux(n: NotifyNotice, t0: number): Promise<NotifyResult> {
  // Map severity -> urgency.
  const urgency = n.severity === "critical" ? "critical" : n.severity === "warning" ? "normal" : "low";
  const r = spawnSync("notify-send",
    ["-u", urgency, "-a", "Mneme", n.title.slice(0, 80), n.body.slice(0, 200)],
    { encoding: "utf8", timeout: 5000 },
  );
  if (r.status === 0) return { notifierId: "os-toast", ok: true, ms: Date.now() - t0 };
  return { notifierId: "os-toast", ok: false, ms: Date.now() - t0, error: (r.stderr ?? "notify-send failed").slice(0, 200) };
}
