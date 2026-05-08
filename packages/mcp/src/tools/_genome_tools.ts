/**
 * mneme.genome.* — MCP tools that expose the Genetic Engineering primitives
 * (G1-G5) so AI agents discover them automatically via `tools/list`.
 *
 * Six tools:
 *   • mneme.genome.annotate       — tag a tool list with functional domains
 *   • mneme.genome.phylogeny      — build ancestry tree + cousins/distance queries
 *   • mneme.genome.circuit        — run a genetic-circuit network (toggle/AND/OR/NOT/oscillator)
 *   • mneme.genome.operon_resolve — resolve which operon governs a tool + its current behavior modifier
 *   • mneme.genome.crispr_edit    — apply a CRISPR edit to a pack (validate-then-commit)
 *   • mneme.genome.synthesize     — de novo synthesis: recipe → cryptographically-named ToolDefinition
 */

import { genome } from "@mneme-ai/core";
import type { MnemeTool } from "./_types.js";

// ─── 1. annotate ─────────────────────────────────────────────────────

export const genomeAnnotateTool: MnemeTool = {
  name: "mneme.genome.annotate",
  category: "meta",
  description:
    "Tag a list of MCP tools with their functional domain (search · mutate · verify · compose · regulate · augment · observe · synthesize) + sub-domains + mutability + genus/species. Pure deterministic. Used by the phylogeny tool to build ancestry trees.",
  triggers: ["annotate tools", "classify mcp tools", "what domain is this tool"],
  inputSchema: {
    type: "object",
    properties: {
      tools: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            parent: { type: "string" },
          },
          required: ["name"],
        },
      },
    },
    required: ["tools"],
  },
  handler: async (_rt, args) => {
    const tools = (args["tools"] as genome.ToolDescriptor[]) ?? [];
    const result = genome.annotateCatalog(tools);
    return {
      data: result,
      wisdom:
        `Annotated ${result.tools.length} tool(s). Domain breakdown: ${
          Object.entries(result.domainCounts)
            .map(([d, n]) => `${d}=${n}`)
            .join(", ")
        }.`,
      followUp: ["mneme.genome.phylogeny"],
      confidence: { level: "high" },
    };
  },
};

// ─── 2. phylogeny ────────────────────────────────────────────────────

export const genomePhylogenyTool: MnemeTool = {
  name: "mneme.genome.phylogeny",
  category: "meta",
  description:
    "Build the phylogenetic (ancestry) tree of a tool catalog. Supports queries: ancestors of a tool, cousins (siblings within k generations), tree-distance between two tools, closest-relative search across a candidate pool. Use when AI agent needs to reason about WHICH tool to call by relatedness, not just name match.",
  triggers: ["tool ancestors", "find similar tool", "closest relative", "speciation"],
  inputSchema: {
    type: "object",
    properties: {
      tools: { type: "array" },
      query: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["ancestors", "cousins", "distance", "closest", "speciation", "ascii"] },
          tool: { type: "string" },
          other: { type: "string" },
          k: { type: "number" },
          candidates: { type: "array", items: { type: "string" } },
        },
        required: ["kind"],
      },
    },
    required: ["tools", "query"],
  },
  handler: async (_rt, args) => {
    const tools = (args["tools"] as genome.ToolDescriptor[]) ?? [];
    const annotated = genome.annotateCatalog(tools).tools;
    const tree = genome.buildPhylogeny(annotated);
    const q = args["query"] as { kind: string; tool?: string; other?: string; k?: number; candidates?: string[] };

    let result: unknown;
    switch (q.kind) {
      case "ancestors":
        result = q.tool ? genome.findAncestors(tree, q.tool) : [];
        break;
      case "cousins":
        result = q.tool ? genome.findCousins(tree, q.tool, q.k ?? 1) : [];
        break;
      case "distance":
        result = q.tool && q.other ? genome.treeDistance(tree, q.tool, q.other) : Infinity;
        break;
      case "closest":
        result = q.tool && q.candidates ? genome.findClosestRelative(tree, q.tool, q.candidates) : null;
        break;
      case "speciation":
        result = genome.speciationEvents(tree);
        break;
      case "ascii":
        result = genome.renderAsciiTree(tree);
        break;
      default:
        result = null;
    }
    return {
      data: { query: q, result, totalNodes: tree.byName.size },
      wisdom: `Phylogeny query '${q.kind}' executed across ${tree.byName.size} nodes.`,
      followUp: [],
      confidence: { level: "high" },
    };
  },
};

// ─── 3. circuit ──────────────────────────────────────────────────────

export const genomeCircuitTool: MnemeTool = {
  name: "mneme.genome.circuit",
  category: "meta",
  description:
    "Execute a genetic-circuit network: toggle / AND / OR / NOT / oscillator gates composed declaratively. Returns whether the circuit fired + reason. Toggle state is caller-managed (pure function).",
  triggers: ["genetic circuit", "logic gate", "toggle", "and gate", "or gate"],
  inputSchema: {
    type: "object",
    properties: {
      network: {
        type: "object",
        properties: { steps: { type: "array" } },
        required: ["steps"],
      },
      input: {
        type: "object",
        properties: {
          signals: { type: "object", additionalProperties: { type: "boolean" } },
          payload: {},
          toggleState: { type: "object", additionalProperties: { type: "boolean" } },
          oscillatorTick: { type: "number" },
        },
        required: ["signals"],
      },
    },
    required: ["network", "input"],
  },
  handler: async (_rt, args) => {
    const result = genome.runCircuit(
      args["network"] as genome.CircuitNetwork,
      args["input"] as genome.CircuitInput,
    );
    return {
      data: result,
      wisdom: `Circuit ${result.fired ? "fired ✓" : "blocked ✗"} — ${result.reason}`,
      followUp: [],
      confidence: { level: "high" },
    };
  },
};

