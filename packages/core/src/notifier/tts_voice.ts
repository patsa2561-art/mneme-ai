/**
 * Path 7 -- TTS (text-to-speech) voice notifier.
 *
 *   macOS:   `say "..."` (built-in)
 *   Linux:   `espeak "..."` (apt install espeak; soft-fail if absent)
 *   Windows: PowerShell SAPI: `Add-Type -AssemblyName System.Speech;
 *            (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak("...")`
 *
 * Default minSeverity = "critical" so we don't accidentally make Mneme
 * loud. User opts in to lower thresholds via env / settings.
 */

import { spawnSync } from "node:child_process";
import { platform as osPlatform } from "node:os";
import type { Notifier, NotifyNotice, NotifyResult, Severity } from "./types.js";

export function ttsVoiceNotifier(opts: { minSeverity?: Severity } = {}): Notifier {
  return {
    id: "tts-voice",
    label: "Spoken voice (TTS)",
    minSeverity: opts.minSeverity ?? "critical",
    async available(): Promise<boolean> {
      const p = osPlatform();
      if (p === "darwin") {
        return spawnSync("which", ["say"], { encoding: "utf8", timeout: 2000 }).status === 0;
      }
      if (p === "linux") {
        return spawnSync("which", ["espeak"], { encoding: "utf8", timeout: 2000 }).status === 0;
      }
      if (p === "win32") {
        // SAPI is built into Windows -- always available.
        return true;
      }
      return false;
    },
    async send(notice: NotifyNotice): Promise<NotifyResult> {
      const t0 = Date.now();
      const phrase = `Mneme. ${notice.title}. ${notice.body}`.slice(0, 240);
      const p = osPlatform();
      try {
        if (p === "darwin") {
          const r = spawnSync("say", [phrase], { encoding: "utf8", timeout: 8000 });
          return r.status === 0
            ? { notifierId: "tts-voice", ok: true, ms: Date.now() - t0 }
            : { notifierId: "tts-voice", ok: false, ms: Date.now() - t0, error: r.stderr ?? "say failed" };
        }
        if (p === "linux") {
          const r = spawnSync("espeak", [phrase], { encoding: "utf8", timeout: 8000 });
          return r.status === 0
            ? { notifierId: "tts-voice", ok: true, ms: Date.now() - t0 }
            : { notifierId: "tts-voice", ok: false, ms: Date.now() - t0, error: r.stderr ?? "espeak failed" };
        }
        if (p === "win32") {
          const escaped = phrase.replace(/"/g, '`"');
          const ps = `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak("${escaped}")`;
          const r = spawnSync("powershell.exe",
            ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps],
            { encoding: "utf8", timeout: 8000 });
          return r.status === 0
            ? { notifierId: "tts-voice", ok: true, ms: Date.now() - t0 }
            : { notifierId: "tts-voice", ok: false, ms: Date.now() - t0, error: (r.stderr ?? "SAPI failed").slice(0, 200) };
        }
        return { notifierId: "tts-voice", ok: false, ms: Date.now() - t0, error: `unsupported platform '${p}'` };
      } catch (e) {
        return { notifierId: "tts-voice", ok: false, ms: Date.now() - t0, error: (e as Error).message };
      }
    },
  };
}
