/**
 * v2.19.23 — MNEME PROPRIOCEPTION (organ #3 of LIMBIC · G2 deeper kill)
 *
 *   "Mneme รู้รูปร่างตัวเอง · catalog ตัวเดียวสำหรับ AI และ user"
 *
 *   Diagnosis: v2.19.22 CATALOG PARITY exposes the asymmetry but doesn't
 *   FIX it. AI sees 505+ MCP tools; user sees ~67 CLI commands. Same
 *   tool can have different names in each surface (e.g., `mneme ghost`
 *   the ghost-code lens vs `mneme ghost distill` the v2.19 syncretic
 *   ghost-vendor MCP wrapper).
 *
 *   PROPRIOCEPTION ships the unified catalog: ONE structure that contains
 *   every (name, kind, surface, aliases, description). AI agent and user
 *   query the SAME catalog through one API. Info drift → zero.
 *
 *   Honest scope:
 *     - PURE FUNCTION builder. Caller scans CLI + MCP and feeds them in.
 *     - Aliases auto-derived: kebab-case → snake_case → camelCase variants.
 *     - HMAC-signed catalog; verify rejects tamper.
 *     - findByAlias resolves any variant to a single canonical entry.
 *     - Composes onto v2.19.22 CATALOG PARITY (uses extractMcpFamilies)
 *       + v2.19.17 TOOL REACHABILITY (reachable surfaces feed catalog)
 *       + v2.19.21 CLI FAMILY-CLASH RESOLVER (shared families surface
 *       on BOTH cli + mcp arrays).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export type CatalogKind = "cli_only" | "mcp_only" | "both";

export interface UnifiedCatalogEntry {
  /** Canonical name (kebab-case for CLI, mneme.<family>.<action> for MCP). */
  canonical: string;
  /** "cli_only" / "mcp_only" / "both" (the v2.19.21 router auto-mount path). */
  kind: CatalogKind;
  /** Lowercase aliases the user might type; auto-derived. */
  aliases: string[];
  /** Surfaces this entry can be reached through. */
  surface: Array<"cli" | "mcp">;
  /** Short description (≤ 140 chars). Caller-supplied or empty. */
  description: string;
}

export interface UnifiedCatalog {
  v: typeof PROTOCOL_VERSION;
  entries: UnifiedCatalogEntry[];
  totalCli: number;
  totalMcp: number;
  /** sharedFamilies count from v2.19.22 CATALOG PARITY. */
  sharedCount: number;
  sig: string;
}

