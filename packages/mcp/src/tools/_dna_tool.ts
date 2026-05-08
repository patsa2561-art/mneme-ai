/**
 * mneme.dna.search — MCP tool for AI clients.
 *
 * Exposes the full 16-strand DNA pipeline (8 algorithms × 8 formulas) as
 * a single MCP tool that AI agents can call directly. Strict mode is the
 * default — Ghost-Sniper Verifier rejects rather than degrades, so the
 * AI never sees a hallucinated reference.
 *
 * The tool accepts the orchestrator's structured input shape verbatim.
 * Powerful AI agents that have already done embedding + candidate
 * collection (e.g. via mneme.memory.search_commits) can pipe results
 * through this for the strict-verified, tribal-knowledge-augmented
 * answer.
 */

import { dna } from "@mneme-ai/core";
import type { MnemeTool } from "./_types.js";

export const dnaSearchTool: MnemeTool = {
  name: "mneme.dna.search",
  category: "meta",
  description:
    "Run the full Mneme DNA pipeline (8 algorithms × 8 formulas) on a set of pre-fetched candidates. " +
    "Returns ONLY results that pass three gates: (1) AST existence, (2) semantic similarity ≥ threshold, " +
    "(3) Compositional Confidence (Wilson 95% lower bound × Hebbian) ≥ threshold. Strict mode default = " +
    "rejects rather than degrades. **Use this when you need a hallucination-free answer to ground a code " +
    "claim.** Returns: accepted[] (verified results), phantomSuggestions[] (where the canonical version " +
    "should live), trace[] (full pipeline transparency), stats (per-gate rejection counts).",
  triggers: [
    "verify these candidates",
    "filter out hallucinations",
    "ghost sniper search",
    "DNA pipeline",
    "strict-mode code search",
  ],
  inputSchema: {
    type: "object",
    properties: {
      queryText: { type: "string", description: "Original query text (for trace)" },
      queryEmbedding: {
        type: "array",
        items: { type: "number" },
        description: "Embedding of the query (precomputed by caller)",
      },
      candidates: {
        type: "array",
        description: "Pre-fetched candidate hits with embeddings + metadata",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            embedding: { type: "array", items: { type: "number" } },
            baseRelevance: { type: "number" },
            patternSignature: { type: "string" },
            existsInRepo: { type: "boolean" },
            successCount: { type: "number" },
            totalCount: { type: "number" },
            hebbianStrength: { type: "number" },
            meta: { type: "object", additionalProperties: true },
          },
          required: ["id", "embedding", "baseRelevance", "patternSignature", "existsInRepo", "successCount", "totalCount", "hebbianStrength"],
        },
      },
      echoSignals: {
        type: "array",
        description: "Known regret/decision pattern embeddings (for echo signature)",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            embedding: { type: "array", items: { type: "number" } },
            label: { type: "string" },
          },
          required: ["id", "embedding"],
        },
      },
      canonicalPatterns: {
        type: "array",
        description: "Successful patterns from this repo's history (for phantom-path)",
        items: { type: "object", additionalProperties: true },
      },
      regretEmbeddings: {
        type: "array",
        description: "Embeddings of regret patterns (for anti-pattern repulsion)",
        items: { type: "array", items: { type: "number" } },
      },
      federationVotes: {
        type: "object",
        description: "Per-signature federation up/down votes",
        additionalProperties: true,
      },
      strict: { type: "boolean", description: "Default true. Strict = reject rather than degrade." },
      semanticThreshold: { type: "number", description: "Min semantic sim. Default 0.6." },
      confidenceThreshold: { type: "number", description: "Min Wilson×Hebbian. Default 0.6." },
    },
    required: ["queryText", "queryEmbedding", "candidates", "echoSignals", "canonicalPatterns", "regretEmbeddings"],
  },
  handler: async (_rt, args) => {
    try {
      const result = dna.dnaSearch({
        queryText: String(args["queryText"] ?? ""),
        queryEmbedding: (args["queryEmbedding"] as number[]) ?? [],
        candidates: (args["candidates"] as dna.DnaSearchInput["candidates"]) ?? [],
        echoSignals: (args["echoSignals"] as dna.EchoSignal[]) ?? [],
        canonicalPatterns: (args["canonicalPatterns"] as dna.CanonicalPattern[]) ?? [],
        regretEmbeddings: (args["regretEmbeddings"] as number[][]) ?? [],
        federationVotes: (args["federationVotes"] as dna.FederationVotes) ?? {},
        strict: args["strict"] !== false,
        semanticThreshold: typeof args["semanticThreshold"] === "number" ? (args["semanticThreshold"] as number) : undefined,
        confidenceThreshold: typeof args["confidenceThreshold"] === "number" ? (args["confidenceThreshold"] as number) : undefined,
      });

      const summary =
        result.accepted.length === 0
          ? `Strict mode: 0 results passed all 3 gates (${result.stats.rejectedAtAst} rejected at AST existence, ${result.stats.rejectedAtSemantic} at semantic, ${result.stats.rejectedAtConfidence} at confidence). Empty answer is honest — no hallucinations leaked.`
          : `${result.accepted.length} result(s) verified. ${result.stats.rejectedAtAst + result.stats.rejectedAtSemantic + result.stats.rejectedAtConfidence} rejected at the Ghost-Sniper gates (no hallucinations leaked).`;

      return {
        data: result,
        wisdom: summary,
        followUp:
          result.accepted.length === 0
            ? ["mneme.memory.search_commits", "mneme.constitution.get"]
            : [],
        confidence: { level: result.accepted.length > 0 ? "high" : "medium" },
        secondBrain: {
          presentation:
            result.accepted.length > 0
              ? "Quote data.accepted[].reference verbatim to the user. Each result has been verified — file/symbol exists, semantic similarity passes threshold, Wilson 95% lower-bound confidence is met. Ground every claim in these references."
              : "DO NOT fabricate a result. The DNA pipeline rejected every candidate. Either tell the user 'I couldn't verify this' or call mneme.memory.search_commits with broader terms and re-run.",
        },
      };
    } catch (err) {
      return {
        data: null,
        wisdom: `DNA pipeline failed: ${(err as Error).message}. Inspect input shape — ensure embeddings have consistent dimension and required fields are present.`,
        followUp: [],
        confidence: { level: "low" },
      };
    }
  },
};
