/**
 * v2.60.0 — SKELETON KEY: MCP server security auditor.
 *
 * MCP ecosystem reality (2026): ~500+ servers, mostly community-built,
 * no central security review. Users wire 5-15 servers into Claude
 * Desktop / Cursor / Continue / Cline without realizing the
 * UNION of their capabilities = a much larger attack surface than any
 * individual server.
 *
 * SKELETON KEY is the first MCP security auditor. Five wild innovations:
 *
 *  1. EMPIRICAL CAPABILITY PROBE — spawn each MCP server + read its
 *     real tools/list (not name-guess). Hand-written rules can lie;
 *     a tools/list cannot.
 *
 *  2. TRANSITIVE BYPASS GRAPH — model servers as graph nodes; edges =
 *     capability overlap; compute paths to attacker goals (delete_repo,
 *     exfiltrate_secret, drop_database, etc). Most audit tools stop at
 *     single-server analysis. We compute the graph.
 *
 *  3. HMAC CONFIG PINNING — snapshot the user's MCP configs; detect
 *     tampering / silent new-server-added on next audit. Tamper-evident
 *     drift report.
 *
 *  4. RISK BUDGET — single score 0..N quantifying total surface. User
 *     sets a budget (e.g. 5.0); new servers that push over budget are
 *     refused at install time.
 *
 *  5. CWE COMPLIANCE MAPPING — every finding maps to a CWE id, making
 *     the output audit-grade for security teams.
 *
 * Pure ESM. Defensive — never throws on disk / parse / spawn errors.
 */

import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

import {
  RISK_HEURISTICS,
  UNKNOWN_HEURISTIC,
  matchHeuristic,
  type RiskHeuristic,
} from "./risk_heuristics.js";
import {
  buildBypassGraph,
  totalRiskBudget,
  type BypassGraph,
  type ServerNode,
} from "./bypass_graph.js";
import { probeServer, type ProbeResult } from "./capability_probe.js";

const KEY_ENV = "MNEME_SKELETON_KEY";
const DEFAULT_KEY = "mneme-skeleton-key-v1";
function keyOf(): string { return process.env[KEY_ENV] ?? DEFAULT_KEY; }

export interface McpServerConfig {
  /** Server name (key in the host's mcpServers map). */
  name: string;
  /** spawn command. */
  command?: string;
  /** spawn args. */
  args?: string[];
  /** env map. */
  env?: Record<string, string>;
  /** Source file the config came from. */
  source: string;
}

export interface SkeletonKeyAudit {
  ok: boolean;
  at: string;
  totalServers: number;
  /** All distinct config files that contributed servers. */
  sources: string[];
  /** Per-server risk findings, sorted by severity desc. */
  findings: Array<{
    server: string;
    risk: RiskHeuristic;
    /** "heuristic" if matched by name; "empirical" if capability-probe upgraded. */
    source: "heuristic" | "empirical" | "unknown";
    /** When empirical, the tool count we discovered. */
    toolCount?: number;
  }>;
  /** Capability overlaps + bypass paths. */
  graph: BypassGraph;
  /** Total risk budget score (sum). */
  riskBudget: number;
  /** User-set budget cap (default 5.0). */
  budgetCap: number;
  /** True iff riskBudget ≤ budgetCap. */
  withinBudget: boolean;
  /** Plain-English summary. */
  summary: string;
  /** HMAC seal of the audit body for tamper detection. */
  hmac: string;
}

export interface AuditOpts {
  /** Override discovery paths. */
  configPaths?: string[];
  /** Set the budget cap (default 5.0). */
  budgetCap?: number;
  /** Run empirical capability probe on each server (slow; ~1-2s per server). */
  empiricalProbe?: boolean;
  /** Limit empirical probe to specific server names. */
  probeOnly?: string[];
}

