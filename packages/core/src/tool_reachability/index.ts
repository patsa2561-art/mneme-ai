/**
 * v2.19.17 — MNEME TOOL REACHABILITY ENGINE ("the ghost-tool killer")
 *
 *   "User audit: 'ทำแล้ว ไม่ได้ใช้ user ไม่เห็น'. The disease: an MCP
 *    tool ships, passes the orphan-wrapper gate, passes the claim-
 *    manifest gate — but never surfaces in any user-facing path. The
 *    AUTO-GENESIS gate proves a wrapper EXISTS; it doesn't prove the
 *    wrapper is REACHABLE. 'Wrapper exists but no CLI / no welcome
 *    mention / no suggested-next rule / no agent-manifest entry' = ghost
 *    tool — costs the same shipping effort, delivers zero user value.
 *
 *    TOOL REACHABILITY ENGINE counts, per MCP tool, how many DISTINCT
 *    USER-FACING SURFACES expose it. A new ritual gate
 *    'phase3.no-ghost-tools-v218' BLOCKS publish on ANY v2.18+ tool whose
 *    reachability score is 0. The 'ship a wrapper then forget to expose
 *    it' bug class becomes STRUCTURALLY IMPOSSIBLE — even an exhausted
 *    human can't release a ghost tool. This is the gate v2.19.6 was
 *    missing when 'mneme verify rubber-stamps lies' — verify-pipeline
 *    didn't compose any of the shipped primitives because nothing
 *    measured 'does this tool reach the user?'."
 *
 * Architecture:
 *   - 5 surface-scanners check distinct user-facing exposure paths:
 *       1. CLI router          — universal_mcp_subcommands auto-routes the family?
 *       2. Welcome syllabus    — agent_manifest.ts lists the tool?
 *       3. WhatsNew highlights — recent release body mentions the tool name?
 *       4. Suggested-next rules — reverse_wrapper rule fires for/to this tool?
 *       5. Capabilities tool   — _capabilities.ts surfaces this family?
 *   - `scanReachability({catalog, surfaces})` returns per-tool
 *     reachability score + which surfaces reached each tool.
 *   - `ghostToolReport()` lists tools with score=0 (the publish blockers).
 *   - HMAC-signed report so the ritual gate can verify it wasn't forged.
 *
 * Honest scope:
 *   - This module is the PROTOCOL. The ritual integration is in
 *     scripts/reincarnation-ritual.mjs (separate file, integrates via
 *     `phase3.no-ghost-tools-v218`).
 *   - Surface-scanners are INDEPENDENT — adding a new surface (e.g.,
 *     vscode commands palette) requires adding a new scanner. The
 *     module ships with 5 scanners.
 *   - Score is a COUNT of reaching surfaces, NOT a quality metric. A
 *     tool reached by 5 surfaces is "well-surfaced"; reached by 1 is
 *     "minimally reachable"; reached by 0 is GHOST.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const PROTOCOL_VERSION = 1 as const;

export type SurfaceKind =
  | "cli_router"
  | "welcome_syllabus"
  | "whats_new"
  | "suggested_next"
  | "capabilities";

export interface SurfaceSource {
  kind: SurfaceKind;
  /** Source text the scanner inspects (file contents). */
  text: string;
  /** Optional context for diagnostics. */
  source: string;
}

export interface ReachabilityHit {
  surface: SurfaceKind;
  /** Excerpt of the matching text (≤80 chars). */
  evidence: string;
}

export interface ToolReachability {
  toolName: string;
  family: string;
  action: string;
  /** Number of distinct surfaces that reach this tool. */
  score: number;
  hits: ReachabilityHit[];
  /** True when score=0; tool is a ghost. */
  ghost: boolean;
}

export interface ReachabilityReport {
  v: typeof PROTOCOL_VERSION;
  scannedAt: string;
  totalTools: number;
  ghostCount: number;
  meanScore: number;
  perTool: ToolReachability[];
  ghostList: string[];
  hmac: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_REACHABILITY_SECRET"] || `mneme-tool-reachability-v${PROTOCOL_VERSION}`;
}

