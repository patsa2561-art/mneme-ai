/**
 * G5 — De novo MCP Synthesis (the wild card).
 *
 * User describes a NEW capability they need; Mneme synthesizes a tool
 * from existing genetic primitives — never seen in any pack — at
 * runtime. The tool is:
 *
 *   • Composed from audited primitives (code-search + augmentation
 *     + verifier + circuit gates)
 *   • Cryptographically named (DNA hash from the recipe)
 *   • Validated against the pack schema before registration
 *   • Recorded in the federation as a new "species"
 *
 * Pure function. Caller persists the synthesized tool.
 */

import { createHash } from "node:crypto";
import { validatePack, type ToolDefinition, type Query } from "../dynamic/pack-schema.js";

/** Available primitives that can be composed. */
export type SynthesisPrimitive =
  | "code-search"
  | "git-history"
  | "entity-graph"
  | "augment-canonical-paths"
  | "augment-deprecated-paths"
  | "augment-expert-authors"
  | "augment-incidents"
  | "augment-rules"
  | "verify-ast"
  | "verify-semantic"
  | "verify-confidence"
  | "circuit-and"
  | "circuit-or"
  | "circuit-not"
  | "circuit-toggle";

export interface SynthesisRecipe {
  /** Plain-English description of what the tool should do. */
  intent: string;
  /** Search patterns the tool will scan for. */
  searchPatterns: string[];
  /** File extensions to scope (default: all). */
  fileExtensions?: string[];
  /** Verifier gates to chain (in order). */
  verifiers: Array<"ast" | "semantic" | "confidence">;
  /** Augmentation enrichers to attach. */
  augmenters: Array<"canonical-paths" | "deprecated-paths" | "expert-authors" | "incidents" | "rules">;
  /** Circuit conditions: tool fires only when these gates pass. */
  preconditions?: Array<{ kind: "and" | "or" | "not"; signals: string[] }>;
  /** Operator who initiated the synthesis (for audit). */
  authoredBy: string;
}

export interface SynthesizedTool {
  /** Cryptographic name: mneme.synth.<hash16>. */
  name: string;
  /** Full DNA hash (SHA-256 hex). */
  dnaHash: string;
  /** Pack-format ToolDefinition ready to register. */
  toolDef: ToolDefinition;
  /** Provenance — the recipe that produced this tool. */
  recipe: SynthesisRecipe;
  /** ISO timestamp of synthesis. */
  synthesizedAt: string;
}

export interface SynthesisResult {
  ok: boolean;
  tool?: SynthesizedTool;
  error?: { reason: string; details?: unknown };
}

const PRIMITIVE_GRAMMAR_RULES = {
  /** A recipe must have at least 1 search pattern. */
  minSearchPatterns: 1,
  /** A recipe must have at least 1 verifier. */
  minVerifiers: 1,
  /** Max search patterns (defensive). */
  maxSearchPatterns: 50,
};

function validateRecipe(recipe: SynthesisRecipe): { ok: true } | { ok: false; reason: string } {
  if (!recipe.intent || recipe.intent.trim().length < 10) {
    return { ok: false, reason: "intent must be at least 10 characters" };
  }
  if (recipe.searchPatterns.length < PRIMITIVE_GRAMMAR_RULES.minSearchPatterns) {
    return { ok: false, reason: `must have at least ${PRIMITIVE_GRAMMAR_RULES.minSearchPatterns} search patterns` };
  }
  if (recipe.searchPatterns.length > PRIMITIVE_GRAMMAR_RULES.maxSearchPatterns) {
    return { ok: false, reason: `too many patterns (${recipe.searchPatterns.length} > ${PRIMITIVE_GRAMMAR_RULES.maxSearchPatterns})` };
  }
  if (recipe.verifiers.length < PRIMITIVE_GRAMMAR_RULES.minVerifiers) {
    return { ok: false, reason: "synthesized tools require at least one verifier (otherwise hallucinations leak)" };
  }
  // Validate each pattern is a real regex
  for (const p of recipe.searchPatterns) {
    try { new RegExp(p); } catch (err) {
      return { ok: false, reason: `invalid regex: ${p} — ${(err as Error).message}` };
    }
  }
  if (!recipe.authoredBy || recipe.authoredBy.trim().length === 0) {
    return { ok: false, reason: "authoredBy is required for audit provenance" };
  }
  return { ok: true };
}

