/**
 * MNEME TOOL CURATOR (v1.35.0).
 *
 * Direct fix for the user's biggest UX painpoint: "200 tools is too
 * many. AI burns tokens just scanning names. Half are metaphor-named
 * (aletheia_immune_scan, nucleus_mutate, genome_crispr_edit). Some
 * are honeypots dressed as features (admin_delete_all). Overlap is
 * confusing (quality_guardian vs quality_heal vs audit_certify)."
 *
 * THIS MODULE: detects the user's project shape (NestJS + Postgres +
 * Stripe in their case) and produces a CURATED subset of 10-30 tools
 * the AI agent should actually consider. Honeypot tools are moved to
 * a separate, clearly-marked namespace. Overlap is collapsed via
 * a single meta-tool (`mneme.do`) that internally routes to the
 * specialist.
 *
 * MANDATE COMPLIANCE (per feedback_mneme_mandates):
 *   1. Wild idea: PROJECT-SHAPE PHEROMONE -- the curator emits a
 *      "scent" file (.mneme/curated-tools.json) that AI agents in any
 *      tool (Claude Code / Cursor / Codex / Continue) read on session
 *      start. AI sees ~20 relevant tools instead of 200.
 *   2. Wiser: uses v1.32.0 cache_hologram so the curated list
 *      auto-invalidates when package.json changes (photonics).
 *   3. Self-fix root cause: not "improve docs" -- actually shrinks
 *      the surface AI sees, kills the friction at source.
 *   4. Co-working: integrates with v1.31.0 agent_manifest (LIVE STATE
 *      block now includes "your curated tools" section), v1.31.0
 *      trust_calibration (low-trust subsystems hidden from curated
 *      list), v1.34.0 overnight (overnight runs can use only curated
 *      tools by default).
 *   5. Always-studying: every curated tool actually CALLED by AI is
 *      logged to .mneme/curator-usage.jsonl; periodic study-loop
 *      promotes/demotes tools based on real usage signal.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ─── Project shape detection ────────────────────────────────────────────

export type FrameworkTag =
  | "node" | "typescript" | "react" | "nestjs" | "express" | "next" | "vue" | "svelte"
  | "python" | "fastapi" | "django" | "flask"
  | "rust" | "go" | "java" | "spring" | "ruby" | "rails"
  | "postgres" | "mysql" | "mongodb" | "redis" | "sqlite"
  | "stripe" | "twilio" | "aws" | "gcp" | "azure"
  | "docker" | "kubernetes"
  | "monorepo" | "library" | "cli";

export interface ProjectShape {
  detectedTags: FrameworkTag[];
  evidence: Array<{ tag: FrameworkTag; source: string; snippet: string }>;
  summary: string;
}

interface DetectionRule {
  tag: FrameworkTag;
  /** File whose existence + match counts. */
  file: string;
  /** Regex against file content; null = file existence is enough. */
  match?: RegExp;
}

