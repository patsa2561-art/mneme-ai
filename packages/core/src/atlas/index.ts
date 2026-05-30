/**
 * v2.21.5 — ATLAS HELP.
 *
 * "AI agents shouldn't burn 14 KB of context to discover one command."
 *
 * Six-layer discovery protocol that solves the 300+ command / 14k
 * token blast-radius without deleting any command:
 *
 *   LAYER 0 — TASTE    (~10 bytes)  5 canonical verbs always shown
 *   LAYER 1 — BLOOM    (~180 bytes) bloom-filter probe membership O(1)
 *   LAYER 2 — HOT      (~200 bytes) stigmergy / pheromone top-N
 *   LAYER 3 — TAGS     (~1 KB)      capability index
 *   LAYER 4 — INTENT   (~80 bytes)  NL → top-1 command
 *   LAYER 5 — FULL     (~14 KB)     legacy `--help --full` (escape)
 *
 * The killer move (LAYER 1): Bloom filter is 50-year-old tech, never
 * shipped as a CLI discovery primitive. 300 verb-names in ~180 bytes
 * with 100% recall and ~3% false positive. AI agent probes "does
 * verb X exist?" in O(1) without reading the menu.
 *
 * Composes with: v2.21.4 TRUST CAPSULE (atlas signed by install key),
 * v2.19.4 intent.execute (Layer 4 wraps it), v2.21.0 apoptosis
 * federation (Layer 2 pheromones cross-repo aggregatable).
 */

import { MNEME_COMMAND_CATALOG, type ManifestCommand } from "../agent_manifest.js";
import { buildBloom, probeBloom, formatBloom, parseBloom, estimateFalsePositiveRate, type BloomFilter } from "./bloom.js";
import { dropPheromone, computeHot, formatHot, type PheromoneHit, type HotVerb } from "./pheromone.js";

export { buildBloom, probeBloom, formatBloom, parseBloom, estimateFalsePositiveRate, type BloomFilter };
export { dropPheromone, computeHot, formatHot, type PheromoneHit, type HotVerb };

// ─── LAYER 0 — TASTE (5 canonical verbs) ─────────────────────────────

export interface TasteVerb {
  verb: string;
  one_line: string;
}

/** The 5 verbs that cover 95% of new-user needs. Manually curated;
 *  re-validated every release. Sorted by "first thing a fresh AI
 *  agent should call." */
export const TASTE: TasteVerb[] = [
  { verb: "mneme verify-self --score",   one_line: "Trust gate — ONE number (0-100). Run before anything else." },
  { verb: "mneme ask <question>",        one_line: "Memory + truth Q&A over the repo." },
  { verb: 'mneme do "<intent>"',         one_line: "NL → command. Plain English / Thai. Replaces --help for AI agents." },
  { verb: "mneme earthquake drift",      one_line: "Silent-vendor-drift detector for AI APIs." },
  { verb: "mneme stillness gate",        one_line: "Decide if AI should respond at all." },
];

export function formatTaste(): string {
  const lines = ["🗺  ATLAS / TASTE — 5 verbs cover 95% of needs"];
  lines.push("");
  for (const t of TASTE) {
    lines.push(`  ${t.verb.padEnd(38)} ${t.one_line}`);
  }
  lines.push("");
  lines.push("  AI agents: stop reading here. Use:");
  lines.push("    mneme --bloom         (40-byte filter; probe verb membership in O(1))");
  lines.push("    mneme --hot           (top-20 verbs by recent pheromone-weighted use)");
  lines.push("    mneme --tags          (1 KB capability index)");
  lines.push('    mneme do "<intent>"   (NL → top-1 command, in any language)');
  lines.push("");
  lines.push("  Humans (legacy):  mneme --help --full   (full 300+ command wall)");
  return lines.join("\n");
}

// ─── LAYER 1 — BLOOM (catalog → filter) ──────────────────────────────

/** Extract verb-name tokens from the catalog. A "verb" here is the
 *  third whitespace-separated token of `command` after `mneme` —
 *  `mneme earthquake drift` → "earthquake" + "earthquake drift" both
 *  inserted (filter is permissive). */
export function catalogVerbs(catalog: ManifestCommand[] = MNEME_COMMAND_CATALOG): string[] {
  const set = new Set<string>();
  for (const c of catalog) {
    const parts = c.command.split(/\s+/).filter((t) => t && t !== "mneme" && !t.startsWith("--") && !t.startsWith("<"));
    if (parts.length === 0) continue;
    set.add(parts[0]!);
    if (parts.length >= 2) set.add(`${parts[0]} ${parts[1]}`);
    if (parts.length >= 3) set.add(`${parts[0]} ${parts[1]} ${parts[2]}`);
  }
  return Array.from(set).sort();
}