/** Default paths for Claude Desktop / Cursor / Continue / Cline configs. */
export function defaultConfigPaths(): string[] {
  const home = homedir();
  const paths: string[] = [];
  const plat = platform();
  if (plat === "darwin") {
    paths.push(join(home, "Library/Application Support/Claude/claude_desktop_config.json"));
    paths.push(join(home, "Library/Application Support/Cursor/User/settings.json"));
  } else if (plat === "win32") {
    const appdata = process.env["APPDATA"] ?? join(home, "AppData/Roaming");
    paths.push(join(appdata, "Claude/claude_desktop_config.json"));
    paths.push(join(appdata, "Cursor/User/settings.json"));
  } else {
    paths.push(join(home, ".config/Claude/claude_desktop_config.json"));
    paths.push(join(home, ".config/Cursor/User/settings.json"));
  }
  paths.push(join(home, ".continue/config.json"));
  paths.push(join(home, ".cline/config.json"));
  paths.push(join(home, ".codeium/windsurf/mcp_config.json"));
  // v2.135.0 — CLAUDE CODE + project-scoped MCP. Pre-v2.135 SKELETON KEY scanned
  // only Desktop/Cursor/Continue/Cline/Windsurf and reported "0 servers" on a
  // machine literally running Claude Code under it — blind to its own host.
  // Claude Code keeps MCP servers in ~/.claude.json (user scope) and <repo>/.mcp.json
  // (project scope); Cursor/VS Code also support per-project + per-user mcp.json.
  const cwd = (() => { try { return process.cwd(); } catch { return home; } })();
  paths.push(join(home, ".claude.json"));                 // Claude Code (user scope)
  paths.push(join(cwd, ".mcp.json"));                      // Claude Code (project scope)
  paths.push(join(home, ".cursor/mcp.json"));              // Cursor (user)
  paths.push(join(cwd, ".cursor/mcp.json"));               // Cursor (project)
  paths.push(join(cwd, ".vscode/mcp.json"));               // VS Code (project)
  return [...new Set(paths)];
}

/**
 * Read each config file, extract MCP server declarations.
 * Tolerates multiple known schemas: claude_desktop, cursor settings,
 * continue, cline, windsurf.
 */
export function discoverServers(configPaths: string[]): McpServerConfig[] {
  const out: McpServerConfig[] = [];
  for (const p of configPaths) {
    if (!existsSync(p)) continue;
    let parsed: Record<string, unknown> | null = null;
    try { parsed = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>; } catch { continue; }
    if (!parsed) continue;
    const candidates: Array<Record<string, unknown> | undefined> = [
      parsed["mcpServers"] as Record<string, unknown> | undefined,
      parsed["claude.mcpServers"] as Record<string, unknown> | undefined,
      (parsed["mcp"] as Record<string, unknown> | undefined)?.["servers"] as Record<string, unknown> | undefined,
      (parsed["mcp"] as Record<string, unknown> | undefined)?.["mcpServers"] as Record<string, unknown> | undefined,
    ];
    // v2.135.0 — Claude Code's ~/.claude.json nests MCP servers PER PROJECT under
    // projects[<repoPath>].mcpServers (not just top-level). Flatten those too, or
    // SKELETON KEY stays blind to the agent it runs under.
    const projects = parsed["projects"];
    if (projects && typeof projects === "object") {
      for (const proj of Object.values(projects as Record<string, unknown>)) {
        if (proj && typeof proj === "object") candidates.push((proj as Record<string, unknown>)["mcpServers"] as Record<string, unknown> | undefined);
      }
    }
    for (const block of candidates) {
      if (!block || typeof block !== "object") continue;
      for (const [name, raw] of Object.entries(block)) {
        if (!raw || typeof raw !== "object") continue;
        const r = raw as { command?: unknown; args?: unknown; env?: unknown };
        out.push({
          name,
          command: typeof r.command === "string" ? r.command : undefined,
          args: Array.isArray(r.args) ? r.args.filter((x): x is string => typeof x === "string") : undefined,
          env: r.env && typeof r.env === "object" ? r.env as Record<string, string> : undefined,
          source: p,
        });
      }
    }
  }
  // Deduplicate by name (later sources win — convention: most recent IDE wins).
  const dedup = new Map<string, McpServerConfig>();
  for (const s of out) dedup.set(s.name, s);
  return Array.from(dedup.values());
}

/**
 * Promote a heuristic risk with an empirical capability list. We MERGE
 * (empirical wins on overlap, retain heuristic for tags we didn't see).
 */
function promoteRiskWithProbe(base: RiskHeuristic, probe: ProbeResult): RiskHeuristic {
  if (!probe.reachable || probe.capabilities.length === 0) return base;
  const mergedCaps = Array.from(new Set([...probe.capabilities, ...base.capabilities]));
  // If empirical exposes more dangerous capabilities than heuristic suggested,
  // bump the severity slightly.
  const hasExec = probe.capabilities.includes("exec");
  const hasWrite = probe.capabilities.includes("write_fs") || probe.capabilities.includes("db_write") || probe.capabilities.includes("db_ddl");
  let severity = base.severity;
  if (hasExec && base.severity < 0.85) severity = Math.max(severity, 0.92);
  else if (hasWrite && base.severity < 0.65) severity = Math.max(severity, 0.72);
  return { ...base, severity, capabilities: mergedCaps };
}

