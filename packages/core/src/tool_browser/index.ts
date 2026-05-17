/**
 * v2.19.33 B3 fix — MNEME TOOL BROWSER (discoverability for 600+ tools)
 *
 *   User-audit diagnosis (2026-05-17):
 *   "STARTER tier เล็กไป (13/594 = 2.2%) ... 97.8% hidden from default view.
 *    ปัญหาแม่นยำคือ discoverability ไม่ใช่ catalog size.
 *    Wisdom fix:
 *      - expand STARTER ไป ~30-40 tools (~5-7%)
 *      - เพิ่ม mneme browse — interactive TUI explorer ของ 594 tools
 *      - เพิ่ม mneme suggest — repo-aware tool recommendations
 *      - wisdom: discoverability = curated tour, not just curated subset"
 *
 *   v2.19.33 ships two pure-function helpers + 2 MCP wrappers:
 *
 *     browseCatalog({tier?, family?, query?, limit?, offset?})
 *       → paginated list of tool descriptions filtered + sorted by tier
 *       → caller (CLI / MCP) renders the page
 *
 *     suggestTools({recentActions?, repoSignals?, intent?, limit?})
 *       → returns top-N tool recommendations based on:
 *         - recent CLI activity (tail of .mneme/cli-activity.jsonl)
 *         - repo signals (presence of package.json / Cargo.toml / git history)
 *         - explicit intent string
 *       → SCORED + sorted; deterministic given the same input
 *
 *   Both stay pure (no I/O). The caller supplies the catalog snapshot +
 *   activity tail; this module ranks + filters.
 *
 * Composes onto:
 *   - v2.19.24 TOOL TIER (consumes Tier classification)
 *   - v2.19.32 HANDOFF SNAPSHOT (recentActivity format reused)
 *
 * Honest scope:
 *   - PURE FUNCTION. Never throws. Caller supplies I/O.
 *   - Deterministic ranking (no Math.random in scoring).
 *   - 24/7 safe: 1000 random browse/suggest calls never crash.
 */

const PROTOCOL_VERSION = 1 as const;

export interface ToolCatalogEntry {
  name: string;
  description?: string;
  category?: string;
  tier?: "starter" | "explorer" | "deep" | "experimental";
  triggers?: string[];
}

export interface BrowsePage {
  v: typeof PROTOCOL_VERSION;
  totalMatches: number;
  pageOffset: number;
  pageLimit: number;
  entries: ToolCatalogEntry[];
  /** ASCII summary line — "🔎 BROWSE 32 of 647 tools (page 1/21)". */
  pulseLine: string;
}

export interface BrowseInput {
  catalog: ToolCatalogEntry[];
  /** Filter to a tier; default = all tiers. */
  tier?: "starter" | "explorer" | "deep" | "experimental";
  /** Filter to a family prefix (e.g., "synapse" matches mneme.synapse.*). */
  family?: string;
  /** Substring search across name + description + triggers. */
  query?: string;
  /** Max entries per page (default 30). */
  limit?: number;
  /** Pagination offset (default 0). */
  offset?: number;
}