// ─── 4. operon_resolve ───────────────────────────────────────────────

export const genomeOperonResolveTool: MnemeTool = {
  name: "mneme.genome.operon_resolve",
  category: "meta",
  description:
    "Resolve which co-regulated operon governs a tool + its current behavior modifier (requireConstitutionGate / requireStrictSniper / minConfidence / maxResults). Use to determine: should this tool's output be gated more strictly given the current PCI / compliance / governance level?",
  triggers: ["operon", "regulator", "governance level"],
  inputSchema: {
    type: "object",
    properties: {
      toolName: { type: "string" },
      registry: { type: "object" },
      regulatorLevels: { type: "object", additionalProperties: { type: "string" } },
    },
    required: ["toolName", "registry", "regulatorLevels"],
  },
  handler: async (_rt, args) => {
    const r = genome.resolveOperonForTool(
      args["toolName"] as string,
      args["registry"] as genome.OperonRegistry,
      args["regulatorLevels"] as Record<string, genome.RegulatorLevel>,
    );
    return {
      data: r,
      wisdom: r.operon
        ? `Tool '${args["toolName"]}' governed by operon '${r.operon.id}' at level=${r.level}. Modifier: requireGate=${r.modifier?.requireConstitutionGate}, requireSniper=${r.modifier?.requireStrictSniper}, minConf=${r.modifier?.minConfidence}.`
        : `Tool '${args["toolName"]}' is unregulated.`,
      followUp: [],
      confidence: { level: "high" },
    };
  },
};

// ─── 5. crispr_edit ──────────────────────────────────────────────────

export const genomeCrisprTool: MnemeTool = {
  name: "mneme.genome.crispr_edit",
  category: "meta",
  description:
    "Apply a CRISPR edit to a pack: delete tool by id/pattern, replace-tool, add-tool, patch-detection. Validates the post-edit pack against the schema; on validation failure, returns ok=false with structured errors and NO change is committed (fail-closed). Returns SHA-256 hashes of pack before + after.",
  triggers: ["edit pack", "patch tool", "crispr", "tool surgery"],
  inputSchema: {
    type: "object",
    properties: {
      pack: { type: "object" },
      edit: { type: "object" },
    },
    required: ["pack", "edit"],
  },
  handler: async (_rt, args) => {
    const r = genome.crisprEdit(
      args["pack"] as Parameters<typeof genome.crisprEdit>[0],
      args["edit"] as genome.CrisprEdit,
    );
    return {
      data: r,
      wisdom: r.ok
        ? `CRISPR edit applied: ${r.summary}. Hash ${r.beforeHash.slice(0, 8)} → ${r.afterHash?.slice(0, 8)}.`
        : `CRISPR edit refused (fail-closed): ${r.error?.reason}.`,
      followUp: [],
      confidence: { level: "high" },
    };
  },
};

// ─── 6. synthesize ───────────────────────────────────────────────────

export const genomeSynthesizeTool: MnemeTool = {
  name: "mneme.genome.synthesize",
  category: "meta",
  description:
    "DE NOVO SYNTHESIS — compose a brand new MCP tool at runtime from genetic primitives. Recipe (search patterns + verifiers + augmenters + preconditions + authoredBy) → cryptographically-named ToolDefinition. Identical recipe → identical tool name + DNA hash (deterministic). Validated against pack schema before return. Failure modes are structured.",
  triggers: ["synthesize tool", "create new tool", "de novo", "new gene"],
  inputSchema: {
    type: "object",
    properties: {
      intent: { type: "string", description: "Plain-English description of what the tool should do (≥10 chars)" },
      searchPatterns: { type: "array", items: { type: "string" }, minItems: 1 },
      fileExtensions: { type: "array", items: { type: "string" } },
      verifiers: { type: "array", items: { type: "string", enum: ["ast", "semantic", "confidence"] }, minItems: 1 },
      augmenters: { type: "array", items: { type: "string", enum: ["canonical-paths", "deprecated-paths", "expert-authors", "incidents", "rules"] } },
      authoredBy: { type: "string" },
    },
    required: ["intent", "searchPatterns", "verifiers", "authoredBy"],
  },
  handler: async (_rt, args) => {
    const recipe: genome.SynthesisRecipe = {
      intent: String(args["intent"] ?? ""),
      searchPatterns: (args["searchPatterns"] as string[]) ?? [],
      fileExtensions: args["fileExtensions"] as string[] | undefined,
      verifiers: (args["verifiers"] as Array<"ast" | "semantic" | "confidence">) ?? [],
      augmenters: (args["augmenters"] as Array<"canonical-paths" | "deprecated-paths" | "expert-authors" | "incidents" | "rules">) ?? [],
      authoredBy: String(args["authoredBy"] ?? ""),
    };
    const r = genome.synthesize(recipe);
    return {
      data: r,
      wisdom: r.ok
        ? `Synthesized new tool '${r.tool!.name}' (DNA hash ${r.tool!.dnaHash.slice(0, 12)}…). Tool is verified against pack schema and ready to register.`
        : `Synthesis refused: ${r.error?.reason}.`,
      followUp: r.ok ? ["mneme.dna.search"] : [],
      confidence: { level: "high" },
    };
  },
};

export const genomeTools: MnemeTool[] = [
  genomeAnnotateTool,
  genomePhylogenyTool,
  genomeCircuitTool,
  genomeOperonResolveTool,
  genomeCrisprTool,
  genomeSynthesizeTool,
];
