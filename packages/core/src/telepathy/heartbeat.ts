/**
 * v1.75.0 -- VERSION TELEPATHY: Mneme's heartbeat survives the cross-vendor jump.
 *
 * The breakthrough: every soul prompt now carries a compact
 * `## Mneme Heartbeat` section -- local version, npm latest, daemon
 * state, vaccine count, repo fingerprint. The receiving AI (even one
 * that has NEVER seen Mneme) reads the heartbeat and can answer
 * "what version is Mneme on this machine?" / "is there a newer one?"
 * without running any command.
 *
 * npm-latest is cached 1h in `.mneme/telepathy/npm-cache.json` so we
 * don't hammer the registry. Works offline -- if the cache is stale
 * and the network is down, sync_status falls back to "unknown" and
 * the heartbeat still ships.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { request } from "node:https";

export interface Heartbeat {
  localVersion: string;
  npmLatest: string | null;
  syncStatus: "in-sync" | "behind" | "ahead" | "unknown";
  daemonRunning: boolean;
  vaccineCount: number;
  inboxUnsent: number;
  repoFingerprint: string;
  checkedAt: string;
}

export interface HeartbeatInput {
  localVersion: string;
  repoFingerprint: string;
  daemonRunning?: boolean;
  vaccineCount?: number;
  inboxUnsent?: number;
  /** Cache directory. Default `.mneme/telepathy`. */
  cacheDir?: string;
  /** TTL for npm-latest cache. Default 1 hour. */
  cacheTtlMs?: number;
  /** HTTPS timeout when hitting npm registry. Default 1500ms. */
  npmCheckTimeoutMs?: number;
  /** When true, skip network entirely; use only cached npm-latest. */
  offline?: boolean;
  /** Test seam: inject a fake npm fetcher (returns the latest version or null). */
  fetchOverride?: () => Promise<string | null>;
}

function cmpVersion(a: string, b: string): number {
  const ap = a.split(".").map((n) => parseInt(n, 10) || 0);
  const bp = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const ai = ap[i] ?? 0;
    const bi = bp[i] ?? 0;
    if (ai !== bi) return ai < bi ? -1 : 1;
  }
  return 0;
}