/** Paginated catalog browse. Pure; no I/O. */
export function browseCatalog(input: BrowseInput): BrowsePage {
  const limit = input.limit && input.limit > 0 ? Math.min(input.limit, 200) : 30;
  const offset = input.offset && input.offset >= 0 ? input.offset : 0;
  const cat = Array.isArray(input.catalog) ? input.catalog : [];

  const q = (input.query ?? "").toLowerCase().trim();
  const family = (input.family ?? "").toLowerCase().trim();

  const filtered = cat.filter((e) => {
    if (!e || typeof e.name !== "string") return false;
    if (input.tier && e.tier !== input.tier) return false;
    if (family) {
      const parts = e.name.toLowerCase().split(".");
      const fam = parts[1] ?? "";
      if (fam !== family && !fam.startsWith(family)) return false;
    }
    if (q) {
      const hay = [e.name, e.description ?? "", (e.triggers ?? []).join(" ")].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Stable, deterministic sort: starter > explorer > deep > experimental, then alpha by name.
  const tierRank: Record<string, number> = { starter: 0, explorer: 1, deep: 2, experimental: 3 };
  filtered.sort((a, b) => {
    const ra = tierRank[a.tier ?? "deep"] ?? 9;
    const rb = tierRank[b.tier ?? "deep"] ?? 9;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });

  const total = filtered.length;
  const entries = filtered.slice(offset, offset + limit);
  const pageNum = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const filterDesc = [
    input.tier ? `tier=${input.tier}` : "",
    family ? `family=${family}` : "",
    q ? `query="${q}"` : "",
  ].filter(Boolean).join(" ");
  const pulseLine = `🔎 BROWSE ${entries.length}/${total} tools (page ${pageNum}/${totalPages})${filterDesc ? ` · ${filterDesc}` : ""}`;

  return {
    v: PROTOCOL_VERSION,
    totalMatches: total,
    pageOffset: offset,
    pageLimit: limit,
    entries,
    pulseLine,
  };
}

export interface ActivityRecord {
  action: string;
  ts: number;
}

export interface RepoSignals {
  hasPackageJson?: boolean;
  hasCargoToml?: boolean;
  hasGoMod?: boolean;
  hasPyprojectToml?: boolean;
  hasDotGit?: boolean;
  hasGithubActions?: boolean;
  hasDockerfile?: boolean;
  recentCommitCount?: number;
  hasUncommittedChanges?: boolean;
  /** Languages detected (caller fills from file scan). */
  languages?: string[];
}

export interface SuggestInput {
  catalog: ToolCatalogEntry[];
  recentActions?: ActivityRecord[];
  repoSignals?: RepoSignals;
  /** Optional natural-language intent ("I want to audit my last commit"). */
  intent?: string;
  /** Max suggestions to return (default 5). */
  limit?: number;
}

export interface SuggestionEntry {
  tool: ToolCatalogEntry;
  score: number;
  reasons: string[];
}

export interface SuggestionResult {
  v: typeof PROTOCOL_VERSION;
  suggestions: SuggestionEntry[];
  pulseLine: string;
}

/**
 * Suggest top-N tools for the caller's current context.
 * Deterministic scoring: same inputs → same suggestions in same order.
 */
export function suggestTools(input: SuggestInput): SuggestionResult {
  const cat = Array.isArray(input.catalog) ? input.catalog : [];
  const limit = input.limit && input.limit > 0 ? Math.min(input.limit, 20) : 5;
  const recent = Array.isArray(input.recentActions) ? input.recentActions : [];
  const signals = input.repoSignals ?? {};
  const intent = (input.intent ?? "").toLowerCase().trim();

  // Build a "recently-used" map for cooldown (don't re-suggest tools the user just ran).
  const recentNames = new Set<string>();
  for (const r of recent.slice(-50)) {
    if (r && typeof r.action === "string") recentNames.add(r.action.toLowerCase());
  }

  const scored: SuggestionEntry[] = [];
  for (const tool of cat) {
    if (!tool || typeof tool.name !== "string") continue;
    let score = 0;
    const reasons: string[] = [];

    // +tier bias (starter gets a small first-run nudge)
    if (tool.tier === "starter") { score += 0.5; reasons.push("starter tier"); }
    else if (tool.tier === "explorer") { score += 0.2; reasons.push("explorer tier"); }

    // -recency penalty (cool down recently-used tools)
    if (recentNames.has(tool.name.toLowerCase())) { score -= 1.5; reasons.push("recently used (cooldown)"); }

    // +intent match (substring across name/description/triggers)
    if (intent) {
      const hay = [tool.name, tool.description ?? "", (tool.triggers ?? []).join(" ")].join(" ").toLowerCase();
      if (hay.includes(intent)) { score += 2.0; reasons.push(`matches intent "${intent}"`); }
      else {
        // Token overlap for fuzzy intent matching
        const intentTokens = intent.split(/\s+/).filter((t) => t.length > 2);
        let hits = 0;
        for (const t of intentTokens) if (hay.includes(t)) hits++;
        if (hits > 0) { score += 0.3 * hits; reasons.push(`partial intent match (${hits} tokens)`); }
      }
    }

    // +repo-signal nudges (deterministic; pure)
    if (signals.hasPackageJson && /\b(?:antivirus|guard|truth)\b/.test(tool.name)) {
      score += 0.4; reasons.push("Node repo signal");
    }
    if (signals.hasUncommittedChanges && /\b(?:premortem|guard|antivirus|truth)\b/.test(tool.name)) {
      score += 0.6; reasons.push("uncommitted-changes signal");
    }
    if (signals.hasDotGit && /\b(?:who_knows|atrophy|why|stigmergy)\b/.test(tool.name)) {
      score += 0.3; reasons.push("git history signal");
    }
    if (signals.hasGithubActions && /\b(?:catalog|reachability|sentinel)\b/.test(tool.name)) {
      score += 0.3; reasons.push("CI signal");
    }
    if (signals.recentCommitCount && signals.recentCommitCount >= 3
        && /\b(?:why|atrophy|premortem)\b/.test(tool.name)) {
      score += 0.4; reasons.push("active development signal");
    }

    if (score > 0) scored.push({ tool, score: Math.round(score * 100) / 100, reasons });
  }

  // Sort: score desc, then alpha by name (deterministic tie-break).
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.tool.name.localeCompare(b.tool.name);
  });

  const top = scored.slice(0, limit);
  const pulseLine = top.length === 0
    ? "💡 SUGGEST · no signals — try mneme.browse to explore"
    : `💡 SUGGEST · top ${top.length} tool(s) for current context (top score ${top[0]!.score})`;

  return { v: PROTOCOL_VERSION, suggestions: top, pulseLine };
}

export interface BrowseStats {
  starterCount: number;
  explorerCount: number;
  deepCount: number;
  experimentalCount: number;
  totalTools: number;
  starterPct: number;
}

export function computeBrowseStats(catalog: ToolCatalogEntry[]): BrowseStats {
  let s = 0, e = 0, d = 0, x = 0;
  for (const t of catalog) {
    if (!t) continue;
    if (t.tier === "starter") s++;
    else if (t.tier === "explorer") e++;
    else if (t.tier === "experimental") x++;
    else d++;
  }
  const total = catalog.length;
  return {
    starterCount: s,
    explorerCount: e,
    deepCount: d,
    experimentalCount: x,
    totalTools: total,
    starterPct: total > 0 ? Math.round((s / total) * 1000) / 10 : 0,
  };
}

export function formatBrowseStatsLine(s: BrowseStats): string {
  return `🔎 CATALOG · ${s.totalTools} tools · ⭐⭐⭐${s.starterCount} (${s.starterPct}%) · ⭐⭐${s.explorerCount} · ⭐${s.deepCount} · 🔬${s.experimentalCount}`;
}

export const TOOL_BROWSER_TUNABLES = Object.freeze({
  PROTOCOL_VERSION,
  DEFAULT_PAGE_LIMIT: 30,
  MAX_PAGE_LIMIT: 200,
  DEFAULT_SUGGEST_LIMIT: 5,
});
