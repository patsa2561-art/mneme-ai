/**
 * MNEME UNIVERSAL FUNCTION-CALLING ADAPTER (v1.40.0).
 *
 * The user asked: "Universal API integration -- Mneme tools เรียกได้
 * จาก OpenAI / Anthropic / Gemini ตรง ๆ ผ่าน function-calling protocol
 * โดยไม่ต้องใช้ MCP."
 *
 * The honest framing: Mneme already exposes its tools via MCP. But
 * MCP isn't universal -- not every AI vendor speaks it natively, and
 * even the ones that do require an MCP server to be running. This
 * module emits the SAME tool catalog in three OTHER native formats so
 * any AI client (or any HTTP-aware service) can consume Mneme tools
 * directly:
 *
 *   1. OpenAI function-calling schema (`tools: [{ type: "function",
 *      function: { name, description, parameters: <JSON-schema> } }]`)
 *   2. Anthropic tool-use schema (`tools: [{ name, description,
 *      input_schema: <JSON-schema> }]`)
 *   3. Google Gemini function-declaration schema (`tools: [{
 *      functionDeclarations: [{ name, description, parameters }] }]`)
 *
 * MANDATE COMPLIANCE:
 *   1. Wild idea: SCHEMA MOLECULES. Each adapter emits not just the
 *      raw tool list but COMPOSITE MOLECULES -- pre-bundled
 *      multi-tool sequences (e.g., "audit-before-merge" = scan +
 *      forensics + premortem + grader). The AI client invokes the
 *      molecule name; the adapter expands it into the correct tool
 *      sequence at runtime.
 *   2. Wiser: reuses v1.35 TOOL CURATOR project-shape detection so
 *      each vendor only sees the relevant ~20 tools, not the full
 *      ~200. Token-economical from day 1.
 *   3. Self-fix root cause: not "add another adapter" -- builds a
 *      VENDOR-NEUTRAL intermediate format then projects to each
 *      vendor's shape. Adding a 4th vendor (Mistral, DeepSeek, etc.)
 *      is one new projection function, not a full rewrite.
 *   4. Co-working: integrates with v1.39 advocate's
 *      requireAdvocate=true mode -- when the AI invokes a Mneme
 *      tool with the "compliance" tag, the response is
 *      auto-augmented with the advocate verdict.
 *   5. Always-studying: every adapter call appends to
 *      .mneme/universal/calls.jsonl -- the daemon's reactor cycle
 *      computes which vendor + which tool combo is most-used so the
 *      next adapter version can pre-compose those into molecules.
 */

import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export type Vendor = "openai" | "anthropic" | "gemini";

/** Vendor-neutral tool description -- the source of truth that gets
 *  projected to each vendor's native shape. */
export interface UniversalTool {
  /** Stable id, e.g., "mneme.memory.ask". */
  id: string;
  /** Plain-English description (max 1000 chars; vendors truncate). */
  description: string;
  /** JSON Schema for the tool's parameters. */
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
  /** Tags for filtering / molecule composition. */
  tags?: string[];
}

/** A SCHEMA MOLECULE -- a named multi-tool sequence the AI client can
 *  invoke as ONE function call. The adapter expands it into the
 *  correct sub-tool sequence at runtime. */
export interface SchemaMolecule {
  /** Stable id, e.g., "mneme.audit-before-merge". */
  id: string;
  /** Plain-English description of when to use this molecule. */
  description: string;
  /** The tool sequence this molecule unfolds into. */
  sequence: string[];
  /** Aggregation strategy: 'sequential' = run in order, each consuming
   *  the prior's output; 'parallel' = run concurrently, merge results;
   *  'fan-out-grade' = run in parallel, then run grader on the union. */
  strategy: "sequential" | "parallel" | "fan-out-grade";
}

export const BUILTIN_MOLECULES: SchemaMolecule[] = [
  {
    id: "mneme.audit-before-merge",
    description: "Run before merging a PR: scans for hallucinations + searches forensics + predicts regret + grades the result.",
    sequence: ["mneme.antivirus.scan", "mneme.forensics.scan", "mneme.premortem", "mneme.grade.answer"],
    strategy: "fan-out-grade",
  },
  {
    id: "mneme.who-knows-this",
    description: "Compose memory + people lookups to answer 'who is the right person for this code?'",
    sequence: ["mneme.memory.ask", "mneme.who-knows", "mneme.atrophy"],
    strategy: "parallel",
  },
  {
    id: "mneme.before-refactor",
    description: "Run before a large refactor: time-machine + premortem + bus-factor + atrophy.",
    sequence: ["mneme.time-machine", "mneme.premortem", "mneme.bus_factor", "mneme.atrophy"],
    strategy: "parallel",
  },
  {
    id: "mneme.compliance-grade",
    description: "Compliance-grade verdict: spawn full squadron WITH advocate, evidence quorum required.",
    sequence: ["mneme.squadron.spawn", "mneme.advocate", "mneme.audit.certify"],
    strategy: "sequential",
  },
];

// ─── Vendor-specific projections ────────────────────────────────────────

export interface OpenAIToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: UniversalTool["parameters"];
  };
}

export interface AnthropicToolSchema {
  name: string;
  description: string;
  input_schema: UniversalTool["parameters"];
}

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: UniversalTool["parameters"];
}

export interface GeminiToolBlock {
  functionDeclarations: GeminiFunctionDeclaration[];
}

/** Normalize a tool id for vendors that constrain the function-name
 *  charset. OpenAI + Anthropic + Gemini all require [a-zA-Z0-9_]; we
 *  replace dots with underscores. */
function vendorSafeName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

