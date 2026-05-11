/**
 * MNEME CURATED TOOLS (v1.42.5 — #16 fix).
 *
 * Mneme's MCP catalog has 172 tools across 9 categories. Exposing the
 * full set to every AI agent is "catalog explosion" — most agents
 * (especially smaller models) thrash through tool selection. v1.35
 * shipped the TOOL CURATOR module but left it opt-in. This release
 * surfaces a hand-picked CURATED_DEFAULT_TOOLS list of 20 high-value
 * tools that cover the 80/20 of "what an AI agent needs day one,"
 * plus a CLI surface to list them. Future v1.43 will make the curated
 * subset the default exposed via MCP (with `mneme.tool.profile` to
 * unlock the full 172).
 *
 * The 20 chosen below were picked using:
 *   - usage frequency (from telemetry on the maintainer's own repo)
 *   - cross-vendor portability (no vendor-specific assumptions)
 *   - distinctness (don't expose 5 variants of the same query)
 *   - "what would an AI agent on minute-1 wish it knew about?"
 *
 * Each entry has a one-line `why` so agents that read this catalog
 * have an instant rationale, not just a name.
 */

export interface CuratedToolEntry {
  /** MCP tool name (`mneme.<category>.<verb>` shape). */
  name: string;
  /** One-line rationale — read by agents to disambiguate vs alternates. */
  why: string;
  /** Category for grouping in `mneme tools --curated`. */
  category: "intro" | "memory" | "audit" | "people" | "insights" | "quality" | "lab" | "system";
}

export const CURATED_DEFAULT_TOOLS: CuratedToolEntry[] = [
  // Day-1 onboarding
  { name: "mneme.welcome",            category: "intro",  why: "Tier-1 first call — install handoff + active feature contract" },
  { name: "mneme.capabilities",       category: "intro",  why: "Syllabus — every category + WHEN-to-use guidance" },
  { name: "mneme.smart_do",           category: "intro",  why: "Natural-language dispatcher when the agent is unsure which tool fits" },

  // Core memory layer
  { name: "mneme.memory.ask",         category: "memory", why: "Why does this code exist? — historical narrative search" },
  { name: "mneme.memory.why",         category: "memory", why: "Why does file:line exist? — focused per-line history" },

  // Compliance + audit (the moat)
  { name: "mneme.audit.session",      category: "audit",  why: "AI Session Audit — trust certificate for the current commit" },
  { name: "mneme.confess",            category: "audit",  why: "Submit a draft + get a verdict + persist to per-vendor karma" },
  { name: "mneme.replay.fingerprint", category: "audit",  why: "HMAC-chained Merkle root — tamper-evidence for any auditor" },

  // People analytics
  { name: "mneme.people.who_knows",   category: "people", why: "Find the human expert + bus-factor risk" },
  { name: "mneme.people.atrophy",     category: "people", why: "Knowledge half-life — when does a file's expert go stale?" },

  // Insights (creative + narrative)
  { name: "mneme.insights.story",     category: "insights", why: "Narrate the evolution of a topic across acts" },
  { name: "mneme.insights.decisions", category: "insights", why: "Auto-extract ADRs from commit history" },

  // Quality + safety
  { name: "mneme.quality.heartbeat",  category: "quality", why: "20-axis MRI snapshot for repo health" },
  { name: "mneme.quality.conscience", category: "quality", why: "PR risk-score against history before merge" },
  { name: "mneme.quality.bus_factor", category: "quality", why: "Files where one author owns ≥75% — fragility map" },

  // The killer differentiators
  { name: "mneme.antivirus.scan",     category: "audit",  why: "Catch hallucinations: phantom commits, ghost functions, fake packages" },
  { name: "mneme.evolve.scan",        category: "lab",    why: "Reads telemetry → proposes markdown PRs against Mneme itself" },
  { name: "mneme.precog.predict",     category: "lab",    why: "Markov + ACO pheromone — predict the AI's next likely tool call" },

  // System operations
  { name: "mneme.system.health",      category: "system", why: "One-line liveness + version + lineage + streaks" },
  { name: "mneme.system.upgrade",     category: "system", why: "Auto-upgrade — used by the AUTO-ACTION pulse pre-executor" },
];

export function listCuratedNames(): string[] {
  return CURATED_DEFAULT_TOOLS.map((t) => t.name);
}

export function curatedByCategory(): Record<CuratedToolEntry["category"], CuratedToolEntry[]> {
  const out = {} as Record<CuratedToolEntry["category"], CuratedToolEntry[]>;
  for (const t of CURATED_DEFAULT_TOOLS) {
    if (!out[t.category]) out[t.category] = [];
    out[t.category].push(t);
  }
  return out;
}
