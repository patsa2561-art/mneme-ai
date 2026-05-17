/**
 * v2.19.22 — MNEME CATALOG PARITY (G2 quick-win)
 *
 *   User audit (G2): "AI agent via MCP sees 505+ tools; user types
 *    `mneme --help` and sees ~67 legacy top-level commands. AI and
 *    user use Mneme คนละตัว — situation where AI talks about a tool
 *    user can't find. Root cause of 'AI hallucinates a Mneme tool'
 *    class."
 *
 *   v2.19.22 ships pure-function parity checker. Given the list of
 *   CLI top-level commands (caller scans `program.commands` at boot)
 *   and the list of MCP tool names (from buildAllTools()), compute:
 *
 *     - mcp_only families: MCP families with no top-level legacy
 *       command sharing the family name. These ARE reachable via
 *       the v2.19.21 router auto-mount when a clash exists, but
 *       become standalone children otherwise.
 *
 *     - legacy_only commands: top-level CLI commands with no
 *       corresponding mneme.<command>.* MCP family. Those are
 *       pure legacy lenses; ok to leave but flag for visibility.
 *
 *     - shared families: BOTH (router mounts MCP children onto
 *       the legacy parent — v2.19.21 fix).
 *
 *     - parityRatio: shared / total — measure of overlap. Higher
 *       is better (= fewer hidden tools).
 *
 *   Output: HMAC-signed PARITY REPORT so a future ritual can
 *   gate publish on a parity threshold.
 *
 * Honest scope:
 *   - PURE FUNCTION. Caller scans the CLI registry + MCP catalog
 *     and feeds the names in. We don't touch the filesystem.
 *   - Reports asymmetries, doesn't FIX them. Fix is in
 *     v2.19.21 router (which auto-mounts) + reachability gate
 *     (which blocks ghost tools).
 *   - parityRatio is a UX-quality metric, not a correctness
 *     guarantee. 100% parity means every CLI command has an MCP
 *     counterpart and vice versa.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export interface CatalogParityInput {
  cliTopLevelCommands: string[];
  mcpToolNames: string[];
  secret?: string;
}

export interface CatalogParityReport {
  v: typeof PROTOCOL_VERSION;
  totalCliCommands: number;
  totalMcpTools: number;
  totalMcpFamilies: number;
  /** MCP families that ALSO appear as a top-level CLI command (v2.19.21 mount-on-existing path). */
  sharedFamilies: string[];
  /** MCP families that DON'T have a top-level CLI command of the same name (router registered them as standalone). */
  mcpOnlyFamilies: string[];
  /** Top-level CLI commands with NO corresponding mneme.<name>.* MCP family. */
  legacyOnlyCommands: string[];
  /** shared / (mcpOnly + sharedCount); 0..1; higher is more overlap. */
  parityRatio: number;
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_CATALOG_PARITY_SECRET"] || `mneme-catalog-parity-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

/** Extract `mneme.<family>.<action>` names → unique family set. */
export function extractMcpFamilies(mcpToolNames: string[]): Set<string> {
  const out = new Set<string>();
  for (const n of mcpToolNames) {
    const parts = n.split(".");
    if (parts.length === 3 && parts[0] === "mneme") out.add(parts[1]!);
  }
  return out;
}

export function computeParity(input: CatalogParityInput): CatalogParityReport {
  const mcpFamilies = extractMcpFamilies(input.mcpToolNames);
  const cliSet = new Set(input.cliTopLevelCommands);
  const shared: string[] = [];
  const mcpOnly: string[] = [];
  for (const fam of mcpFamilies) {
    if (cliSet.has(fam)) shared.push(fam);
    else mcpOnly.push(fam);
  }
  const legacyOnly: string[] = [];
  for (const cmd of input.cliTopLevelCommands) {
    if (!mcpFamilies.has(cmd)) legacyOnly.push(cmd);
  }
  shared.sort();
  mcpOnly.sort();
  legacyOnly.sort();
  const denom = shared.length + mcpOnly.length;
  const parityRatio = denom === 0 ? 0 : shared.length / denom;
  const body: Omit<CatalogParityReport, "sig"> = {
    v: PROTOCOL_VERSION,
    totalCliCommands: input.cliTopLevelCommands.length,
    totalMcpTools: input.mcpToolNames.length,
    totalMcpFamilies: mcpFamilies.size,
    sharedFamilies: shared,
    mcpOnlyFamilies: mcpOnly,
    legacyOnlyCommands: legacyOnly,
    parityRatio,
  };
  const sig = hmacHex(body, input.secret ?? defaultSecret());
  return { ...body, sig };
}

export function verifyParityReport(r: CatalogParityReport, secret?: string): boolean {
  const { sig, ...body } = r;
  return safeEqHex(hmacHex(body, secret ?? defaultSecret()), sig);
}

export function formatParityLine(r: CatalogParityReport): string {
  const pct = (r.parityRatio * 100).toFixed(1);
  return `🪞 PARITY · ${r.sharedFamilies.length} shared · ${r.mcpOnlyFamilies.length} mcp-only · ${r.legacyOnlyCommands.length} legacy-only · ratio ${pct}%`;
}
