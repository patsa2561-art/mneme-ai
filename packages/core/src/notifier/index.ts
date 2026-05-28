/**
 * Mneme Notifier registry + multi-channel dispatcher.
 *
 *   buildAllNotifiers(repoRoot) -> Notifier[]
 *   notifyAll(notice, notifiers) -> NotifyResult[]
 *
 * The daemon calls notifyAll on every notable pulse event so all
 * available channels fire in parallel.
 */

import type { Notifier, NotifyNotice, NotifyResult, Severity } from "./types.js";
import { severityAtLeast } from "./types.js";
import { osToastNotifier } from "./os_toast.js";
import { ttsVoiceNotifier } from "./tts_voice.js";
import { mobilePushNotifier } from "./mobile_push.js";
import { emailNotifier } from "./email_smtp.js";
import { agentFilesNotifier } from "./agent_files.js";
import { experimentalIpcNotifier, experimentalKeystrokeNotifier } from "./experimental.js";

export type {
  Notifier, NotifyNotice, NotifyResult, NotifierId, Severity,
} from "./types.js";
export { SEVERITY_ORDER, severityAtLeast } from "./types.js";

export { osToastNotifier } from "./os_toast.js";
export { ttsVoiceNotifier } from "./tts_voice.js";
export { mobilePushNotifier } from "./mobile_push.js";
export { emailNotifier } from "./email_smtp.js";
export { agentFilesNotifier, readMnemeBlock, renderMnemeBlock } from "./agent_files.js";
export {
  experimentalIpcNotifier, experimentalKeystrokeNotifier,
  EXPERIMENTAL_IPC_ENV, EXPERIMENTAL_KEYSTROKE_ENV, EXPERIMENTAL_KEYSTROKE_ACK,
  EXPERIMENTAL_WARNING,
} from "./experimental.js";

/** Build every notifier (whether currently available or not). The
 *  caller filters via .available() before dispatch. */
export function buildAllNotifiers(repoRoot: string): Notifier[] {
  return [
    osToastNotifier(),
    ttsVoiceNotifier(),
    mobilePushNotifier(),
    emailNotifier(repoRoot),
    agentFilesNotifier(repoRoot),
    experimentalIpcNotifier(),
    experimentalKeystrokeNotifier(),
  ];
}

/** Send `notice` to every notifier whose minSeverity is met AND whose
 *  available() returns true. Runs in parallel. Best-effort; never throws. */
export async function notifyAll(
  notice: NotifyNotice,
  notifiers: Notifier[],
): Promise<NotifyResult[]> {
  // Pre-filter: severity threshold + availability.
  const eligible: Notifier[] = [];
  await Promise.all(notifiers.map(async (n) => {
    if (!severityAtLeast(notice.severity, n.minSeverity)) return;
    try {
      if (await n.available()) eligible.push(n);
    } catch { /* treat as unavailable */ }
  }));
  // Dispatch in parallel.
  const results = await Promise.all(eligible.map((n) =>
    n.send(notice).catch((e: Error): NotifyResult => ({
      notifierId: n.id, ok: false, ms: 0, error: e.message,
    })),
  ));
  return results;
}

/** Quick listing for status / audit UIs. */
export interface NotifierStatus {
  id: string;
  label: string;
  available: boolean;
  minSeverity: Severity;
}
export async function notifierStatuses(notifiers: Notifier[]): Promise<NotifierStatus[]> {
  return Promise.all(notifiers.map(async (n) => ({
    id: n.id,
    label: n.label,
    available: await n.available().catch(() => false),
    minSeverity: n.minSeverity,
  })));
}