function fetchNpmLatest(timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const req = request(
      "https://registry.npmjs.org/mneme-ai/latest",
      { method: "GET", timeout: timeoutMs },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            const j = JSON.parse(body);
            resolve(typeof j.version === "string" ? j.version : null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

export async function generateHeartbeat(input: HeartbeatInput): Promise<Heartbeat> {
  const cacheDir = input.cacheDir ?? ".mneme/telepathy";
  const cachePath = join(cacheDir, "npm-cache.json");
  const ttl = input.cacheTtlMs ?? 60 * 60 * 1000;
  let npmLatest: string | null = null;

  if (existsSync(cachePath)) {
    try {
      const c = JSON.parse(readFileSync(cachePath, "utf8"));
      if (typeof c.version === "string" && typeof c.savedAt === "number" && Date.now() - c.savedAt < ttl) {
        npmLatest = c.version;
      }
    } catch {
      // corrupt cache -- ignore, will re-fetch
    }
  }

  if (npmLatest === null && !input.offline) {
    npmLatest = input.fetchOverride
      ? await input.fetchOverride()
      : await fetchNpmLatest(input.npmCheckTimeoutMs ?? 1500);
    if (npmLatest) {
      try {
        if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
        writeFileSync(cachePath, JSON.stringify({ version: npmLatest, savedAt: Date.now() }), "utf8");
      } catch {
        // ignore cache-write failures
      }
    }
  }

  let syncStatus: Heartbeat["syncStatus"] = "unknown";
  if (npmLatest) {
    const c = cmpVersion(input.localVersion, npmLatest);
    syncStatus = c === 0 ? "in-sync" : c < 0 ? "behind" : "ahead";
  }

  return {
    localVersion: input.localVersion,
    npmLatest,
    syncStatus,
    daemonRunning: input.daemonRunning ?? false,
    vaccineCount: input.vaccineCount ?? 0,
    inboxUnsent: input.inboxUnsent ?? 0,
    // Bug #1 (v1.81): default to "unknown" when caller forgot to pass
    // a fingerprint -- avoids `repoFingerprint: undefined` leaking into
    // the rendered markdown.
    repoFingerprint: input.repoFingerprint || "unknown",
    checkedAt: new Date().toISOString(),
  };
}

export function renderHeartbeatMarkdown(h: Heartbeat): string {
  const lines: string[] = [];
  lines.push(`## Mneme Heartbeat (version telepathy)`);
  lines.push(`local_version: ${h.localVersion}`);
  lines.push(`npm_latest: ${h.npmLatest ?? "(unknown)"}`);
  const statusLabel =
    h.syncStatus === "in-sync"
      ? "in-sync ✓"
      : h.syncStatus === "behind"
        ? "BEHIND ⚠"
        : h.syncStatus === "ahead"
          ? "ahead (pre-release)"
          : "unknown";
  lines.push(`sync_status: ${statusLabel}`);
  lines.push(`daemon: ${h.daemonRunning ? "running" : "stopped"}`);
  lines.push(`vaccines: ${h.vaccineCount}`);
  lines.push(`inbox_unsent: ${h.inboxUnsent}`);
  lines.push(`repo_fingerprint: ${h.repoFingerprint}`);
  lines.push(`checked_at: ${h.checkedAt}`);
  lines.push(``);
  lines.push(`### What this means (receiving AI, READ THIS):`);
  if (h.syncStatus === "behind") {
    lines.push(
      `The user's local Mneme is at v${h.localVersion}, but npm latest is v${h.npmLatest}. Tell the user: "your local Mneme is behind -- ask your editor AI to run mneme.system.upgrade".`,
    );
  } else if (h.syncStatus === "in-sync") {
    lines.push(`The user's local Mneme is in-sync with npm. The command catalog in this soul prompt is current.`);
  } else if (h.syncStatus === "ahead") {
    lines.push(
      `The user's local Mneme is ahead of npm latest -- they're running a dev build. New commands may not be documented in the npm-published manifest yet.`,
    );
  } else {
    lines.push(`Could not reach npm; treat the local version as authoritative.`);
  }
  return lines.join("\n");
}

export function parseHeartbeat(text: string): Heartbeat | null {
  // Find the heartbeat section; stop at next "## " heading or "---" divider.
  const startIdx = text.indexOf("## Mneme Heartbeat");
  if (startIdx < 0) return null;
  const tail = text.slice(startIdx);
  const stopIdx = tail.search(/^(##\s|---)/m);
  // skip the heading itself when looking for stop, so search from offset 1
  const subTail = tail.slice(1);
  const stop = subTail.search(/^(##\s|---)/m);
  const body = stop >= 0 ? tail.slice(0, stop + 1) : tail;
  void stopIdx;

  const get = (key: string): string | null => {
    const m = body.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return m ? m[1]!.trim() : null;
  };
  const localVersion = get("local_version");
  const fingerprint = get("repo_fingerprint");
  if (!localVersion || !fingerprint) return null;
  const npmRaw = get("npm_latest");
  const npmLatest = npmRaw && npmRaw !== "(unknown)" ? npmRaw : null;
  const statusRaw = get("sync_status") ?? "unknown";
  let syncStatus: Heartbeat["syncStatus"] = "unknown";
  if (statusRaw.startsWith("in-sync")) syncStatus = "in-sync";
  else if (statusRaw.startsWith("BEHIND")) syncStatus = "behind";
  else if (statusRaw.startsWith("ahead")) syncStatus = "ahead";
  return {
    localVersion,
    npmLatest,
    syncStatus,
    daemonRunning: get("daemon") === "running",
    vaccineCount: parseInt(get("vaccines") ?? "0", 10) || 0,
    inboxUnsent: parseInt(get("inbox_unsent") ?? "0", 10) || 0,
    repoFingerprint: fingerprint,
    checkedAt: get("checked_at") ?? new Date().toISOString(),
  };
}