function signReport(body: Omit<ReachabilityReport, "hmac">, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

// ─── SURFACE SCANNERS ────────────────────────────────────────────────────

/**
 * CLI-router scanner: the universal_mcp_subcommands.ts auto-routes ANY
 * `mneme.<family>.<action>` MCP tool to `mneme <family> <action>` CLI.
 * If the auto-router source is supplied AND it imports buildAllTools/
 * registers families dynamically → ALL families reachable; else
 * fallback: per-family search in the source.
 */
function scanCliRouter(toolName: string, surface: SurfaceSource): ReachabilityHit | null {
  const family = toolName.split(".")[1];
  if (!family) return null;
  // Universal auto-router covers ALL families that reach buildAllTools().
  if (surface.text.includes("buildAllTools") && surface.text.includes("groupByFamily")) {
    return { surface: "cli_router", evidence: `auto-routed via universal_mcp_subcommands (family=${family})` };
  }
  // Fallback: explicit per-family CLI registration.
  if (surface.text.includes(`"${family}"`) && surface.text.includes("subcommand")) {
    return { surface: "cli_router", evidence: `explicit CLI command for family ${family}` };
  }
  return null;
}

/** Welcome / agent-manifest scanner: does the syllabus list the tool name? */
function scanWelcomeSyllabus(toolName: string, surface: SurfaceSource): ReachabilityHit | null {
  if (surface.text.includes(toolName)) {
    const i = surface.text.indexOf(toolName);
    const excerpt = surface.text.slice(Math.max(0, i - 20), i + toolName.length + 40).replace(/\s+/g, " ");
    return { surface: "welcome_syllabus", evidence: excerpt.slice(0, 80) };
  }
  // Fallback: family is listed (looser but legitimate — syllabus often groups by family)
  const family = toolName.split(".")[1];
  if (family && (surface.text.includes(`mneme.${family}.`) || surface.text.includes(`group: "${family}"`))) {
    return { surface: "welcome_syllabus", evidence: `family ${family} listed in syllabus` };
  }
  return null;
}

/** WhatsNew scanner: does a recent release body mention this tool? */
function scanWhatsNew(toolName: string, surface: SurfaceSource): ReachabilityHit | null {
  if (surface.text.includes(toolName)) {
    return { surface: "whats_new", evidence: `tool mentioned in whats_new highlights` };
  }
  const family = toolName.split(".")[1];
  if (family && surface.text.includes(`mneme.${family}.`)) {
    return { surface: "whats_new", evidence: `family ${family} mentioned in whats_new` };
  }
  return null;
}

/** Suggested-next scanner: reverse_wrapper rule references this tool? */
function scanSuggestedNext(toolName: string, surface: SurfaceSource): ReachabilityHit | null {
  if (surface.text.includes(`"${toolName}"`)) {
    return { surface: "suggested_next", evidence: `tool name in reverse_wrapper rule` };
  }
  return null;
}

/** Capabilities-syllabus scanner: does _capabilities.ts surface this family? */
function scanCapabilities(toolName: string, surface: SurfaceSource): ReachabilityHit | null {
  if (surface.text.includes(toolName)) {
    return { surface: "capabilities", evidence: `tool mentioned in capabilities syllabus` };
  }
  const family = toolName.split(".")[1];
  if (family && surface.text.includes(`mneme.${family}`)) {
    return { surface: "capabilities", evidence: `family ${family} surfaced in capabilities` };
  }
  return null;
}

const SCANNERS: Record<SurfaceKind, (t: string, s: SurfaceSource) => ReachabilityHit | null> = {
  cli_router: scanCliRouter,
  welcome_syllabus: scanWelcomeSyllabus,
  whats_new: scanWhatsNew,
  suggested_next: scanSuggestedNext,
  capabilities: scanCapabilities,
};

// ─── REACHABILITY SCANNER ────────────────────────────────────────────────

export interface ScanInput {
  /** Full MCP catalog (from buildAllTools().map(t => t.name)). */
  catalog: string[];
  /** Surface source files for the scanners. Missing surfaces → not scanned. */
  surfaces: SurfaceSource[];
  /** Optional: only score tools whose name matches one of these prefixes (e.g. v2.18+ families). */
  enforceFamilies?: string[];
  nowMs?: number;
  secret?: string;
}

export function scanReachability(input: ScanInput): ReachabilityReport {
  const surfaceByKind = new Map<SurfaceKind, SurfaceSource>();
  for (const s of input.surfaces) surfaceByKind.set(s.kind, s);
  const enforce = input.enforceFamilies
    ? new Set(input.enforceFamilies.map((f) => `mneme.${f}.`))
    : null;
  const perTool: ToolReachability[] = [];
  let scoreSum = 0;
  let ghostCount = 0;
  for (const toolName of input.catalog) {
    if (!toolName.startsWith("mneme.")) continue;
    if (enforce) {
      const matched = Array.from(enforce).some((p) => toolName.startsWith(p));
      if (!matched) continue;
    }
    const parts = toolName.split(".");
    if (parts.length !== 3) continue;
    const family = parts[1]!;
    const action = parts[2]!;
    const hits: ReachabilityHit[] = [];
    for (const [kind, scanner] of Object.entries(SCANNERS) as Array<[SurfaceKind, typeof scanCliRouter]>) {
      const surface = surfaceByKind.get(kind);
      if (!surface) continue;
      const hit = scanner(toolName, surface);
      if (hit) hits.push(hit);
    }
    const score = hits.length;
    const ghost = score === 0;
    if (ghost) ghostCount++;
    scoreSum += score;
    perTool.push({ toolName, family, action, score, hits, ghost });
  }
  const totalTools = perTool.length;
  const meanScore = totalTools === 0 ? 0 : scoreSum / totalTools;
  const ghostList = perTool.filter((t) => t.ghost).map((t) => t.toolName).sort();
  const scannedAt = new Date(input.nowMs ?? Date.now()).toISOString();
  const body: Omit<ReachabilityReport, "hmac"> = {
    v: PROTOCOL_VERSION,
    scannedAt,
    totalTools,
    ghostCount,
    meanScore,
    perTool,
    ghostList,
  };
  return { ...body, hmac: signReport(body, input.secret ?? defaultSecret()) };
}

export function verifyReachabilityReport(report: ReachabilityReport, secret?: string): { ok: boolean; reason?: string } {
  const { hmac, ...body } = report;
  const expected = signReport(body, secret ?? defaultSecret());
  if (!safeEqHex(expected, hmac)) {
    return { ok: false, reason: "HMAC mismatch — forged report or wrong secret" };
  }
  return { ok: true };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────

/** Read a surface from a file path (returns null if file missing). */
export function loadSurface(kind: SurfaceKind, path: string): SurfaceSource | null {
  if (!existsSync(path)) return null;
  try {
    return { kind, text: readFileSync(path, "utf8"), source: path };
  } catch {
    return null;
  }
}

export function ghostListSummary(report: ReachabilityReport, sampleSize: number = 10): string {
  if (report.ghostCount === 0) {
    return `🎯 NO GHOSTS — every tool reachable via ≥1 user-facing surface (mean score=${report.meanScore.toFixed(2)})`;
  }
  const sample = report.ghostList.slice(0, sampleSize).join(", ");
  return `👻 ${report.ghostCount} ghost tool(s): ${sample}${report.ghostList.length > sampleSize ? "…" : ""}`;
}

export function formatReachabilityLine(t: ToolReachability): string {
  const tag = t.ghost ? "👻" : t.score >= 3 ? "🎯" : t.score >= 2 ? "✓" : "·";
  return `${tag} ${t.toolName} · score=${t.score} · surfaces=${t.hits.map((h) => h.surface).join(",")}`;
}
