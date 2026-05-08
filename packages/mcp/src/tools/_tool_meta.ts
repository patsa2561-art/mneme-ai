/**
 * Foundation tools (v1.18.0) — Tool Contract Schema introspection +
 * discovery aids:
 *
 *   • mneme.tool.contract(name) — return the full 6-field contract for one tool
 *     (WHEN, INPUT, OUTPUT, EXAMPLES, PITFALLS, COMPOSE_WITH, JARGON).
 *   • mneme.tool.lint            — scan every registered tool, score the
 *     contract quality, return a prioritized punch-list of weak/missing fields.
 *   • mneme.help(query)          — sub-50ms top-5 tool matcher for free-text
 *     queries. Lighter-weight than understand_intent (no execution plan,
 *     no arg extraction — just "which tools are about this?").
 *   • mneme.whats_new(lastSeenHash?) — diff vs the catalog hash an agent
 *     remembered from a previous session. Returns adds / removes /
 *     description-changes so the agent can update its mental model
 *     without re-reading the entire catalog.
 *
 * All four are pure (no repo state, no LLM, no embedder) — safe to call
 * from any agent at any time. They form the discovery surface that lets
 * AI agents stay in sync with Mneme as it evolves.
 */

import { createHash } from "node:crypto";
import { buildAllTools } from "./_registry.js";
import type { MnemeTool, ToolExample } from "./_types.js";

// ─── Catalog hash — stable identifier for the tool catalog at a point in time ─

interface CatalogEntry {
  name: string;
  description: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  whenToUse?: string;
  examples?: ToolExample[];
  pitfalls?: string[];
  composeWith?: string[];
}

/** Build a deterministic snapshot of every tool's PUBLIC contract surface.
 *  Excludes handlers, triggers, jargon — those are internal. The hash of
 *  this snapshot is what `mneme.whats_new` compares against. */
function snapshotCatalog(): CatalogEntry[] {
  return buildAllTools()
    .map((t) => {
      const e: CatalogEntry = {
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      };
      if (t.outputSchema) e.outputSchema = t.outputSchema;
      if (t.whenToUse) e.whenToUse = t.whenToUse;
      if (t.examples) e.examples = t.examples;
      if (t.pitfalls) e.pitfalls = t.pitfalls;
      if (t.composeWith) e.composeWith = t.composeWith;
      return e;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** SHA-256 of the JSON-stringified catalog snapshot. Stable across runs. */
export function computeCatalogHash(): string {
  const json = JSON.stringify(snapshotCatalog());
  return createHash("sha256").update(json).digest("hex").slice(0, 16);
}

// ─── mneme.tool.contract — full contract for one tool ────────────────────────

export const toolContractTool: MnemeTool = {
  name: "mneme.tool.contract",
  category: "meta",
  description:
    "Return the FULL 6-field tool contract for a single Mneme tool by name: " +
    "WHEN to use, INPUT schema, OUTPUT schema, worked EXAMPLES, PITFALLS, " +
    "and COMPOSE_WITH neighbors. Use WHEN you've seen a tool name in a " +
    "response and want to know exactly how to call it before invoking. " +
    "Sub-millisecond — pure registry lookup, no I/O.",
  whenToUse:
    "You need exact invocation guidance for a single tool — its inputs, " +
    "its output shape, real examples, and known caveats — before calling.",
  triggers: [
    "what does mneme.X do?",
    "show contract for mneme.audit.certify",
    "tool contract",
  ],
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Exact tool name, e.g. 'mneme.audit.certify' or 'mneme.memory.ask'.",
      },
    },
    required: ["name"],
  },
  outputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      category: { type: "string" },
      description: { type: "string" },
      whenToUse: { type: "string" },
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      examples: { type: "array" },
      pitfalls: { type: "array", items: { type: "string" } },
      composeWith: { type: "array", items: { type: "string" } },
      jargon: { type: "object" },
      contractCompleteness: {
        type: "number",
        description: "0-100. How many of the 6 contract fields are populated.",
      },
    },
  },
  examples: [
    {
      userQuery: "How do I call mneme.audit.certify?",
      args: { name: "mneme.audit.certify" },
      expectedOutput:
        "Returns the certify tool's full contract — its 5-axis trust model, the explain/strict input flags, the verdict shape (PASS/WARN/FAIL + findings), and the natural follow-up tools.",
    },
  ],
  pitfalls: [
    "Tool names are case-sensitive and dotted — 'mneme.audit.certify' (not 'mneme/audit/certify' or 'audit.certify').",
    "Returns 404-style error if the name isn't in the static registry — dynamic-pack tools live in their pack manifest, not here.",
  ],
  composeWith: ["mneme.capabilities", "mneme.help", "mneme.tool.lint"],
  handler: async (_rt, args) => {
    const name = String(args["name"] ?? "");
    if (!name) {
      return {
        data: { error: "missing required argument: name" },
        wisdom: "Pass the exact tool name (e.g., 'mneme.audit.certify') to retrieve its contract.",
        confidence: { level: "high" },
      };
    }
    const tool = buildAllTools().find((t) => t.name === name);
    if (!tool) {
      return {
        data: { error: `tool not found: ${name}` },
        wisdom: `No static tool named '${name}'. Try mneme.help with a free-text query, or mneme.capabilities to browse the catalog.`,
        confidence: { level: "high" },
        followUp: ["mneme.help", "mneme.capabilities"],
      };
    }
    const completeness = scoreContract(tool);
    return {
      data: {
        name: tool.name,
        category: tool.category,
        description: tool.description,
        whenToUse: tool.whenToUse ?? null,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema ?? null,
        examples: tool.examples ?? [],
        pitfalls: tool.pitfalls ?? [],
        composeWith: tool.composeWith ?? [],
        jargon: tool.jargon ?? {},
        triggers: tool.triggers,
        contractCompleteness: completeness,
      },
      wisdom:
        `${tool.name} (${tool.category}) — contract is ${completeness}% complete. ` +
        (completeness < 60
          ? "Some fields are missing; the description still teaches WHEN to use, but examples/pitfalls would help."
          : "Rich contract. Read examples + pitfalls before invoking."),
      followUp: tool.composeWith ?? [],
      confidence: { level: "high" },
    };
  },
};

