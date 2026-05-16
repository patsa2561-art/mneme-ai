/**
 * v2.19.2 — MCP DRIFT DETECTOR
 *
 *   "When the user runs `mneme upgrade`, the npm package changes on disk
 *    instantly — but the MCP server child process keeps serving the
 *    catalog it loaded at boot. The AI agent's tool list silently goes
 *    stale; the user sees 'NEXUS = 0 tools' and Mneme looks broken.
 *
 *    DRIFT compares (catalog version baked in at MCP server start) vs
 *    (currently-installed Mneme version on disk). Mismatch → emit a
 *    LOUD, signed restart instruction the AI client can show the user."
 *
 * Pure local. No external deps. Composes onto v2.18 NEXUS PROACTIVE
 * (push side — the drift warning can be queued there).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const PROTOCOL_VERSION = 1 as const;

export interface DriftCheck {
  v: typeof PROTOCOL_VERSION;
  servingVersion: string;
  installedVersion: string;
  drift: boolean;
  severity: "ok" | "warn" | "critical";
  message: string;
  remedy: string;
  checkedAt: string;
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_DRIFT_SECRET"] || `mneme-mcp-drift-v${PROTOCOL_VERSION}`;
}

/**
 * Detect drift between the version the MCP server is serving (baked in
 * at boot — caller passes it) and the version currently installed.
 */
export function checkDrift(input: {
  /** Version the MCP server reports it's serving. Bake at boot from package.json. */
  servingVersion: string;
  /** Optional path to package.json of installed Mneme (defaults to walking up node_modules from cwd). */
  installedPackageJsonPath?: string;
  secret?: string;
}): DriftCheck {
  const checkedAt = new Date().toISOString();
  let installedVersion = "unknown";
  // If caller passes an explicit path, honour it ONLY (don't fall back to defaults —
  // that defeats deterministic testing of the "missing package.json" branch).
  const candidates = input.installedPackageJsonPath
    ? [input.installedPackageJsonPath]
    : [
        "node_modules/mneme-ai/package.json",
        "node_modules/@mneme-ai/core/package.json",
        "../mneme-ai/package.json",
        "../package.json",
      ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        const j = JSON.parse(readFileSync(p, "utf8"));
        if (j.version) { installedVersion = j.version; break; }
      }
    } catch { /* try next */ }
  }
  const drift = installedVersion !== "unknown" && installedVersion !== input.servingVersion;
  let severity: DriftCheck["severity"] = "ok";
  let message = `MCP catalog version = installed version (${input.servingVersion})`;
  let remedy = "(no action required)";
  if (drift) {
    // Compare semver to decide warn vs critical.
    const [sMaj = "0", sMin = "0"] = input.servingVersion.split(".");
    const [iMaj = "0", iMin = "0"] = installedVersion.split(".");
    const minorOrMajorBump = Number(iMaj) > Number(sMaj) || Number(iMin) > Number(sMin);
    severity = minorOrMajorBump ? "critical" : "warn";
    message = `🟠 MCP SERVER IS SERVING STALE CATALOG · serving v${input.servingVersion} · installed v${installedVersion}`;
    remedy = severity === "critical"
      ? `RESTART your AI client (or the Mneme MCP server) NOW so the new v${installedVersion} tools (including v2.18/v2.19/v2.19.2 families) become visible. Without restart, your AI sees the OLD tool catalog.`
      : `Consider restarting your AI client to pick up the v${installedVersion} catalog changes.`;
  }
  const body: Omit<DriftCheck, "sig"> = {
    v: PROTOCOL_VERSION,
    servingVersion: input.servingVersion,
    installedVersion,
    drift,
    severity,
    message,
    remedy,
    checkedAt,
  };
  const sig = createHmac("sha256", input.secret ?? defaultSecret()).update(canon(body)).digest("hex");
  return { ...body, sig };
}

export function verifyDriftCheck(d: DriftCheck, secret?: string): boolean {
  const { sig: claimed, ...body } = d;
  const expected = createHmac("sha256", secret ?? defaultSecret()).update(canon(body)).digest("hex");
  try { return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(claimed, "hex")); }
  catch { return false; }
}

export function formatDriftLine(d: DriftCheck): string {
  if (!d.drift) return `🛡 MCP DRIFT · clean · v${d.servingVersion}`;
  const icon = d.severity === "critical" ? "🟥" : "🟧";
  return `${icon} MCP DRIFT · serving v${d.servingVersion} ≠ installed v${d.installedVersion} · ${d.remedy}`;
}
