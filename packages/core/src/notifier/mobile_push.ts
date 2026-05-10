/**
 * Path 5 -- Mobile push via ntfy.sh.
 *
 * ntfy.sh is a free, no-account, end-to-end-encrypted-optional pub/sub
 * push service. User picks a topic name (a UUID-ish secret), subscribes
 * via the official iOS/Android app, and Mneme publishes by HTTP POST.
 *
 *   Topic:  user picks a long random string and sets MNEME_NTFY_TOPIC
 *   Server: defaults to https://ntfy.sh; can override via MNEME_NTFY_SERVER
 *           for self-hosted ntfy instances (privacy-conscious users).
 *
 * No paid tier needed. No API key. No data plan from Mneme. Free path.
 */

import type { Notifier, NotifyNotice, NotifyResult, Severity } from "./types.js";

const DEFAULT_SERVER = "https://ntfy.sh";

export interface MobilePushOptions {
  minSeverity?: Severity;
  /** Topic override (defaults to MNEME_NTFY_TOPIC). */
  topic?: string;
  /** Server override (defaults to MNEME_NTFY_SERVER or ntfy.sh). */
  server?: string;
}

export function mobilePushNotifier(opts: MobilePushOptions = {}): Notifier {
  return {
    id: "mobile-push",
    label: "Mobile push (ntfy.sh)",
    minSeverity: opts.minSeverity ?? "warning",
    async available(): Promise<boolean> {
      const topic = opts.topic ?? process.env["MNEME_NTFY_TOPIC"];
      return Boolean(topic && topic.length >= 8);
    },
    async send(notice: NotifyNotice): Promise<NotifyResult> {
      const t0 = Date.now();
      const topic = opts.topic ?? process.env["MNEME_NTFY_TOPIC"];
      if (!topic) {
        return { notifierId: "mobile-push", ok: false, ms: Date.now() - t0, error: "MNEME_NTFY_TOPIC not set" };
      }
      const server = (opts.server ?? process.env["MNEME_NTFY_SERVER"] ?? DEFAULT_SERVER).replace(/\/$/, "");
      const priority = notice.severity === "critical" ? "5"
        : notice.severity === "warning" ? "4"
        : notice.severity === "action" ? "3"
        : "2";
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 8000);
        const r = await fetch(`${server}/${encodeURIComponent(topic)}`, {
          method: "POST",
          headers: {
            "title": notice.title.slice(0, 80),
            "priority": priority,
            "tags": "mneme",
            ...(notice.href ? { "click": notice.href } : {}),
          },
          body: notice.body.slice(0, 4000),
          signal: ctl.signal,
        });
        clearTimeout(timer);
        if (!r.ok) {
          return { notifierId: "mobile-push", ok: false, ms: Date.now() - t0, error: `HTTP ${r.status}` };
        }
        const data = await r.json().catch(() => ({})) as { id?: string };
        return { notifierId: "mobile-push", ok: true, ms: Date.now() - t0, detail: `id=${data.id ?? "?"}` };
      } catch (e) {
        return { notifierId: "mobile-push", ok: false, ms: Date.now() - t0, error: (e as Error).message };
      }
    },
  };
}
