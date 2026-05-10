/**
 * Mneme Notifier -- the unified outbound channel layer.
 *
 * Every "way Mneme talks to a human or AI agent" plugs into the same
 * Notifier interface. The daemon picks the best available channels for
 * each notice (e.g., critical version drift -> [os-toast, mobile-push,
 * email]; routine info -> [os-toast]).
 *
 * Channels: os-toast, tts-voice, mobile-push (ntfy.sh), email-smtp,
 * file-write (.cursorrules / AGENTS.md), shared-claude-md.
 *
 * All channels respect a quiet/critical threshold so the user can
 * configure noise level via env vars.
 */

export type NotifierId =
  | "os-toast"
  | "tts-voice"
  | "mobile-push"
  | "email-smtp"
  | "agent-files"
  | "experimental-ipc"
  | "experimental-keystroke";

export type Severity = "info" | "action" | "warning" | "critical";

export interface NotifyNotice {
  id: string;
  severity: Severity;
  /** Headline (≤ 80 chars). */
  title: string;
  /** One-paragraph body (≤ 400 chars). ASCII-safe. */
  body: string;
  /** Optional URL the channel surfaces (mobile push / email). */
  href?: string;
  /** Optional auto-action the AI agent should run if it sees this. */
  autoAction?: { tool: string; args: Record<string, unknown> };
}

export interface NotifyResult {
  notifierId: NotifierId;
  ok: boolean;
  /** Wall time in ms. */
  ms: number;
  /** Channel-specific notes (e.g., "fcm-token-id", "email-message-id"). */
  detail?: string;
  /** Error message when ok=false. */
  error?: string;
}

export interface Notifier {
  id: NotifierId;
  /** Human-readable label for the audit + status UIs. */
  label: string;
  /** Severity threshold -- only fire when notice.severity >= this. */
  minSeverity: Severity;
  /** Synchronous availability check (env vars present, exe on PATH, etc.). */
  available(): Promise<boolean>;
  /** Send the notice. Best-effort -- never throws (returns ok=false instead). */
  send(notice: NotifyNotice): Promise<NotifyResult>;
}

export const SEVERITY_ORDER: Record<Severity, number> = {
  info: 0,
  action: 1,
  warning: 2,
  critical: 3,
};

export function severityAtLeast(actual: Severity, threshold: Severity): boolean {
  return SEVERITY_ORDER[actual] >= SEVERITY_ORDER[threshold];
}
