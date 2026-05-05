/**
 * `dream` — speculative ideas from your codebase patterns.
 *
 * The premise: every codebase has *latent shape*. Authentication, payments,
 * logging, queue patterns repeat in similar idioms. Given the patterns you
 * already use, an LLM can suggest features that would fit your codebase's
 * style — citing the existing patterns it learned from.
 *
 * This is the most "AI from the future" command: instead of "what does X
 * do?", it answers "what could you build next that fits your style?"
 *
 * Pure data extraction here (signal gathering); LLM call lives in the CLI.
 */

import type { MnemeStore } from "../store/sqlite.js";

export interface RepoSignals {
  totalCommits: number;
  totalEntities: number;
  /** Top 10 most common file-extension languages by entity count. */
  languages: Array<{ name: string; count: number }>;
  /** Recent commit subjects — most recent first, capped at 30. */
  recentSubjects: string[];
  /** Modules (top-2 path segments) ranked by entity count. */
  topModules: Array<{ name: string; count: number }>;
  /** Common entity-name suffixes ("Service", "Controller", "Adapter"). */
  patternSuffixes: Array<{ suffix: string; count: number }>;
  /** Total incidents indexed (if any). */
  totalIncidents: number;
}

export interface DreamIdea {
  /** Short title, e.g. "MultiCurrencyAdapter" or "WebhookReplay". */
  title: string;
  /** 2-3 sentence pitch. */
  pitch: string;
  /** Existing patterns in the repo this idea would mirror. */
  precedents: string[];
  /** Effort hint: "small" | "medium" | "large". */
  effort: "small" | "medium" | "large";
  /** Risk hint based on what the idea touches. */
  risk: "low" | "medium" | "high";
}

/**
 * Gather signals from the indexed memory. Pure read-only — no LLM call.
 * Designed to fit into one LLM prompt without truncation.
 */