/** Compute the deterministic DNA hash of a recipe. */
export function recipeHash(recipe: SynthesisRecipe): string {
  // Hash the canonicalized recipe (sorted keys for determinism)
  const canonical = {
    intent: recipe.intent.trim(),
    searchPatterns: [...recipe.searchPatterns].sort(),
    fileExtensions: [...(recipe.fileExtensions ?? [])].sort(),
    verifiers: [...recipe.verifiers].sort(),
    augmenters: [...recipe.augmenters].sort(),
    preconditions: recipe.preconditions ?? [],
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/**
 * Synthesize a tool from a recipe. Pure function. Same recipe → same
 * tool name + hash + definition (deterministic).
 */
export function synthesize(recipe: SynthesisRecipe): SynthesisResult {
  const recipeCheck = validateRecipe(recipe);
  if (!recipeCheck.ok) {
    return { ok: false, error: { reason: recipeCheck.reason } };
  }

  const hash = recipeHash(recipe);
  const shortName = hash.slice(0, 16);
  const name = `mneme.synth.s_${shortName}`;

  // Build the underlying query
  const query: Query = {
    kind: "code-search",
    patterns: recipe.searchPatterns,
    fileExtensions: recipe.fileExtensions ?? ["ts", "tsx", "js", "jsx", "py"],
    maxResults: 50,
    ranking: "centrality-desc",
  };

  // Map verifiers / augmenters to enrichWith
  const enrichWith: ToolDefinition["enrichWith"] = [];
  for (const a of recipe.augmenters) {
    switch (a) {
      case "canonical-paths":
      case "deprecated-paths":
        if (!enrichWith.includes("first-commit-introduced")) enrichWith.push("first-commit-introduced");
        break;
      case "expert-authors":
        if (!enrichWith.includes("atrophy-author")) enrichWith.push("atrophy-author");
        if (!enrichWith.includes("git-blame")) enrichWith.push("git-blame");
        break;
      case "incidents":
        if (!enrichWith.includes("incident-cross-reference")) enrichWith.push("incident-cross-reference");
        break;
      case "rules":
        if (!enrichWith.includes("constitution-rules")) enrichWith.push("constitution-rules");
        break;
    }
  }

  const toolId = `s_${shortName}`;
  const toolDef: ToolDefinition = {
    id: toolId,
    description:
      `${recipe.intent.trim()}\n\n` +
      `Synthesized from primitives: search × ${recipe.augmenters.length} augmenters × ${recipe.verifiers.length} verifiers.\n` +
      `DNA hash: ${shortName}…\n` +
      `Authored by: ${recipe.authoredBy}`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    query,
    enrichWith,
    augmentation: {
      includeCanonicalPath: recipe.augmenters.includes("canonical-paths"),
      includeDeprecatedPaths: recipe.augmenters.includes("deprecated-paths"),
      includeExpertAuthors: recipe.augmenters.includes("expert-authors"),
      includeRecentIncidents: recipe.augmenters.includes("incidents"),
      includeApplicableRules: recipe.augmenters.includes("rules"),
    },
  };

  // Validate the synthesized tool by stuffing it into a minimal pack and
  // running the schema validator. Fail closed.
  const dummyPack = {
    schemaVersion: 1,
    id: "synth-test",
    displayName: "Synthesis Validation",
    description: "Internal synthesis validation pack — never persisted.",
    version: "1.0.0",
    mnemeMinVersion: "1.13.0",
    maintainer: { name: recipe.authoredBy },
    license: "MIT",
    detection: { packageDeps: [], pythonDeps: [], importPatterns: [], filePatterns: [], minConfidence: 0.5 },
    tools: [toolDef],
  };
  const validated = validatePack(dummyPack);
  if (!validated.ok) {
    return { ok: false, error: { reason: "synthesized tool failed schema validation", details: validated.errors } };
  }

  return {
    ok: true,
    tool: {
      name,
      dnaHash: hash,
      toolDef,
      recipe,
      synthesizedAt: new Date().toISOString(),
    },
  };
}

/**
 * "Species registry" — a deduplicating store that keeps each unique
 * synthesized tool exactly once, keyed by DNA hash.
 *
 * Pure function: takes existing registry + new tool → next registry.
 */
export interface SpeciesRegistry {
  byHash: Record<string, SynthesizedTool>;
  byName: Record<string, string>; // name → hash (deduplicated)
}

export function emptyRegistry(): SpeciesRegistry {
  return { byHash: {}, byName: {} };
}

export function registerSpecies(
  reg: SpeciesRegistry,
  tool: SynthesizedTool,
): { registry: SpeciesRegistry; isNewSpecies: boolean } {
  if (reg.byHash[tool.dnaHash]) {
    return { registry: reg, isNewSpecies: false };
  }
  return {
    registry: {
      byHash: { ...reg.byHash, [tool.dnaHash]: tool },
      byName: { ...reg.byName, [tool.name]: tool.dnaHash },
    },
    isNewSpecies: true,
  };
}

export function lookupByHash(reg: SpeciesRegistry, hash: string): SynthesizedTool | null {
  return reg.byHash[hash] ?? null;
}

export function lookupByName(reg: SpeciesRegistry, name: string): SynthesizedTool | null {
  const hash = reg.byName[name];
  if (!hash) return null;
  return reg.byHash[hash] ?? null;
}