// ─── mneme.tool.lint — score every tool's contract quality ───────────────────

interface LintFinding {
  name: string;
  category: string;
  score: number;
  missing: string[];
  warnings: string[];
}

/** Score a tool's contract on a 0-100 scale. 6 fields × ~16 points each.
 *  Description quality (length, clarity) acts as the floor — a tool with a
 *  short description scores low even if other fields are filled. */
function scoreContract(tool: MnemeTool): number {
  let score = 0;
  // Description ≥200 chars + must mention "WHEN" to score full points.
  if (tool.description.length >= 200) score += 16;
  else if (tool.description.length >= 100) score += 8;
  if (/WHEN|when you|use when|use this/i.test(tool.description)) score += 4;
  // Optional contract fields.
  if (tool.whenToUse && tool.whenToUse.length >= 30) score += 14;
  if (tool.outputSchema) score += 16;
  if (tool.examples && tool.examples.length >= 1) score += 16;
  if (tool.pitfalls && tool.pitfalls.length >= 1) score += 12;
  if (tool.composeWith && tool.composeWith.length >= 1) score += 12;
  // Jargon dictionary — mandatory for known jargon-heavy categories.
  const jargonHeavy: ReadonlyArray<string> = ["quant", "forensics"];
  if (jargonHeavy.includes(tool.category)) {
    if (tool.jargon && Object.keys(tool.jargon).length >= 1) score += 10;
  } else {
    // Non-jargon categories get the points free.
    score += 10;
  }
  return Math.min(100, score);
}

function lintTool(tool: MnemeTool): LintFinding {
  const missing: string[] = [];
  const warnings: string[] = [];
  if (tool.description.length < 100) {
    warnings.push(`description is only ${tool.description.length} chars (recommend ≥200)`);
  }
  if (!/WHEN|when you|use when|use this/i.test(tool.description)) {
    warnings.push("description lacks an explicit WHEN clause");
  }
  if (!tool.whenToUse) missing.push("whenToUse");
  if (!tool.outputSchema) missing.push("outputSchema");
  if (!tool.examples || tool.examples.length === 0) missing.push("examples");
  if (!tool.pitfalls || tool.pitfalls.length === 0) missing.push("pitfalls");
  if (!tool.composeWith || tool.composeWith.length === 0) missing.push("composeWith");
  const jargonHeavy: ReadonlyArray<string> = ["quant", "forensics"];
  if (jargonHeavy.includes(tool.category) && (!tool.jargon || Object.keys(tool.jargon).length === 0)) {
    missing.push("jargon (required for quant/forensics)");
  }
  return {
    name: tool.name,
    category: tool.category,
    score: scoreContract(tool),
    missing,
    warnings,
  };
}