export function gatherRepoSignals(store: MnemeStore): RepoSignals {
  const totalCommits = store.countCommits();
  // Incident count via raw query — store doesn't expose a helper.
  let totalIncidents = 0;
  try {
    const row = store.db.prepare("SELECT COUNT(*) AS n FROM incidents").get() as { n: number };
    totalIncidents = row?.n ?? 0;
  } catch {
    // table may not exist yet on older DBs — treat as zero
  }

  // Language distribution from entities table.
  const langRows = store.db
    .prepare(`SELECT language, COUNT(*) AS n FROM entities GROUP BY language ORDER BY n DESC LIMIT 10`)
    .all() as Array<{ language: string; n: number }>;
  const languages = langRows.map((r) => ({ name: r.language, count: r.n }));
  const totalEntities = languages.reduce((s, l) => s + l.count, 0);

  // Recent commit subjects.
  const recentRows = store.db
    .prepare(`SELECT subject FROM commits ORDER BY author_date DESC LIMIT 30`)
    .all() as Array<{ subject: string }>;
  const recentSubjects = recentRows.map((r) => r.subject);

  // Top modules — first two path segments of file_path.
  const moduleRows = store.db
    .prepare(`SELECT file_path FROM entities`)
    .all() as Array<{ file_path: string }>;
  const moduleCounts = new Map<string, number>();
  for (const r of moduleRows) {
    const parts = r.file_path.split("/");
    const key = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0]!;
    moduleCounts.set(key, (moduleCounts.get(key) ?? 0) + 1);
  }
  const topModules = [...moduleCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Pattern suffixes — entity names ending in a CamelCase suffix tell us
  // about architectural style ("Service", "Controller", "Adapter", etc.).
  const nameRows = store.db
    .prepare(`SELECT name FROM entities WHERE kind IN ('class','function','type')`)
    .all() as Array<{ name: string }>;
  const suffixCounts = new Map<string, number>();
  const SUFFIX_RE = /([A-Z][a-z]+)$/;
  for (const r of nameRows) {
    const m = SUFFIX_RE.exec(r.name);
    if (!m) continue;
    const s = m[1]!;
    if (s.length < 4 || s.length > 20) continue;
    suffixCounts.set(s, (suffixCounts.get(s) ?? 0) + 1);
  }
  const patternSuffixes = [...suffixCounts.entries()]
    .filter(([, n]) => n >= 2)
    .map(([suffix, count]) => ({ suffix, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalCommits,
    totalEntities,
    languages,
    recentSubjects,
    topModules,
    patternSuffixes,
    totalIncidents,
  };
}

/**
 * Build the prompt for the dream LLM. Compact enough to fit a small Ollama
 * model (llama3.2:3b) without truncation, but rich enough to ground the
 * speculation in real signals.
 */
export function buildDreamPrompt(signals: RepoSignals, n: number): string {
  const lines: string[] = [];
  lines.push("Given the signals below from a real codebase, suggest exactly", String(n), "speculative");
  lines.push("ideas for features that would fit this codebase's style. Each idea should");
  lines.push("cite at least one existing pattern from the signals as a precedent.");
  lines.push("");
  lines.push(`Total commits indexed: ${signals.totalCommits}`);
  lines.push(`Total entities indexed: ${signals.totalEntities}`);
  lines.push(`Total incidents recorded: ${signals.totalIncidents}`);
  lines.push("");
  lines.push("Languages by entity count:");
  for (const l of signals.languages) lines.push(`  • ${l.name}: ${l.count}`);
  lines.push("");
  lines.push("Top modules:");
  for (const m of signals.topModules.slice(0, 8)) lines.push(`  • ${m.name} (${m.count} entities)`);
  lines.push("");
  if (signals.patternSuffixes.length > 0) {
    lines.push("Common architectural suffixes (entity names ending with):");
    for (const s of signals.patternSuffixes.slice(0, 6)) lines.push(`  • ${s.suffix} (${s.count}×)`);
    lines.push("");
  }
  lines.push("Recent commit subjects:");
  for (const s of signals.recentSubjects.slice(0, 12)) lines.push(`  • ${s}`);
  lines.push("");
  lines.push("Output format: JSON array, each element has fields:");
  lines.push("  title (string), pitch (2-3 sentences), precedents (array of pattern names),");
  lines.push("  effort ('small'|'medium'|'large'), risk ('low'|'medium'|'high').");
  lines.push("Output JSON only, no markdown, no preamble.");
  return lines.join("\n");
}

/**
 * Parse LLM JSON output into typed DreamIdea[] with permissive validation.
 * Returns [] on parse failure rather than throwing — dream is best-effort.
 */
export function parseDreamIdeas(raw: string): DreamIdea[] {
  // The LLM might wrap JSON in markdown fences or add prose before/after.
  const jsonStart = raw.indexOf("[");
  const jsonEnd = raw.lastIndexOf("]");
  if (jsonStart < 0 || jsonEnd <= jsonStart) return [];
  const slice = raw.slice(jsonStart, jsonEnd + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: DreamIdea[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title : "";
    const pitch = typeof o.pitch === "string" ? o.pitch : "";
    if (!title || !pitch) continue;
    const precedents = Array.isArray(o.precedents)
      ? o.precedents.filter((p): p is string => typeof p === "string")
      : [];
    const effort = ["small", "medium", "large"].includes(o.effort as string)
      ? (o.effort as DreamIdea["effort"])
      : "medium";
    const risk = ["low", "medium", "high"].includes(o.risk as string)
      ? (o.risk as DreamIdea["risk"])
      : "medium";
    out.push({ title, pitch, precedents, effort, risk });
  }
  return out;
}

/**
 * No-LLM fallback — generate ideas from heuristic patterns. Useful for
 * deterministic mode and as a sanity-check baseline.
 */
export function heuristicDream(signals: RepoSignals, n: number): DreamIdea[] {
  const ideas: DreamIdea[] = [];

  // Idea 1 — incident-driven, if incidents exist.
  if (signals.totalIncidents > 0) {
    ideas.push({
      title: "IncidentReplayHarness",
      pitch:
        "You already have incident data indexed. A replay harness would let you re-run an incident's commit chain against the current code to see if the bug returned.",
      precedents: ["correlate", "blast"],
      effort: "medium",
      risk: "low",
    });
  }

  // Idea 2 — pattern-suffix-driven.
  const topSuffix = signals.patternSuffixes[0];
  if (topSuffix) {
    ideas.push({
      title: `${topSuffix.suffix}Registry`,
      pitch: `You have ${topSuffix.count} entities ending in "${topSuffix.suffix}". A central registry would make discovery and DI cleaner; the pattern is already pervasive.`,
      precedents: [`${topSuffix.suffix} entities (${topSuffix.count}×)`],
      effort: "small",
      risk: "low",
    });
  }

  // Idea 3 — multi-language coverage.
  if (signals.languages.length >= 2) {
    const second = signals.languages[1]!;
    ideas.push({
      title: `${capitalize(second.name)}DeepDive`,
      pitch: `Your repo has ${second.count} entities in ${second.name} but most tooling targets the dominant language. A focused parser/linter pass would surface tribal knowledge that's currently invisible.`,
      precedents: [`${second.name} parser`],
      effort: "medium",
      risk: "medium",
    });
  }

  // Idea 4 — module-driven.
  const topMod = signals.topModules[0];
  if (topMod) {
    ideas.push({
      title: `${moduleToPascal(topMod.name)}HealthCheck`,
      pitch: `Your largest module (${topMod.name}, ${topMod.count} entities) has no central health check. A small module-level diagnostic would catch silent regressions early.`,
      precedents: [topMod.name],
      effort: "small",
      risk: "low",
    });
  }

  // Idea 5 — bus-factor.
  ideas.push({
    title: "BusFactorReport",
    pitch:
      "You already track per-author commit history. A weekly bus-factor report (which files only one person has ever touched) is a tiny extension that compounds.",
    precedents: ["mirror", "who-knows"],
    effort: "small",
    risk: "low",
  });

  return ideas.slice(0, n);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function moduleToPascal(modulePath: string): string {
  return modulePath
    .split(/[/_-]/)
    .filter(Boolean)
    .map((p) => capitalize(p))
    .join("");
}