/** Build the canonical bloom over the entire catalog. */
export function buildCatalogBloom(catalog: ManifestCommand[] = MNEME_COMMAND_CATALOG): BloomFilter {
  return buildBloom(catalogVerbs(catalog));
}

// ─── LAYER 3 — TAGS (capability index) ───────────────────────────────

/** Single-string semantic tag derived from the manifest group. Most
 *  groups are already domain tags; a small remap collapses obviously-
 *  related ones into shared buckets. */
export function tagFor(group: string): string {
  const MAP: Record<string, string> = {
    "mortuary": "mortuary",
    "stillness": "silence",
    "apoptosis_network": "immune",
    "time_bridge": "time",
    "ia_fabric": "fabric",
    "digital_talent": "talent",
    "memory": "memory",
    "polygraph": "truth",
    "truth_swarm": "truth",
    "earthquake": "drift",
    "bug_prophet": "drift",
    "honey": "drift",
    "compliance": "compliance",
    "soul": "soul",
    "trust": "trust",
    "antivirus": "trust",
    "vibe": "ux",
    "cognitive": "cognition",
    "innerlife": "cognition",
    "metamorphosis": "cognition",
    "synapse": "handoff",
    "permeate": "handoff",
    "telepathy": "handoff",
    "genesplice": "handoff",
    "relay": "handoff",
    "rainbow": "handoff",
    "clone": "handoff",
    "chronostasis": "axiom",
    "agreement": "axiom",
    "obelisk": "trust",
    "arena": "trust",
    "bounty": "trust",
    "evolve": "evolve",
    "evolution": "evolve",
    "infra_brain": "infra",
    "ops": "ops",
    "supernova": "ops",
    "uninstall": "ops",
    "diagnosis": "ops",
    "supersonic": "ops",
    "tune": "ops",
  };
  return MAP[group] ?? group;
}

export interface TagIndex {
  v: 1;
  tags: Record<string, string[]>;
  totalCommands: number;
}

/** Build the capability index — Map<tag, verb[]>. */
export function buildTagIndex(catalog: ManifestCommand[] = MNEME_COMMAND_CATALOG): TagIndex {
  const tags: Record<string, string[]> = {};
  for (const c of catalog) {
    const t = tagFor(c.group);
    (tags[t] ??= []).push(c.command);
  }
  for (const t of Object.keys(tags)) {
    tags[t] = Array.from(new Set(tags[t]!)).sort();
  }
  return { v: 1, tags, totalCommands: catalog.length };
}

export function formatTagIndex(idx: TagIndex, opts: { tag?: string; maxPerTag?: number; compact?: boolean } = {}): string {
  const maxPerTag = opts.maxPerTag ?? 6;
  const lines: string[] = [];
  const tags = Object.keys(idx.tags).sort();
  if (opts.tag) {
    const list = idx.tags[opts.tag];
    if (!list) return `🗺  TAGS — no commands under tag "${opts.tag}". Known tags: ${tags.join(", ")}`;
    lines.push(`🗺  TAGS / ${opts.tag} (${list.length} command${list.length === 1 ? "" : "s"})`);
    lines.push("");
    for (const c of list) lines.push(`  ${c}`);
    return lines.join("\n");
  }
  lines.push(`🗺  ATLAS / TAGS — ${idx.totalCommands} commands across ${tags.length} tags`);
  lines.push("");
  // v2.114 — COMPACT mode (used by the composed Atlas): with 100+ tags, listing
  // 6 commands per tag bloated the Atlas to ~12 KB and defeated its purpose as
  // a lean discovery surface. Compact mode prints just the tag NAMES + counts;
  // the per-tag command list is one `--tag <name>` drill-down away.
  if (opts.compact) {
    const names = tags.map((t) => `${t}(${idx.tags[t]!.length})`).join(" · ");
    lines.push(`  ${names}`);
    lines.push("");
    lines.push(`  Drill down: mneme --tags --tag <name>`);
    return lines.join("\n");
  }
  for (const t of tags) {
    const list = idx.tags[t]!;
    const shown = list.slice(0, maxPerTag).map((c) => c.replace(/^mneme\s+/, "")).join(" · ");
    const more = list.length > maxPerTag ? ` · +${list.length - maxPerTag} more` : "";
    lines.push(`  ${t.padEnd(12)} ${shown}${more}`);
  }
  lines.push("");
  lines.push(`  Drill down: mneme --tags --tag <name>`);
  return lines.join("\n");
}

