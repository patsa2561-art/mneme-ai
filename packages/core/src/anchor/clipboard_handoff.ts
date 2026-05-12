/**
 * v1.88.0 -- ANCHOR: OS-level clipboard handoff.
 *
 * The realistic 1-click cross-device flow user identified: USE THE
 * OS's existing cross-device clipboard sync instead of trying to
 * deploy our own. Mneme writes to the local clipboard; the OS
 * mirrors it to the phone:
 *
 *   Windows ↔ Android  -- Microsoft Phone Link (built-in Win11)
 *   macOS ↔ iOS        -- Apple Universal Clipboard (built-in)
 *   Linux ↔ Android    -- KDE Connect (free + open source)
 *
 * After setup (one-time per device pair), every Mneme handoff
 * already lives in the user's phone clipboard. Phone flow:
 *   1. Open AI app (Gemini / Claude / ChatGPT mobile)
 *   2. Long-press the input field → Paste
 *   3. Tap send
 *
 * = 2 actions on the phone. Better than typing 200 chars. ZERO
 * Mneme cloud deploy required.
 *
 * Mneme's part: detect which clipboard tool is available, write
 * with the right command, surface "no clipboard sync detected"
 * setup hints when none is found.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export type ClipboardTool = "win-clip" | "pbcopy" | "wl-copy" | "xclip" | "xsel" | "kde-connect" | "none";

export interface ClipboardCapability {
  tool: ClipboardTool;
  platform: NodeJS.Platform;
  /** Detected cross-device sync provider (best-effort heuristic). */
  crossDeviceProvider:
    | "win-phone-link"
    | "apple-universal-clipboard"
    | "kde-connect"
    | "unknown"
    | "none-detected";
  setupHint: string;
}

function which(cmd: string): boolean {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { encoding: "utf8" });
  return r.status === 0;
}

/** Detect the best clipboard tool for this OS + likely cross-device provider. */
export function detectClipboard(): ClipboardCapability {
  if (process.platform === "win32") {
    return {
      tool: "win-clip",
      platform: "win32",
      crossDeviceProvider:
        existsSync("C:\\Program Files\\WindowsApps") || existsSync("C:\\Program Files\\Microsoft\\PhoneExperienceHost.exe")
          ? "win-phone-link"
          : "unknown",
      setupHint:
        "If your phone is Android: open Phone Link on Windows + Link to Windows on the phone. After pairing, anything copied on the PC is available on the phone clipboard within seconds.",
    };
  }
  if (process.platform === "darwin") {
    return {
      tool: "pbcopy",
      platform: "darwin",
      crossDeviceProvider: "apple-universal-clipboard",
      setupHint:
        "Universal Clipboard works automatically across Macs + iPhones + iPads logged into the same Apple ID with Handoff enabled (Settings -> General -> AirDrop & Handoff).",
    };
  }
  if (process.platform === "linux") {
    if (which("wl-copy")) {
      return {
        tool: "wl-copy",
        platform: "linux",
        crossDeviceProvider: which("kdeconnect-cli") ? "kde-connect" : "unknown",
        setupHint: "Install KDE Connect on Linux + Android. Pair once; clipboards sync automatically thereafter.",
      };
    }
    if (which("xclip")) {
      return { tool: "xclip", platform: "linux", crossDeviceProvider: which("kdeconnect-cli") ? "kde-connect" : "unknown", setupHint: "Install KDE Connect on Linux + Android to enable cross-device clipboard sync." };
    }
    if (which("xsel")) {
      return { tool: "xsel", platform: "linux", crossDeviceProvider: which("kdeconnect-cli") ? "kde-connect" : "unknown", setupHint: "Install KDE Connect on Linux + Android to enable cross-device clipboard sync." };
    }
  }
  return {
    tool: "none",
    platform: process.platform,
    crossDeviceProvider: "none-detected",
    setupHint: "No clipboard CLI detected. On Windows install nothing extra; on macOS pbcopy is built-in; on Linux install xclip or wl-clipboard.",
  };
}

export interface ClipboardWriteResult {
  ok: boolean;
  tool: ClipboardTool;
  bytes: number;
  reason?: string;
}

/** Write text to the local clipboard. The OS-level sync provider (if
 *  configured) carries it to the user's phone within seconds. */
export function writeClipboard(text: string): ClipboardWriteResult {
  const cap = detectClipboard();
  if (cap.tool === "none") {
    return { ok: false, tool: "none", bytes: text.length, reason: "no clipboard tool found on this OS" };
  }
  const bytes = Buffer.byteLength(text, "utf8");
  try {
    let cmd: string;
    let args: string[];
    switch (cap.tool) {
      case "win-clip": cmd = "clip"; args = []; break;
      case "pbcopy": cmd = "pbcopy"; args = []; break;
      case "wl-copy": cmd = "wl-copy"; args = []; break;
      case "xclip": cmd = "xclip"; args = ["-selection", "clipboard"]; break;
      case "xsel": cmd = "xsel"; args = ["--clipboard", "--input"]; break;
      case "kde-connect": cmd = "kdeconnect-cli"; args = ["--share-text", text]; break;
      default: return { ok: false, tool: cap.tool, bytes, reason: "unsupported tool" };
    }
    const r = spawnSync(cmd, args, { input: cap.tool === "kde-connect" ? undefined : text, encoding: "utf8" });
    if (r.status !== 0) {
      return { ok: false, tool: cap.tool, bytes, reason: `${cmd} exited ${r.status}: ${(r.stderr ?? "").slice(0, 100)}` };
    }
    return { ok: true, tool: cap.tool, bytes };
  } catch (e) {
    return { ok: false, tool: cap.tool, bytes, reason: (e as Error).message };
  }
}

/** Render a setup hint the source AI reads to the user when no
 *  cross-device clipboard sync is configured. */
export function renderClipboardSetupHint(cap: ClipboardCapability): string {
  if (cap.crossDeviceProvider !== "none-detected" && cap.crossDeviceProvider !== "unknown") {
    return `Detected ${cap.crossDeviceProvider} — your phone clipboard already syncs with this PC. Just open the AI app on your phone and long-press → Paste.`;
  }
  return [
    "No cross-device clipboard sync is detected. To enable 1-click handoff:",
    "",
    cap.setupHint,
    "",
    "OR continue using the QR-scan flow which doesn't need any setup.",
  ].join("\n");
}