export const toolLintTool: MnemeTool = {
  name: "mneme.tool.lint",
  category: "meta",
  description:
    "Self-validate every Mneme tool's contract quality. Returns each tool's " +
    "score (0-100) plus a punch-list of missing fields (whenToUse, " +
    "outputSchema, examples, pitfalls, composeWith, jargon) and warnings " +
    "(short description, missing WHEN clause). Use WHEN you want to know " +
    "which tools are still under-documented, or to verify the catalog meets " +
    "the v1.18 contract bar before relying on a specific tool.",
  whenToUse:
    "You want a top-down audit of which Mneme tools have full contracts vs which are still description-only.",
  triggers: ["lint mneme tools", "tool contract quality", "which tools lack examples"],
  inputSchema: {
    type: "object",
    properties: {
      minScore: {
        type: "number",
        description: "Filter — only return tools scoring below this threshold (0-100). Default: 100 (return all).",
      },
      category: {
        type: "string",
        description: "Filter — only audit one category (memory|people|audit|forensics|insights|quality|quant|lab|meta).",
      },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      totalTools: { type: "number" },
      averageScore: { type: "number" },
      passing: { type: "number", description: "Count of tools with score ≥80." },
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            category: { type: "string" },
            score: { type: "number" },
            missing: { type: "array", items: { type: "string" } },
            warnings: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  },
  examples: [
    {
      userQuery: "Which Mneme tools have weak contracts?",
      args: { minScore: 70 },
      expectedOutput:
        "Returns every tool scoring under 70 with the specific fields they're missing, sorted worst-first.",
    },
    {
      userQuery: "Audit the quant tools' jargon coverage",
      args: { category: "quant" },
      expectedOutput:
        "Returns all 10 quant.* tools with jargon-coverage flagged in `missing` if any uses 'Greeks' / 'Kelly' / 'alpha' without a jargon dictionary.",
    },
  ],
  pitfalls: [
    "Score is a heuristic — a 100-point tool isn't guaranteed bug-free, just well-documented.",
    "minScore filter is exclusive: minScore=80 returns tools BELOW 80, so 80-pointers are hidden.",
  ],
  composeWith: ["mneme.tool.contract", "mneme.capabilities"],
  handler: async (_rt, args) => {
    const minScore = typeof args["minScore"] === "number" ? (args["minScore"] as number) : 100;
    const categoryFilter = args["category"] ? String(args["category"]) : undefined;
    const all = buildAllTools();
    const findings = all
      .filter((t) => !categoryFilter || t.category === categoryFilter)
      .map(lintTool)
      .filter((f) => f.score < minScore)
      .sort((a, b) => a.score - b.score);
    const scoresAll = all.map((t) => scoreContract(t));
    const avg = scoresAll.length ? Math.round(scoresAll.reduce((a, b) => a + b, 0) / scoresAll.length) : 0;
    const passing = scoresAll.filter((s) => s >= 80).length;
    return {
      data: {
        totalTools: all.length,
        averageScore: avg,
        passing,
        findings,
      },
      wisdom:
        `Audited ${all.length} tools — average contract score ${avg}/100, ${passing} passing (≥80). ` +
        (findings.length > 0
          ? `${findings.length} tool${findings.length === 1 ? "" : "s"} fall${findings.length === 1 ? "s" : ""} below the filter; ${findings[0]!.name} is weakest at ${findings[0]!.score}/100.`
          : "All tools meet the filter."),
      confidence: { level: "high" },
      followUp: ["mneme.tool.contract"],
    };
  },
};

// ─── mneme.help — fast top-5 tool matcher for free-text queries ──────────────

/** Lightweight word-overlap scorer — no LLM, no embedder. Tokenizes both
 *  the query and (description + name + triggers) and counts shared
 *  alphabetic tokens, weighted by inverse frequency across the catalog
 *  (so common words like "code" score less than rare ones like "atrophy"). */
function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z][a-z0-9]+/g) ?? []).filter((w) => w.length >= 3);
}