// ─── LAYER 4 — INTENT (NL → command) ─────────────────────────────────

/** Naive NL router — keyword score over (what + when + command) of
 *  each manifest entry. Uses no LLM. Composes with v2.19.4
 *  intent.execute (which does HMAC-signed plans for built-in phrases).
 *  Returns top-K matches with confidence scores. */
export interface IntentMatch {
  command: string;
  group: string;
  score: number;
  rationale: string;
}

const STOPWORDS = new Set([
  "the","a","an","is","are","be","do","does","did","what","how","why","when","where","who","whom","whose",
  "i","you","my","your","we","our","it","its","this","that","these","those","of","for","to","from","on","in","at","by","with","as","and","or","but","if","then","than","so","not","no",
  "mneme","mnem","ai","ของ","ที่","ไหม","หรือ","ไม่","ก็","แล้ว","กับ","คือ","อะไร","ยังไง","ทำไม","นี้","นั้น","กิน",
]);

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && !STOPWORDS.has(w));
}

export function routeIntent(text: string, catalog: ManifestCommand[] = MNEME_COMMAND_CATALOG, topK = 3): IntentMatch[] {
  const q = tokenize(text);
  if (q.length === 0) return [];
  const ranked: IntentMatch[] = [];
  for (const c of catalog) {
    const corpus = tokenize(`${c.command} ${c.what} ${c.when} ${c.group}`);
    if (corpus.length === 0) continue;
    // Score: count of query tokens hitting corpus tokens.
    let score = 0;
    const hits: string[] = [];
    for (const t of q) {
      // Partial match: t is a substring of any corpus token.
      const hit = corpus.find((c) => c === t || c.includes(t));
      if (hit) { score += 1; hits.push(t); }
    }
    if (score > 0) {
      // Boost: command-name match counts 3×.
      const cmdTokens = tokenize(c.command);
      for (const t of q) if (cmdTokens.includes(t)) score += 2;
      ranked.push({
        command: c.command,
        group: c.group,
        score,
        rationale: hits.length > 0 ? `matched: ${hits.join(", ")}` : "(weak)",
      });
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, topK);
}

export function formatIntent(intent: string, matches: IntentMatch[]): string {
  if (matches.length === 0) {
    return `🗺  ATLAS / INTENT — no command matches "${intent}". Try \`mneme --tags\` for the capability index or \`mneme --help --full\` for the full surface.`;
  }
  const lines = [`🗺  ATLAS / INTENT — top ${matches.length} for "${intent}"`];
  lines.push("");
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    lines.push(`  ${i + 1}.  ${m.command}`);
    lines.push(`      score=${m.score}  group=${m.group}  ${m.rationale}`);
  }
  return lines.join("\n");
}

// ─── HEADLINE — atlas() composed call ────────────────────────────────

export interface Atlas {
  v: 1;
  taste: TasteVerb[];
  bloom: BloomFilter;
  tagIndex: TagIndex;
  hot: HotVerb[];
  generatedAt: string;
}

/** Build the full Atlas for a repo. Discrete + cached-friendly. */
export function buildAtlas(repoRoot: string, catalog: ManifestCommand[] = MNEME_COMMAND_CATALOG): Atlas {
  return {
    v: 1,
    taste: TASTE,
    bloom: buildCatalogBloom(catalog),
    tagIndex: buildTagIndex(catalog),
    hot: computeHot(repoRoot),
    generatedAt: new Date().toISOString(),
  };
}

export function formatAtlas(atlas: Atlas): string {
  const lines: string[] = [];
  lines.push(formatTaste());
  lines.push("");
  lines.push(`🗺  ATLAS / BLOOM — ${formatBloom(atlas.bloom)}`);
  lines.push(`     (probe via \`mneme --bloom-probe <verb>\` or `);
  lines.push(`      programmatically via \`atlas.probeBloom(filter, verb)\`)`);
  lines.push("");
  if (atlas.hot.length > 0) lines.push(formatHot(atlas.hot.slice(0, 10)));
  lines.push("");
  lines.push(formatTagIndex(atlas.tagIndex, { compact: true }));
  return lines.join("\n");
}