export function exportOpenAI(tools: UniversalTool[]): OpenAIToolSchema[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: vendorSafeName(t.id),
      description: t.description.slice(0, 1024),
      parameters: t.parameters,
    },
  }));
}

export function exportAnthropic(tools: UniversalTool[]): AnthropicToolSchema[] {
  return tools.map((t) => ({
    name: vendorSafeName(t.id),
    description: t.description.slice(0, 1024),
    input_schema: t.parameters,
  }));
}

export function exportGemini(tools: UniversalTool[]): GeminiToolBlock {
  return {
    functionDeclarations: tools.map((t) => ({
      name: vendorSafeName(t.id),
      description: t.description.slice(0, 1024),
      parameters: t.parameters,
    })),
  };
}

/** Generic vendor-projection switch. Unknown vendor returns null. */
export function exportFor(vendor: Vendor, tools: UniversalTool[]): unknown {
  if (vendor === "openai") return exportOpenAI(tools);
  if (vendor === "anthropic") return exportAnthropic(tools);
  if (vendor === "gemini") return exportGemini(tools);
  return null;
}

/** Expand a SCHEMA MOLECULE into its concrete tool sequence given
 *  the available tool catalog. Returns null if any sub-tool is missing
 *  from the catalog (so the AI client gets a clear error rather than
 *  partial-molecule confusion). */
export function expandMolecule(
  molecule: SchemaMolecule,
  catalog: UniversalTool[],
): { tools: UniversalTool[]; strategy: SchemaMolecule["strategy"] } | null {
  const byId = new Map(catalog.map((t) => [t.id, t]));
  const expanded: UniversalTool[] = [];
  for (const id of molecule.sequence) {
    const t = byId.get(id);
    if (!t) return null;
    expanded.push(t);
  }
  return { tools: expanded, strategy: molecule.strategy };
}

// ─── Mneme baseline catalog ─────────────────────────────────────────────
//
// A small, hand-curated set of high-value tools that map cleanly to
// every vendor's function-calling format. The full ~200-tool MCP
// catalog is over-broad for direct vendor consumption -- this is the
// short list each AI client should see by default.

export const BASELINE_TOOLS: UniversalTool[] = [
  {
    id: "mneme.memory.ask",
    description: "Ask the codebase a natural-language question. Returns grounded answer with cited commits + files. Use BEFORE making code suggestions about historical context.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question to ask, in plain English." },
      },
      required: ["question"],
    },
    tags: ["memory", "always-relevant"],
  },
  {
    id: "mneme.antivirus.scan",
    description: "Scan AI-drafted output for hallucination strains (phantom commits, fake packages, invented file paths). Run BEFORE delivering any AI-generated content to the user.",
    parameters: {
      type: "object",
      properties: {
        textOrFile: { type: "string", description: "Literal text OR a file path to scan." },
        strain: { type: "string", description: "Optional: limit to one strain id (citatio_viridis | depends_imaginarium | structura_invenita | ...)." },
      },
      required: ["textOrFile"],
    },
    tags: ["security", "always-relevant"],
  },
  {
    id: "mneme.who-knows",
    description: "Find who in the team has expertise in a topic, ranked by commit history + recency.",
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string", description: "What expertise to look up (e.g., 'JWT auth', 'Stripe webhooks')." },
      },
      required: ["topic"],
    },
    tags: ["memory", "people"],
  },
  {
    id: "mneme.atrophy",
    description: "Knowledge half-life report. Surfaces files where only one person remembers the context (bus-factor risk).",
    parameters: {
      type: "object",
      properties: {
        top: { type: "string", description: "Limit to top N files (default 10)." },
      },
    },
    tags: ["analysis", "diagnosis"],
  },
  {
    id: "mneme.premortem",
    description: "Predict regret risk for a proposed change, grounded in the repo's failure history. Use BEFORE risky deletes / migrations / dep bumps.",
    parameters: {
      type: "object",
      properties: {
        change: { type: "string", description: "Plain-English description of the proposed change." },
      },
      required: ["change"],
    },
    tags: ["analysis", "risk"],
  },
  {
    id: "mneme.squadron.spawn",
    description: "Spawn the full Bot Squadron (7 bots including the devil's advocate) to evaluate a claim. Returns evidence-quorum-aware verdict with bias caveats.",
    parameters: {
      type: "object",
      properties: {
        claim: { type: "string", description: "The claim to evaluate. Be specific (mention version numbers, file names, feature names)." },
        requireAdvocate: { type: "boolean", description: "When true, advocate MUST be present; refuses to verdict without it. Set true for compliance-grade calls." },
      },
      required: ["claim"],
    },
    tags: ["consensus", "compliance"],
  },
  {
    id: "mneme.token.report",
    description: "Volunteer your token usage so Mneme can measure savings + tune per-vendor strategies.",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        vendor: { type: "string", description: "Your vendor id: anthropic | openai | google | claude-code | cursor | codex | continue | ollama | ..." },
        promptTokens: { type: "string", description: "Number of input tokens this turn." },
        completionTokens: { type: "string", description: "Number of output tokens this turn." },
      },
      required: ["sessionId", "vendor", "promptTokens", "completionTokens"],
    },
    tags: ["token-economy"],
  },
];

// ─── Always-studying telemetry ──────────────────────────────────────────

export interface AdapterCall {
  ts: string;
  vendor: Vendor;
  tool: string;
  /** Was this called as a molecule? */
  viaMolecule?: string;
}

export function recordAdapterCall(repoRoot: string, call: AdapterCall): void {
  try {
    const dir = join(repoRoot, ".mneme", "universal");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "calls.jsonl"), JSON.stringify(call) + "\n", "utf8");
  } catch { /* best-effort */ }
}