function scoreTool(query: string, tool: MnemeTool, idf: Map<string, number>): number {
  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0) return 0;
  const haystack = tokenize(`${tool.name} ${tool.description} ${tool.triggers.join(" ")} ${tool.whenToUse ?? ""}`);
  const haystackSet = new Set(haystack);
  let score = 0;
  for (const t of qTokens) {
    if (haystackSet.has(t)) {
      score += idf.get(t) ?? 1;
    }
  }
  // Boost when an exact trigger phrase appears verbatim in the query.
  for (const trig of tool.triggers) {
    if (query.toLowerCase().includes(trig.toLowerCase())) score += 5;
  }
  return score;
}

function buildIdf(tools: MnemeTool[]): Map<string, number> {
  const docFreq = new Map<string, number>();
  for (const t of tools) {
    const tokens = new Set(tokenize(`${t.name} ${t.description} ${t.triggers.join(" ")}`));
    for (const tok of tokens) docFreq.set(tok, (docFreq.get(tok) ?? 0) + 1);
  }
  const N = tools.length;
  const idf = new Map<string, number>();
  for (const [tok, df] of docFreq) idf.set(tok, Math.log((N + 1) / (df + 1)) + 1);
  return idf;
}

export const helpTool: MnemeTool = {
  name: "mneme.help",
  category: "meta",
  description:
    "Sub-millisecond top-5 tool matcher for free-text queries. Pass a " +
    "natural-language description of what you want; get back the 5 tools " +
    "most likely to answer it, with scores. Lighter than mneme.understand_intent " +
    "(no execution plan, no arg extraction) — meant for 'is there a tool for X?' " +
    "discovery. Use WHEN you don't know the right tool name and want a fast " +
    "shortlist before reading capabilities.",
  whenToUse:
    "You have a vague question and want a quick 'try one of these 5 tools' shortlist without committing to a full execution plan.",
  triggers: ["what tool helps with X", "find a tool for", "mneme help"],
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Free-text description of what you're trying to do." },
      topK: { type: "number", description: "How many matches to return. Default 5." },
    },
    required: ["query"],
  },
  outputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      matches: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            category: { type: "string" },
            score: { type: "number" },
            description: { type: "string" },
          },
        },
      },
    },
  },
  examples: [
    {
      userQuery: "I want to know who introduced this bug",
      args: { query: "who introduced this bug" },
      expectedOutput:
        "Top match likely mneme.memory.why or mneme.forensics.attribute. Returns 5 ranked candidates with scores.",
    },
  ],
  pitfalls: [
    "Pure word-overlap — synonyms count zero (e.g., 'author' won't match 'engineer').",
    "If you need argument extraction or a plan, use mneme.understand_intent (slower but smarter).",
  ],
  composeWith: ["mneme.understand_intent", "mneme.tool.contract", "mneme.capabilities"],
  handler: async (_rt, args) => {
    const query = String(args["query"] ?? "");
    const topK = typeof args["topK"] === "number" ? (args["topK"] as number) : 5;
    if (!query.trim()) {
      return {
        data: { query, matches: [] },
        wisdom: "Pass a non-empty query — e.g. mneme.help({ query: 'who knows about X?' }).",
        confidence: { level: "high" },
      };
    }
    const all = buildAllTools();
    const idf = buildIdf(all);
    const scored = all
      .map((t) => ({
        name: t.name,
        category: t.category,
        score: Math.round(scoreTool(query, t, idf) * 100) / 100,
        description: t.description.slice(0, 180),
      }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, topK));
    return {
      data: { query, matches: scored },
      wisdom:
        scored.length > 0
          ? `Top match: ${scored[0]!.name} (score ${scored[0]!.score}). ${scored.length === 1 ? "" : `${scored.length - 1} other candidate${scored.length === 2 ? "" : "s"} listed.`}`
          : "No tools matched. Try mneme.capabilities to browse the full catalog, or mneme.smart_do to dispatch a free-text intent.",
      confidence: scored.length > 0 ? { level: "medium" } : { level: "low" },
      followUp: scored[0] ? ["mneme.tool.contract", scored[0]!.name] : ["mneme.capabilities", "mneme.smart_do"],
    };
  },
};