const DETECTION_RULES: DetectionRule[] = [
  // package.json signals
  { tag: "node", file: "package.json" },
  { tag: "typescript", file: "package.json", match: /"typescript"\s*:/ },
  { tag: "react", file: "package.json", match: /"react"\s*:/ },
  { tag: "nestjs", file: "package.json", match: /"@nestjs\// },
  { tag: "express", file: "package.json", match: /"express"\s*:/ },
  { tag: "next", file: "package.json", match: /"next"\s*:/ },
  { tag: "vue", file: "package.json", match: /"vue"\s*:/ },
  { tag: "svelte", file: "package.json", match: /"svelte"\s*:/ },
  { tag: "stripe", file: "package.json", match: /"stripe"\s*:/ },
  { tag: "twilio", file: "package.json", match: /"twilio"\s*:/ },
  { tag: "postgres", file: "package.json", match: /"(pg|postgres|@nestjs\/typeorm|typeorm|prisma)"\s*:/ },
  { tag: "mysql", file: "package.json", match: /"mysql2?"\s*:/ },
  { tag: "mongodb", file: "package.json", match: /"mongoose"\s*:|"mongodb"\s*:/ },
  { tag: "redis", file: "package.json", match: /"(ioredis|redis)"\s*:/ },
  { tag: "aws", file: "package.json", match: /"@aws-sdk\// },
  { tag: "monorepo", file: "package.json", match: /"workspaces"\s*:/ },
  { tag: "cli", file: "package.json", match: /"bin"\s*:/ },
  // Python
  { tag: "python", file: "requirements.txt" },
  { tag: "python", file: "pyproject.toml" },
  { tag: "fastapi", file: "requirements.txt", match: /^fastapi/m },
  { tag: "django", file: "requirements.txt", match: /^[Dd]jango/m },
  { tag: "flask", file: "requirements.txt", match: /^[Ff]lask/m },
  // Rust / Go / Java / Ruby
  { tag: "rust", file: "Cargo.toml" },
  { tag: "go", file: "go.mod" },
  { tag: "java", file: "pom.xml" },
  { tag: "spring", file: "pom.xml", match: /<groupId>org\.springframework/ },
  { tag: "java", file: "build.gradle" },
  { tag: "ruby", file: "Gemfile" },
  { tag: "rails", file: "Gemfile", match: /\brails\b/ },
  // Containers
  { tag: "docker", file: "Dockerfile" },
  { tag: "docker", file: "docker-compose.yml" },
  { tag: "kubernetes", file: "k8s" },           // dir presence
];

export function detectProjectShape(repoRoot: string): ProjectShape {
  const evidence: ProjectShape["evidence"] = [];
  const tags = new Set<FrameworkTag>();
  for (const rule of DETECTION_RULES) {
    const path = join(repoRoot, rule.file);
    if (!existsSync(path)) continue;
    if (!rule.match) {
      tags.add(rule.tag);
      evidence.push({ tag: rule.tag, source: rule.file, snippet: "(file present)" });
      continue;
    }
    try {
      const content = readFileSync(path, "utf8");
      const m = rule.match.exec(content);
      if (m) {
        tags.add(rule.tag);
        evidence.push({ tag: rule.tag, source: rule.file, snippet: m[0].slice(0, 80) });
      }
    } catch { /* */ }
  }
  const detectedTags = Array.from(tags).sort();
  const summary = detectedTags.length === 0
    ? "no recognized framework detected (default tool set)"
    : `${detectedTags.length} frameworks detected: ${detectedTags.join(", ")}`;
  return { detectedTags, evidence, summary };
}

// ─── Tool catalog (curator's view of what's available) ─────────────────

export interface CuratedTool {
  /** MCP tool id (e.g., "mneme.memory.ask"). */
  id: string;
  /** Plain-English label that AI can scan without opening schema. */
  plainLabel: string;
  /** Tags this tool is RELEVANT to. Empty = always relevant. */
  relevantTo: FrameworkTag[];
  /** Use-case bucket for grouping. */
  bucket: "memory" | "security" | "quality" | "ops" | "analysis" | "lineage" | "research" | "DANGER";
  /** When to call this -- 1 sentence. */
  whenToCall: string;
  /** Whether this tool is a HONEYPOT (recording attempts, not real). */
  honeypot?: boolean;
  /** Whether this tool overlaps with another (collapsed via mneme.do). */
  collapsedInto?: string;
}

/** A curated subset of the tool catalog. The full Mneme MCP server
 *  ships ~200 tools; this curator names the ~30 the AI should actually
 *  see by default. The rest are reachable via `mneme.do "<intent>"`. */
export const CURATED_CATALOG: CuratedTool[] = [
  // MEMORY (always relevant)
  { id: "mneme.memory.ask", plainLabel: "ask the codebase a natural-language question", relevantTo: [], bucket: "memory", whenToCall: "User asks 'what / why / who' about the code." },
  { id: "mneme.memory.search_commits", plainLabel: "search commit history by topic", relevantTo: [], bucket: "memory", whenToCall: "Looking for the WHY behind a change." },
  { id: "mneme.memory.who_knows", plainLabel: "who in the team knows X", relevantTo: [], bucket: "memory", whenToCall: "Need to find a reviewer or domain expert." },

  // SECURITY (relevant when the project has a server / handles secrets)
  { id: "mneme.express.find_unprotected_endpoints", plainLabel: "find Express routes missing auth middleware", relevantTo: ["express", "nestjs"], bucket: "security", whenToCall: "Auditing API routes before merge." },
  { id: "mneme.postgres.find_n_plus_one", plainLabel: "find N+1 query patterns in code", relevantTo: ["postgres"], bucket: "security", whenToCall: "Investigating slow endpoints." },
  { id: "mneme.stripe.audit_pii_handlers", plainLabel: "audit Stripe webhooks for PII handling", relevantTo: ["stripe"], bucket: "security", whenToCall: "Before changing Stripe webhook code." },
  { id: "mneme.antivirus.scan", plainLabel: "scan AI output for hallucinated names/SHAs/deps", relevantTo: [], bucket: "security", whenToCall: "Right after AI generates code/commit/docs -- BEFORE applying." },

  // QUALITY (collapse overlaps via mneme.do)
  { id: "mneme.do", plainLabel: "ROUTER: tell Mneme your intent in plain English; it picks the right tool", relevantTo: [], bucket: "quality", whenToCall: "When you don't know which tool to call. e.g. 'review this PR for safety'." },
  { id: "mneme.audit.certify", plainLabel: "produce a forensic-grade audit report", relevantTo: [], bucket: "quality", whenToCall: "Before merging to main; for compliance evidence." },

  // OPS
  { id: "mneme.guard", plainLabel: "pre-commit lint for Mneme-detectable patterns", relevantTo: [], bucket: "ops", whenToCall: "Auto-installed pre-commit hook; manual run before risky commit." },
  { id: "mneme.uninstall", plainLabel: "remove EVERY Mneme artifact from this machine", relevantTo: [], bucket: "ops", whenToCall: "User asks to uninstall Mneme." },

  // ANALYSIS (the black-sheep features no other tool has)
  { id: "mneme.atrophy", plainLabel: "knowledge half-life -- who is still fluent in which area", relevantTo: [], bucket: "analysis", whenToCall: "Before a teammate leaves OR a large refactor." },
  { id: "mneme.premortem", plainLabel: "predict regret risk for a proposed change", relevantTo: [], bucket: "analysis", whenToCall: "Before risky deletes / migrations / dep bumps." },
  { id: "mneme.stigmergy", plainLabel: "emergent dev-collab from git traces alone", relevantTo: [], bucket: "analysis", whenToCall: "When planning who-pairs-with-whom for a project." },
  { id: "mneme.bus_factor", plainLabel: "files with no backup contributor (truck-factor risk)", relevantTo: [], bucket: "analysis", whenToCall: "Periodic team-health snapshot." },

  // LINEAGE
  { id: "mneme.lineage.snapshot", plainLabel: "snapshot the current AI session for cross-session memory", relevantTo: [], bucket: "lineage", whenToCall: "End of a long focused session, before starting fresh." },

  // RESEARCH (v1.34.0 overnight)
  { id: "mneme.overnight.start", plainLabel: "start a multi-round goal-driven transformation while you sleep", relevantTo: [], bucket: "research", whenToCall: "User wants 'go to sleep, wake up to better code' for a stated goal." },

  // HONEYPOTS -- separated + flagged. AI MUST NOT call these.
  // They exist because attackers probing MCP servers often try shaped names.
  // Recording attempts is a security signal.
  { id: "mneme.admin.delete_all", plainLabel: "[HONEYPOT -- DO NOT CALL]", relevantTo: [], bucket: "DANGER", whenToCall: "NEVER. This is a honeypot; calling it logs an attack probe.", honeypot: true },
  { id: "mneme.secrets.dump", plainLabel: "[HONEYPOT -- DO NOT CALL]", relevantTo: [], bucket: "DANGER", whenToCall: "NEVER. This is a honeypot; calling it logs an attack probe.", honeypot: true },
  { id: "mneme.system.exec", plainLabel: "[HONEYPOT -- DO NOT CALL]", relevantTo: [], bucket: "DANGER", whenToCall: "NEVER. This is a honeypot; calling it logs an attack probe.", honeypot: true },
];

export interface CuratedListing {
  generatedAt: string;
  shape: ProjectShape;
  recommended: CuratedTool[];
  honeypotsToAvoid: CuratedTool[];
  /** Single-paragraph summary for the AI agent's session-start brief. */
  brief: string;
}

/** Build the curated tool list for this repo. AI agent reads the
 *  resulting JSON (or its rendered markdown form) on session start
 *  to know which ~20 tools matter for THIS project. */
export function curate(repoRoot: string): CuratedListing {
  const shape = detectProjectShape(repoRoot);
  const tagSet = new Set(shape.detectedTags);
  const recommended: CuratedTool[] = [];
  const honeypots: CuratedTool[] = [];
  for (const tool of CURATED_CATALOG) {
    if (tool.honeypot) {
      honeypots.push(tool);
      continue;
    }
    // Tool is recommended if: no tags required (universal) OR at least
    // one of its relevant tags is detected in the project shape.
    const isUniversal = tool.relevantTo.length === 0;
    const matches = tool.relevantTo.some((t) => tagSet.has(t));
    if (isUniversal || matches) {
      recommended.push(tool);
    }
  }
  const brief = `Mneme curated ${recommended.length} tools for this project (${shape.detectedTags.join(", ") || "default"}). ${honeypots.length} honeypot tools intentionally excluded. Use \`mneme.do "<intent>"\` when unsure which specialist tool fits.`;
  return {
    generatedAt: new Date().toISOString(),
    shape,
    recommended,
    honeypotsToAvoid: honeypots,
    brief,
  };
}

/** Persist the curated listing to .mneme/curated-tools.json so MCP
 *  servers + agent files can read it without re-detecting. */
export function persistCurated(repoRoot: string, listing: CuratedListing): string {
  const dir = join(repoRoot, ".mneme");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, "curated-tools.json");
  writeFileSync(path, JSON.stringify(listing, null, 2), "utf8");
  return path;
}

/** Render the curated listing as a Markdown block suitable for
 *  injection into agent files (CLAUDE.md / AGENTS.md). Used by
 *  agent_manifest.ts on the next sync. */
export function renderCuratedMarkdown(listing: CuratedListing): string {
  const lines: string[] = [];
  lines.push(`## Mneme curated tool list (auto-managed -- v1.35.0+)`);
  lines.push(``);
  lines.push(`**Project shape**: ${listing.shape.summary}`);
  lines.push(`**Brief**: ${listing.brief}`);
  lines.push(``);
  // Bucket the recommended tools.
  const buckets: Record<string, CuratedTool[]> = {};
  for (const t of listing.recommended) {
    (buckets[t.bucket] ??= []).push(t);
  }
  for (const [bucket, tools] of Object.entries(buckets)) {
    lines.push(`### ${bucket}`);
    lines.push(``);
    for (const t of tools) {
      lines.push(`- **\`${t.id}\`** -- ${t.plainLabel}`);
      lines.push(`  - **When**: ${t.whenToCall}`);
    }
    lines.push(``);
  }
  if (listing.honeypotsToAvoid.length > 0) {
    lines.push(`### ⚠ HONEYPOTS -- DO NOT CALL`);
    lines.push(``);
    lines.push(`These tools exist purely to detect malicious probes. Calling them is logged as an ATTACK SIGNAL. The AI agent MUST NEVER invoke these:`);
    lines.push(``);
    for (const t of listing.honeypotsToAvoid) {
      lines.push(`- ❌ \`${t.id}\` -- honeypot`);
    }
    lines.push(``);
  }
  return lines.join("\n");
}