export async function auditMcpConfigs(opts: AuditOpts = {}): Promise<SkeletonKeyAudit> {
  const at = new Date().toISOString();
  const paths = opts.configPaths ?? defaultConfigPaths();
  const servers = discoverServers(paths);
  const budgetCap = opts.budgetCap ?? 5.0;
  const findings: SkeletonKeyAudit["findings"] = [];
  const nodes: ServerNode[] = [];

  for (const srv of servers) {
    const heur = matchHeuristic(srv.name);
    let risk: RiskHeuristic;
    let source: "heuristic" | "empirical" | "unknown";
    let toolCount: number | undefined;
    if (heur) {
      risk = heur;
      source = "heuristic";
    } else {
      risk = UNKNOWN_HEURISTIC;
      source = "unknown";
    }
    if (opts.empiricalProbe && srv.command && (!opts.probeOnly || opts.probeOnly.includes(srv.name))) {
      const probe = await probeServer({
        name: srv.name,
        command: srv.command,
        args: srv.args,
        env: srv.env,
      });
      if (probe.reachable) {
        risk = promoteRiskWithProbe(risk, probe);
        source = "empirical";
        toolCount = probe.tools.length;
      }
    }
    findings.push({ server: srv.name, risk, source, toolCount });
    nodes.push({ name: srv.name, risk, source: srv.source });
  }
  findings.sort((a, b) => b.risk.severity - a.risk.severity);

  const graph = buildBypassGraph(nodes);
  const riskBudget = totalRiskBudget(nodes);
  const withinBudget = riskBudget <= budgetCap;
  const sources = Array.from(new Set(servers.map((s) => s.source)));

  const summary = servers.length === 0
    ? "no MCP servers discovered — install Claude Desktop / Cursor + add at least one mcpServers entry"
    : `${servers.length} MCP server(s) across ${sources.length} config(s); risk budget ${riskBudget}/${budgetCap}; ${graph.bypassPaths.length} bypass path(s); ${findings.filter((f) => f.risk.severity >= 0.85).length} critical finding(s).`;

  const body = {
    ok: withinBudget && findings.filter((f) => f.risk.severity >= 0.85).length === 0,
    at, totalServers: servers.length, sources,
    findings, graph, riskBudget, budgetCap, withinBudget, summary,
  };
  const hmac = createHmac("sha256", keyOf()).update(JSON.stringify(body)).digest("hex");
  return { ...body, hmac };
}

export function verifyAudit(a: SkeletonKeyAudit): boolean {
  if (!a || typeof a.hmac !== "string") return false;
  const { hmac, ...body } = a;
  const expected = createHmac("sha256", keyOf()).update(JSON.stringify(body)).digest("hex");
  return expected === hmac;
}

/* ── Config snapshot + drift ─────────────────────────────────────── */

export interface ConfigSnapshot {
  at: string;
  /** SHA-like digest of every discovered server (deterministic). */
  servers: Array<{ name: string; commandHash: string; source: string }>;
  hmac: string;
}

function digestCommand(cmd?: string, args?: string[]): string {
  const blob = `${cmd ?? ""}|${(args ?? []).join("|")}`;
  return createHmac("sha256", keyOf()).update(blob).digest("hex").slice(0, 16);
}

function snapshotPath(cwd: string): string {
  return join(cwd, ".mneme", "skeleton_key", "config_snapshot.json");
}

export function pinConfigSnapshot(cwd: string, configPaths?: string[]): ConfigSnapshot {
  const servers = discoverServers(configPaths ?? defaultConfigPaths());
  const body = {
    at: new Date().toISOString(),
    servers: servers.map((s) => ({
      name: s.name,
      commandHash: digestCommand(s.command, s.args),
      source: s.source,
    })),
  };
  const hmac = createHmac("sha256", keyOf()).update(JSON.stringify(body)).digest("hex");
  const snap: ConfigSnapshot = { ...body, hmac };
  try {
    mkdirSync(dirname(snapshotPath(cwd)), { recursive: true });
    writeFileSync(snapshotPath(cwd), JSON.stringify(snap, null, 2));
  } catch { /* noop */ }
  return snap;
}

export interface DriftReport {
  ok: boolean;
  hasSnapshot: boolean;
  added: Array<{ name: string; source: string }>;
  removed: Array<{ name: string; source: string }>;
  modified: Array<{ name: string; oldHash: string; newHash: string }>;
  snapshotAt?: string;
  currentAt: string;
  hint: string;
}

