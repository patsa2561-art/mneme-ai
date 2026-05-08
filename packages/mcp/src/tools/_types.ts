/**
 * MCP tool type system — the contract every Mneme tool implements.
 *
 * Design principle: every response carries WISDOM, not just data. AI clients
 * shouldn't need to interpret raw JSON — Mneme pre-digests each finding into
 * a 1-3 sentence narrative the AI can quote (or paraphrase) directly to the
 * user. Citations live in `data`, the human meaning lives in `wisdom`.
 */

import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { git, store, EmbeddingProvider } from "@mneme-ai/core";

/** Categories for the syllabus tool — AI student reads this index first
 *  and learns what kind of question goes to which group of tools. */
export type ToolCategory =
  | "memory"     // Q&A, search, citations — "why does X exist?"
  | "people"     // contributors, atrophy, telepathy, influence
  | "audit"      // AI session audit — trust certificate for AI commits
  | "forensics"  // security, vuln-hunt, attribution, anomaly
  | "insights"   // ghost, regret, premortem, oracle, time-machine
  | "quality"    // karma, repo-mri, heartbeat, twin, palimpsest
  | "quant"      // drawdown, alpha, moneyball, greeks (Wall-Street-inspired)
  | "lab"        // periodic-table, library, compose, run, calibrate
  | "meta";      // wisdom, manifesto, capabilities, advanced

/** Wrapped response — every tool returns this shape so AI gets data + wisdom
 *  + cross-references in one consistent envelope. */
export interface ToolResponse<TData = unknown> {
  /** Structured data the AI parses + uses */
  data: TData;
  /** 1-3 sentences in plain English explaining what the data means.
   *  AI quotes or paraphrases this when answering the user. */
  wisdom: string;
  /** Tool names the AI might call next for deeper context.
   *  Example: after `mneme.people.atrophy` → suggest `mneme.people.passport` */
  followUp?: string[];
  /** Confidence + caveats — when to trust this, when to flag heuristic limits */
  confidence?: {
    level: "high" | "medium" | "low";
    notes?: string;
  };
}

/** Runtime context passed to every handler — single source of truth.
 *  Built once per MCP server lifetime, reused across all calls. */
export interface ToolRuntime {
  cwd: string;
  meta: Awaited<ReturnType<typeof git.getRepoMeta>>;
  store: store.MnemeStore;
  embedder: EmbeddingProvider;
}

/** A Mneme tool definition — one per CLI command we expose via MCP.
 *
 *  description: write it like a good lesson title — *include WHEN to use + examples*.
 *  AI tool selection is mostly description-matching; vague descriptions = wrong picks.
 *
 *  triggers: example user phrases that should fire this tool. The AI doesn't
 *  see triggers directly, but we use them in the syllabus + as anchor for
 *  description quality reviews. */
export interface MnemeTool<TArgs = Record<string, unknown>, TData = unknown> {
  /** MCP tool name — must match `^mneme\.[a-z_]+\.[a-z_]+$` for grouping */
  name: string;
  /** Category for the capabilities syllabus */
  category: ToolCategory;
  /** Rich description: 2-4 sentences. Include WHEN to use + 2-3 example user
   *  phrases this should match. The AI picks tools by matching user intent
   *  to descriptions, so be specific. */
  description: string;
  /** Example user queries that should trigger this tool. Used for
   *  syllabus generation + description-quality review. */
  triggers: string[];
  /** JSON Schema for input parameters */
  inputSchema: Tool["inputSchema"];
  /** Async handler — receives runtime + parsed args */
  handler: (runtime: ToolRuntime, args: TArgs) => Promise<ToolResponse<TData>>;
}

/** Convert a wrapped tool response into MCP's expected CallToolResult.
 *  We serialise the entire envelope (data + wisdom + followUp + confidence)
 *  so the AI sees the full picture in one shot. */
export function toCallResult(r: ToolResponse): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            data: r.data,
            wisdom: r.wisdom,
            followUp: r.followUp ?? [],
            confidence: r.confidence ?? { level: "medium" },
          },
          null,
          2,
        ),
      },
    ],
  };
}

/** Convert a thrown error into MCP's expected error result */
export function toErrorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}