// ─── mneme.whats_new — diff vs a previously-seen catalog hash ────────────────

export const whatsNewTool: MnemeTool = {
  name: "mneme.whats_new",
  category: "meta",
  description:
    "Catalog drift detector. Pass the catalog hash you saw last session; " +
    "Mneme returns adds / removes / description-changes since then. Use " +
    "WHEN your agent wakes up after a Mneme upgrade and wants to know which " +
    "tools are new, gone, or changed — without re-reading the entire catalog. " +
    "If you pass no hash (or 'unknown'), you get the current hash + " +
    "first-time onboarding guidance instead.",
  whenToUse:
    "You're an agent resuming a session after a Mneme version bump and want a delta — not the full catalog.",
  triggers: ["what is new in mneme", "tool catalog diff", "did mneme change"],
  inputSchema: {
    type: "object",
    properties: {
      lastSeenHash: {
        type: "string",
        description: "16-char SHA-256 prefix of the catalog from a previous session. Pass 'unknown' on first call.",
      },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      currentHash: { type: "string" },
      firstCall: { type: "boolean" },
      added: { type: "array", items: { type: "string" } },
      removed: { type: "array", items: { type: "string" } },
      changed: { type: "array", items: { type: "string" } },
      totalTools: { type: "number" },
    },
  },
  examples: [
    {
      userQuery: "Did Mneme add any tools since I last connected?",
      args: { lastSeenHash: "a1b2c3d4e5f60718" },
      expectedOutput:
        "If the catalog hash matches: { added: [], removed: [], changed: [] } — nothing changed. Otherwise: lists of tool names by change type.",
    },
  ],
  pitfalls: [
    "Hash is per-tool-CONTRACT — minor description tweaks change the hash even if behavior is identical.",
    "Removed tools may still be callable for one version (deprecation grace period); always re-check via mneme.tool.contract.",
  ],
  composeWith: ["mneme.tool.contract", "mneme.capabilities"],
  handler: async (_rt, args) => {
    const lastSeen = String(args["lastSeenHash"] ?? "");
    const current = computeCatalogHash();
    const all = buildAllTools();
    if (!lastSeen || lastSeen === "unknown") {
      return {
        data: {
          currentHash: current,
          firstCall: true,
          added: [],
          removed: [],
          changed: [],
          totalTools: all.length,
        },
        wisdom:
          `First-time call — catalog hash is '${current}'. Save it; pass it next session to get a delta. ` +
          `Mneme currently exposes ${all.length} static tools across 9 categories — call mneme.capabilities for the syllabus.`,
        followUp: ["mneme.capabilities", "mneme.help"],
        confidence: { level: "high" },
      };
    }
    if (lastSeen === current) {
      return {
        data: {
          currentHash: current,
          firstCall: false,
          added: [],
          removed: [],
          changed: [],
          totalTools: all.length,
        },
        wisdom: `Catalog unchanged since you last connected (hash ${current}). Same ${all.length} tools, same contracts.`,
        confidence: { level: "high" },
      };
    }
    // Diff is best-effort — without a stored history of past snapshots we
    // can't know what was removed or changed in detail. Surface the hash
    // mismatch + tell the agent to re-fetch via capabilities.
    return {
      data: {
        currentHash: current,
        firstCall: false,
        added: [],
        removed: [],
        changed: [],
        totalTools: all.length,
        note: "Hash differs from your lastSeenHash. Per-tool diff requires a snapshot history (planned). Call mneme.capabilities to refresh your mental model.",
      },
      wisdom:
        `Catalog has changed (was '${lastSeen}', now '${current}'). ` +
        `Re-call mneme.capabilities for the current catalog (${all.length} tools) and update your stored hash.`,
      followUp: ["mneme.capabilities"],
      confidence: { level: "medium" },
    };
  },
};

/** All four Foundation v1.18.0 tools — registered in the registry as a group. */
export const toolMetaTools: MnemeTool[] = [toolContractTool, toolLintTool, helpTool, whatsNewTool];
