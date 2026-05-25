/**
 * v2.53.0 — CATALOG COUNT single source of truth.
 *
 * Closes P1-5 from v2.52 session audit: tool count drift (787 → 812
 * → 814+9) — pulse can surface the number but docs/README chase it.
 *
 * Strategy: ONE function returns the live count + HMAC + version. All
 * docs (mneme/README/CHANGELOG) cite via this primitive — no embedded
 * literal counts anywhere outside this file.
 *
 * MCP tool surface: `mneme.catalog.count` emits the same envelope
 * (called by docs build / pulse / `mneme cheatsheet` / etc).
 *
 * Pure deterministic + defensive; never throws.
 */

import { createHmac } from "node:crypto";
import { MNEME_COMMAND_CATALOG as COMMAND_MANIFEST } from "./agent_manifest.js";

const KEY_ENV = "MNEME_CATALOG_KEY";
const DEFAULT_KEY = "mneme-catalog-v1";

export interface CatalogCount {
  /** Total tools in the manifest (CLI commands + MCP tools combined). */
  count: number;
  /** Tools per major group (memory/polygraph/nemesis/etc). */
  byGroup: Record<string, number>;
  /** Newest version that introduced a tool (highest `since`). */
  newestSince: string;
  /** ISO-8601 timestamp of this measurement. */
  at: string;
  /** Mneme version (from package.json, populated by caller). */
  mnemeVersion?: string;
  /** Signed envelope so docs that cite this can prove the number wasn't
   *  edited after the fact. */
  hmac: string;
}

function keyOf(): string {
  return process.env[KEY_ENV] ?? DEFAULT_KEY;
}

function compareSemver(a: string, b: string): number {
  const ap = a.split(".").map((x) => Number(x));
  const bp = b.split(".").map((x) => Number(x));
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const aa = ap[i] ?? 0;
    const bb = bp[i] ?? 0;
    if (aa !== bb) return aa - bb;
  }
  return 0;
}

/**
 * Build the live catalog count. Pure: every call returns the same shape
 * for the same manifest (deterministic).
 */
export function getCatalogCount(opts: { mnemeVersion?: string } = {}): CatalogCount {
  const byGroup: Record<string, number> = {};
  let newestSince = "0.0.0";
  for (const entry of COMMAND_MANIFEST) {
    const g = entry.group ?? "uncategorized";
    byGroup[g] = (byGroup[g] ?? 0) + 1;
    if (typeof entry.since === "string" && compareSemver(entry.since, newestSince) > 0) {
      newestSince = entry.since;
    }
  }
  const body = {
    count: COMMAND_MANIFEST.length,
    byGroup,
    newestSince,
    at: new Date().toISOString(),
    mnemeVersion: opts.mnemeVersion,
  };
  const hmac = createHmac("sha256", keyOf()).update(JSON.stringify(body)).digest("hex");
  return { ...body, hmac };
}

/** Verify a CatalogCount envelope. Caller passes the cited count + hmac
 *  back to confirm it wasn't tampered with. */
export function verifyCatalogCount(c: CatalogCount): boolean {
  if (!c || typeof c.hmac !== "string") return false;
  const { hmac, ...body } = c;
  const expected = createHmac("sha256", keyOf()).update(JSON.stringify(body)).digest("hex");
  return expected === hmac;
}

/**
 * Render a Markdown-friendly one-liner for docs. Pure.
 *
 *   "Mneme ships **205 tools** across 87 groups (newest in v2.53.0)."
 */
export function renderCatalogLine(c: CatalogCount): string {
  const groups = Object.keys(c.byGroup).length;
  return `Mneme ships **${c.count} tools** across ${groups} groups (newest in v${c.newestSince}).`;
}
