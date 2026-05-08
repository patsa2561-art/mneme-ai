/**
 * Genome Annotator (G1) — functional domain tagging for MCP tools.
 *
 * Like genome annotation pipelines (Pfam / GO terms), every tool gets
 * tagged with WHAT FUNCTION it serves. AI agents reason about tools by
 * domain + cousin relationship, not just name.
 *
 * Pure function. No I/O. Deterministic.
 */

export type FunctionalDomain =
  | "search"      // returns existing data (memory.*, dna.search, ecosystem tools)
  | "mutate"      // changes state (init, index, audit-log enable, key rotate)
  | "verify"      // gate / certify / refuse (audit, verifier, scrubber)
  | "compose"     // composer / orchestrator / pipeline tools
  | "regulate"    // changes other tools' behavior (constitution, security toggle)
  | "augment"     // enriches data with metadata (tribal-fetcher, augmentation)
  | "observe"     // metrics / dashboards / read-only telemetry
  | "synthesize"; // runtime tool generation (G5 de novo)

export type Mutability = "read-only" | "stateful" | "side-effecting";

export interface ToolDescriptor {
  name: string;
  /** Free-form description (we extract sub-domains from it). */
  description?: string;
  /** Optional parent hint for phylogeny. */
  parent?: string;
  /** Optional pre-supplied tags (we merge with auto-extracted). */
  tags?: string[];
}

export interface AnnotatedTool {
  name: string;
  domain: FunctionalDomain;
  subDomains: string[];
  mutability: Mutability;
  /** "Genus" — the higher-level category from the tool name. */
  genus: string;
  /** "Species" — the verb portion of the tool name. */
  species: string;
  parent?: string;
  /** Phylogenetic depth from root; root = 0. Filled by phylogeny module. */
  depth?: number;
}

/**
 * Functional-domain heuristics. Order matters — first match wins.
 * These are conservative; ambiguous tools default to "search".
 */
const DOMAIN_RULES: Array<{ pattern: RegExp; domain: FunctionalDomain }> = [
  { pattern: /\b(verify|certify|gate|sniper|grade|scrub|refuse)/i, domain: "verify" },
  { pattern: /\b(rotate|init|index|enable|disable|install|configure|mutate|update|delete)/i, domain: "mutate" },
  { pattern: /\b(compose|orchestrate|pipeline|chain|combine)/i, domain: "compose" },
  { pattern: /\b(constitution|security\.\b|policy|rule|operon)/i, domain: "regulate" },
  { pattern: /\b(augment|enrich|annotate|tribal|context-add)/i, domain: "augment" },
  { pattern: /\b(metric|dashboard|stats|report|status|inspect|observe|hkd|tws|cvr|hrr|rei|kah|pcs)/i, domain: "observe" },
  { pattern: /\b(synthesize|generate|de.novo|spawn)/i, domain: "synthesize" },
  { pattern: /\b(search|find|list|show|query|get|read|cite|recall|memory)/i, domain: "search" },
];

const STATEFUL_HINTS = /\b(audit-log|session|federation|daemon|lifecycle|toggle)/i;
const SIDE_EFFECTING = /\b(rotate|enable|disable|delete|reset|index|push|publish|install|webhook\.add)/i;

/**
 * Annotate a single tool descriptor. Pure function.
 */
export function annotateTool(tool: ToolDescriptor): AnnotatedTool {
  const haystack = `${tool.name} ${tool.description ?? ""} ${(tool.tags ?? []).join(" ")}`;
  let domain: FunctionalDomain = "search";
  for (const rule of DOMAIN_RULES) {
    if (rule.pattern.test(haystack)) {
      domain = rule.domain;
      break;
    }
  }

  // Mutability — independent of domain
  let mutability: Mutability = "read-only";
  if (SIDE_EFFECTING.test(haystack)) mutability = "side-effecting";
  else if (STATEFUL_HINTS.test(haystack)) mutability = "stateful";
  else if (domain === "mutate" || domain === "synthesize") mutability = "side-effecting";
  else if (domain === "regulate") mutability = "stateful";

  // Genus / Species from name
  const parts = tool.name.split(".");
  const genus = parts.length >= 2 ? parts.slice(0, -1).join(".") : tool.name;
  const species = parts.length >= 2 ? parts[parts.length - 1]! : "root";

  // Sub-domains: every distinctive token in the name + tags
  const tokens = new Set<string>();
  for (const part of parts) {
    for (const token of part.split(/[_\-]/)) {
      const t = token.toLowerCase();
      if (t.length >= 3 && t !== "mneme") tokens.add(t);
    }
  }
  for (const tag of tool.tags ?? []) tokens.add(tag.toLowerCase());

  return {
    name: tool.name,
    domain,
    subDomains: Array.from(tokens).sort(),
    mutability,
    genus,
    species,
    parent: tool.parent,
  };
}

export interface CatalogAnnotation {
  tools: AnnotatedTool[];
  byDomain: Record<FunctionalDomain, AnnotatedTool[]>;
  byGenus: Record<string, AnnotatedTool[]>;
  /** Counts per domain — useful for stats. */
  domainCounts: Record<FunctionalDomain, number>;
}

/**
 * Annotate a whole tool catalog. Pure function.
 */
export function annotateCatalog(tools: ToolDescriptor[]): CatalogAnnotation {
  const annotated = tools.map(annotateTool);
  const byDomain: Record<string, AnnotatedTool[]> = {};
  const byGenus: Record<string, AnnotatedTool[]> = {};
  const counts: Record<string, number> = {};

  for (const t of annotated) {
    if (!byDomain[t.domain]) byDomain[t.domain] = [];
    byDomain[t.domain]!.push(t);
    counts[t.domain] = (counts[t.domain] ?? 0) + 1;

    if (!byGenus[t.genus]) byGenus[t.genus] = [];
    byGenus[t.genus]!.push(t);
  }
  // Sort each bucket alphabetically for determinism
  for (const k of Object.keys(byDomain)) byDomain[k]!.sort((a, b) => a.name.localeCompare(b.name));
  for (const k of Object.keys(byGenus)) byGenus[k]!.sort((a, b) => a.name.localeCompare(b.name));

  return {
    tools: annotated,
    byDomain: byDomain as Record<FunctionalDomain, AnnotatedTool[]>,
    byGenus: byGenus,
    domainCounts: counts as Record<FunctionalDomain, number>,
  };
}

export const SUPPORTED_DOMAINS: ReadonlyArray<FunctionalDomain> = [
  "search", "mutate", "verify", "compose", "regulate", "augment", "observe", "synthesize",
];