export function detectConfigDrift(cwd: string, configPaths?: string[]): DriftReport {
  const path = snapshotPath(cwd);
  const currentAt = new Date().toISOString();
  if (!existsSync(path)) {
    return {
      ok: false, hasSnapshot: false,
      added: [], removed: [], modified: [], currentAt,
      hint: "no snapshot pinned — run `mneme skeleton_key pin` to lock current config",
    };
  }
  let snap: ConfigSnapshot;
  try { snap = JSON.parse(readFileSync(path, "utf8")) as ConfigSnapshot; }
  catch {
    return {
      ok: false, hasSnapshot: false,
      added: [], removed: [], modified: [], currentAt,
      hint: "snapshot file unreadable / corrupted",
    };
  }
  const current = discoverServers(configPaths ?? defaultConfigPaths());
  const currentMap = new Map(current.map((s) => [s.name, { commandHash: digestCommand(s.command, s.args), source: s.source }]));
  const snapMap = new Map(snap.servers.map((s) => [s.name, s]));
  const added: DriftReport["added"] = [];
  const removed: DriftReport["removed"] = [];
  const modified: DriftReport["modified"] = [];
  for (const [name, cur] of currentMap.entries()) {
    const old = snapMap.get(name);
    if (!old) added.push({ name, source: cur.source });
    else if (old.commandHash !== cur.commandHash) modified.push({ name, oldHash: old.commandHash, newHash: cur.commandHash });
  }
  for (const [name, old] of snapMap.entries()) {
    if (!currentMap.has(name)) removed.push({ name, source: old.source });
  }
  const ok = added.length === 0 && removed.length === 0 && modified.length === 0;
  return {
    ok, hasSnapshot: true, added, removed, modified,
    snapshotAt: snap.at, currentAt,
    hint: ok
      ? "config unchanged since pin"
      : `drift detected: ${added.length} added · ${removed.length} removed · ${modified.length} modified (re-pin with \`mneme skeleton_key pin\` after review)`,
  };
}

/* ── Recommendations ─────────────────────────────────────────────── */

export interface Recommendation {
  server: string;
  severity: number;
  cwe: string;
  action: string;
}

export function buildRecommendations(audit: SkeletonKeyAudit): Recommendation[] {
  const recs: Recommendation[] = [];
  for (const f of audit.findings) {
    if (f.risk.severity < 0.55) continue;
    recs.push({
      server: f.server,
      severity: f.risk.severity,
      cwe: f.risk.cwe,
      action: f.risk.mitigation,
    });
  }
  if (audit.graph.bypassPaths.length > 0) {
    recs.push({
      server: "BYPASS GRAPH",
      severity: audit.graph.bypassPaths[0]!.weakestSeverity,
      cwe: "CWE-269",
      action: `${audit.graph.bypassPaths.length} bypass path(s) detected — narrow capability scope across servers; wrap with PASSPORT mediation.`,
    });
  }
  if (!audit.withinBudget) {
    recs.push({
      server: "RISK BUDGET",
      severity: 0.80,
      cwe: "CWE-1059",
      action: `risk budget ${audit.riskBudget} exceeds cap ${audit.budgetCap} — remove a high-severity server OR raise the cap with explicit justification.`,
    });
  }
  return recs;
}

/* ── Render banner ───────────────────────────────────────────────── */

export function renderAuditBanner(a: SkeletonKeyAudit): string {
  const lines = [
    `🦴 SKELETON KEY · ${a.summary}`,
    `   risk budget: ${a.riskBudget}/${a.budgetCap} ${a.withinBudget ? "✓" : "✗ OVER BUDGET"}`,
    `   sources: ${a.sources.join(", ") || "(none)"}`,
    "",
  ];
  for (const f of a.findings.slice(0, 10)) {
    const sym = f.risk.severity >= 0.85 ? "🚨" : f.risk.severity >= 0.65 ? "⚠ " : "·";
    const evidence = f.source === "empirical" ? `[empirical · ${f.toolCount} tools]` : "[heuristic]";
    lines.push(`   ${sym} ${f.server.padEnd(22)} ${(f.risk.severity * 100).toFixed(0).padStart(3)}%  ${f.risk.cwe}  ${f.risk.riskName} ${evidence}`);
  }
  if (a.graph.bypassPaths.length > 0) {
    lines.push("");
    lines.push(`   BYPASS PATHS (${a.graph.bypassPaths.length}):`);
    for (const bp of a.graph.bypassPaths.slice(0, 5)) {
      lines.push(`     → ${bp.narrative}`);
    }
  }
  return lines.join("\n");
}

export { RISK_HEURISTICS, UNKNOWN_HEURISTIC, matchHeuristic } from "./risk_heuristics.js";
export type { RiskHeuristic } from "./risk_heuristics.js";
export { buildBypassGraph, totalRiskBudget } from "./bypass_graph.js";
export type { BypassGraph, BypassPath, CapabilityOverlap, ServerNode } from "./bypass_graph.js";
export { probeServer } from "./capability_probe.js";
export type { ProbeInput, ProbeResult, ProbedTool } from "./capability_probe.js";