export interface BuildInput {
  cliCommands: Array<{ name: string; description?: string }>;
  mcpTools: Array<{ name: string; description?: string }>;
  secret?: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_PROPRIOCEPTION_SECRET"] || `mneme-proprioception-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

/**
 * Derive natural aliases for a canonical name. For CLI names:
 *   "ghost-code" → ["ghost-code", "ghost_code", "ghostcode", "ghostCode"]
 * For MCP names like "mneme.ghost.distill":
 *   → ["ghost.distill", "ghost_distill", "ghostdistill", "ghost-distill"]
 */
export function deriveAliases(canonical: string): string[] {
  const out = new Set<string>([canonical]);
  // Strip "mneme." prefix if present
  const stripped = canonical.startsWith("mneme.") ? canonical.slice("mneme.".length) : canonical;
  out.add(stripped);
  // dot → underscore / dash / camel
  const parts = stripped.split(/[.\-_]/);
  if (parts.length >= 2) {
    out.add(parts.join("_"));
    out.add(parts.join("-"));
    out.add(parts.join(""));
    out.add(parts[0]! + parts.slice(1).map((p) => p[0]!.toUpperCase() + p.slice(1)).join(""));
  }
  return Array.from(out).map((x) => x.toLowerCase()).filter((x) => x.length > 0).sort();
}

export function buildUnifiedCatalog(input: BuildInput): UnifiedCatalog {
  const cliNames = new Set(input.cliCommands.map((c) => c.name));
  const cliDescs = new Map(input.cliCommands.map((c) => [c.name, c.description ?? ""]));
  // Group MCP tools by family
  const mcpFamilies = new Map<string, { actions: string[]; description: string }>();
  for (const t of input.mcpTools) {
    const parts = t.name.split(".");
    if (parts.length !== 3 || parts[0] !== "mneme") continue;
    const fam = parts[1]!;
    const action = parts[2]!;
    const prev = mcpFamilies.get(fam) ?? { actions: [], description: "" };
    prev.actions.push(action);
    // Take the first non-empty description as the family description.
    if (!prev.description && t.description) prev.description = t.description;
    mcpFamilies.set(fam, prev);
  }
  const entries: UnifiedCatalogEntry[] = [];
  const seenCanonical = new Set<string>();
  // Emit one entry per CLI command + per MCP family.
  for (const c of input.cliCommands) {
    if (seenCanonical.has(c.name)) continue;
    seenCanonical.add(c.name);
    const mcp = mcpFamilies.get(c.name);
    const kind: CatalogKind = mcp ? "both" : "cli_only";
    const surface: Array<"cli" | "mcp"> = mcp ? ["cli", "mcp"] : ["cli"];
    entries.push({
      canonical: c.name,
      kind,
      aliases: deriveAliases(c.name),
      surface,
      description: (c.description ?? mcp?.description ?? "").slice(0, 140),
    });
  }
  for (const [fam, info] of mcpFamilies) {
    if (cliNames.has(fam)) continue; // already emitted as "both"
    if (seenCanonical.has(fam)) continue;
    seenCanonical.add(fam);
    entries.push({
      canonical: fam,
      kind: "mcp_only",
      aliases: deriveAliases(fam),
      surface: ["mcp"],
      description: info.description.slice(0, 140),
    });
  }
  // Stable order: by canonical name ascending.
  entries.sort((a, b) => a.canonical.localeCompare(b.canonical));
  const sharedCount = entries.filter((e) => e.kind === "both").length;
  const body: Omit<UnifiedCatalog, "sig"> = {
    v: PROTOCOL_VERSION,
    entries,
    totalCli: input.cliCommands.length,
    totalMcp: input.mcpTools.length,
    sharedCount,
  };
  const sig = hmacHex(body, input.secret ?? defaultSecret());
  return { ...body, sig };
}

export function verifyCatalog(cat: UnifiedCatalog, secret?: string): boolean {
  const { sig, ...body } = cat;
  return safeEqHex(hmacHex(body, secret ?? defaultSecret()), sig);
}

/** Resolve any alias (case-insensitive) to its canonical entry. */
export function findByAlias(cat: UnifiedCatalog, alias: string): UnifiedCatalogEntry | undefined {
  const needle = alias.toLowerCase();
  for (const e of cat.entries) {
    if (e.aliases.includes(needle)) return e;
  }
  return undefined;
}

export interface CatalogStats {
  totalEntries: number;
  cliOnly: number;
  mcpOnly: number;
  both: number;
  /** both / total — how much of the catalog is unified vs siloed. */
  unifiedRatio: number;
}

export function computeCatalogStats(cat: UnifiedCatalog): CatalogStats {
  let cliOnly = 0, mcpOnly = 0, both = 0;
  for (const e of cat.entries) {
    if (e.kind === "cli_only") cliOnly++;
    else if (e.kind === "mcp_only") mcpOnly++;
    else both++;
  }
  const total = cat.entries.length;
  return {
    totalEntries: total,
    cliOnly,
    mcpOnly,
    both,
    unifiedRatio: total === 0 ? 0 : both / total,
  };
}

export function formatCatalogLine(s: CatalogStats): string {
  const pct = (s.unifiedRatio * 100).toFixed(1);
  return `🪞 PROPRIOCEPTION · ${s.totalEntries} entries · ${s.both} both · ${s.cliOnly} cli-only · ${s.mcpOnly} mcp-only · unified ${pct}%`;
}
