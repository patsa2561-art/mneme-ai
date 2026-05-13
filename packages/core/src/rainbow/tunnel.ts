/**
 * v1.90.0 -- RAINBOW: cloudflared tunnel auto-detection + start.
 *
 * Pre-condition: `cloudflared` binary on PATH (free, no account needed
 * for quick tunnels). When absent we report unavailable; caller falls
 * back to LAN-only mode.
 *
 * Tunnel lifecycle:
 *   1. detectCloudflared()    -- returns version or null
 *   2. startQuickTunnel(port) -- spawns child + waits for URL
 *   3. <use returned URL>
 *   4. stopTunnel(handle)     -- kills child + closes pipes
 */

import { spawnSync, spawn, type ChildProcess } from "node:child_process";

export interface CloudflaredDetection {
  available: boolean;
  version: string | null;
  path: string | null;
  installHint: string;
}

const INSTALL_HINT_BY_PLATFORM: Record<string, string> = {
  win32: "winget install --id Cloudflare.cloudflared  (or  scoop install cloudflare-warp)",
  darwin: "brew install cloudflared",
  linux: "Download from https://github.com/cloudflare/cloudflared/releases (or your distro package manager)",
};

export function detectCloudflared(): CloudflaredDetection {
  const hint = INSTALL_HINT_BY_PLATFORM[process.platform] ?? "see https://github.com/cloudflare/cloudflared";
  try {
    const r = spawnSync("cloudflared", ["--version"], { encoding: "utf8", windowsHide: true });
    if (r.status !== 0) {
      return { available: false, version: null, path: null, installHint: hint };
    }
    const versionLine = (r.stdout ?? "").split("\n")[0]?.trim() ?? "";
    const which = spawnSync(process.platform === "win32" ? "where" : "which", ["cloudflared"], { encoding: "utf8", windowsHide: true });
    const path = which.status === 0 ? (which.stdout ?? "").split(/\r?\n/)[0]!.trim() : null;
    return { available: true, version: versionLine, path, installHint: hint };
  } catch {
    return { available: false, version: null, path: null, installHint: hint };
  }
}

export interface TunnelHandle {
  url: string;
  process: ChildProcess;
  stop: () => void;
}

export interface StartTunnelOptions {
  port: number;
  /** Max time (ms) to wait for the trycloudflare URL line. Default 20s. */
  timeoutMs?: number;
  /** Test-only stub for the spawned child output. */
  spawnOverride?: (cmd: string, args: string[]) => ChildProcess;
}

const TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

/** Start a quick tunnel + return the public URL when it appears.
 *  Resolves null on timeout. Process keeps running until stop() called. */
export async function startQuickTunnel(opts: StartTunnelOptions): Promise<TunnelHandle | null> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const spawnFn = opts.spawnOverride ?? ((c: string, a: string[]) => spawn(c, a, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }));
  const proc = spawnFn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://localhost:${opts.port}`]);
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) { resolved = true; resolve(null); }
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      if (resolved) return;
      const m = chunk.toString().match(TUNNEL_URL_RE);
      if (m) {
        resolved = true;
        clearTimeout(timer);
        resolve({
          url: m[0],
          process: proc,
          stop: () => { try { proc.kill(); } catch { /* ignore */ } },
        });
      }
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("exit", () => {
      if (!resolved) { resolved = true; clearTimeout(timer); resolve(null); }
    });
  });
}
