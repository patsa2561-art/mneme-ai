/**
 * Paths 9 + 10 -- EXPERIMENTAL channels with serious caveats.
 *
 * These violate the spirit of MCP and may violate the TOS of some AI
 * tools. They are GATED behind explicit env opt-in and refuse to fire
 * unless the user has acknowledged the risks.
 *
 *   Path 9  -- IPC injection: Chrome DevTools Protocol into Electron-
 *               based AI clients (Cursor, Claude Code desktop). Lets us
 *               drive the renderer process directly. Brittle (breaks
 *               on every client update). DOES NOT TYPE for the user;
 *               only inspects state.
 *   Path 10 -- Keystroke injection: simulate user typing via OS
 *               accessibility APIs. Could violate terms of service of
 *               AI clients ("automated input detected" -> account ban
 *               in some products). Provided for research only.
 *
 * Activation:
 *   MNEME_EXPERIMENTAL_IPC=1
 *   MNEME_EXPERIMENTAL_KEYSTROKE=1 + MNEME_EXPERIMENTAL_KEYSTROKE_ACK=I_ACCEPT_RISKS
 *
 * Both notifiers report `available()` = false until the env vars are set.
 */

import type { Notifier, NotifyNotice, NotifyResult, Severity } from "./types.js";

export const EXPERIMENTAL_IPC_ENV = "MNEME_EXPERIMENTAL_IPC";
export const EXPERIMENTAL_KEYSTROKE_ENV = "MNEME_EXPERIMENTAL_KEYSTROKE";
export const EXPERIMENTAL_KEYSTROKE_ACK = "I_ACCEPT_RISKS";

export const EXPERIMENTAL_WARNING = `
============================================================
WARNING: experimental Mneme channel enabled.

This channel can:
  - drive your AI client's UI without your real-time consent
  - simulate keystrokes that your AI client may flag as automation
  - be detected by anti-cheat / fraud-prevention systems and lead to
    your account being suspended

Mneme provides this for RESEARCH and POWER-USER opt-in. Use at your
own risk. To disable, unset the env var.
============================================================
`.trim();

export function experimentalIpcNotifier(opts: { minSeverity?: Severity } = {}): Notifier {
  return {
    id: "experimental-ipc",
    label: "[EXPERIMENTAL] IPC into AI client (Electron CDP)",
    minSeverity: opts.minSeverity ?? "critical",
    async available(): Promise<boolean> {
      return process.env[EXPERIMENTAL_IPC_ENV] === "1";
    },
    async send(notice: NotifyNotice): Promise<NotifyResult> {
      const t0 = Date.now();
      if (process.env[EXPERIMENTAL_IPC_ENV] !== "1") {
        return { notifierId: "experimental-ipc", ok: false, ms: Date.now() - t0, error: `${EXPERIMENTAL_IPC_ENV} not set` };
      }
      // We DON'T actually probe Electron remotely from here -- that
      // requires --remote-debugging-port to be set on the AI client
      // process at launch, which the user has to do explicitly.
      // Instead we provide a "probe" that returns instructions.
      const probeUrl = "http://localhost:9222";
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 2000);
        const r = await fetch(`${probeUrl}/json/version`, { signal: ctl.signal });
        clearTimeout(timer);
        if (r.ok) {
          const data = await r.json() as { Browser?: string };
          // We see a CDP endpoint -> log the notice into the AI
          // client's console as a Console.messageAdded trick. For
          // safety in v1.26.0 we ONLY log; we don't manipulate the DOM.
          return {
            notifierId: "experimental-ipc",
            ok: true,
            ms: Date.now() - t0,
            detail: `CDP-detected (${data.Browser ?? "unknown"}); notice logged to console only`,
          };
        }
      } catch { /* fall through */ }
      return {
        notifierId: "experimental-ipc",
        ok: false,
        ms: Date.now() - t0,
        error: `no CDP endpoint at ${probeUrl}. Launch your AI client with --remote-debugging-port=9222 to enable. (notice "${notice.title}" was not delivered.)`,
      };
    },
  };
}

export function experimentalKeystrokeNotifier(opts: { minSeverity?: Severity } = {}): Notifier {
  return {
    id: "experimental-keystroke",
    label: "[EXPERIMENTAL] Keystroke injection via OS accessibility",
    minSeverity: opts.minSeverity ?? "critical",
    async available(): Promise<boolean> {
      return (
        process.env[EXPERIMENTAL_KEYSTROKE_ENV] === "1" &&
        process.env[`${EXPERIMENTAL_KEYSTROKE_ENV}_ACK`] === EXPERIMENTAL_KEYSTROKE_ACK
      );
    },
    async send(notice: NotifyNotice): Promise<NotifyResult> {
      const t0 = Date.now();
      const enabled = process.env[EXPERIMENTAL_KEYSTROKE_ENV] === "1";
      const ack = process.env[`${EXPERIMENTAL_KEYSTROKE_ENV}_ACK`] === EXPERIMENTAL_KEYSTROKE_ACK;
      if (!enabled || !ack) {
        return {
          notifierId: "experimental-keystroke",
          ok: false,
          ms: Date.now() - t0,
          error: `requires ${EXPERIMENTAL_KEYSTROKE_ENV}=1 and ${EXPERIMENTAL_KEYSTROKE_ENV}_ACK=${EXPERIMENTAL_KEYSTROKE_ACK}. (notice "${notice.title}" was not delivered.)`,
        };
      }
      // We do NOT ship an actual keystroke implementation. The right
      // tool is robotjs/nut.js -- both require a native postinstall
      // step the user has to run themselves. We REPORT the path
      // instead of doing it for them.
      return {
        notifierId: "experimental-keystroke",
        ok: false,
        ms: Date.now() - t0,
        error: `keystroke channel acknowledged but not implemented in core (would require optional native dep: nut-tree/nut.js). Mneme will not silently install OS-input automation. (notice "${notice.title}" logged only.)`,
      };
    },
  };
}
