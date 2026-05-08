/**
 * Tool builder — compile (detection + packs + augmentation) into MCP Tool
 * objects ready for the MCP server's `tools/list` response.
 *
 * Pure functions — no I/O, no side effects. Compose at startup.
 */

import type { Pack, ToolDefinition } from "./pack-schema.js";
import type { EcosystemDetection } from "./ecosystem.js";

/** Shape of an MCP Tool entry (subset we actually emit). */
export interface BuiltMcpTool {
  /** Fully-qualified tool name: `mneme.<pack-id>.<tool-id>`. */
  name: string;
  /** Augmented description (base + tribal knowledge). */
  description: string;
  /** JSON Schema for inputs (verbatim from pack). */
  inputSchema: Record<string, unknown>;
  /** Pack id this tool came from — for dispatch. */
  packId: string;
  /** Tool id within the pack — for dispatch. */
  toolId: string;
  /** Detection confidence (0..1) — surfaces in tool metadata. */
  confidence: number;
}

export interface ToolBuildContext {
  /** Detection result for the current repo. */
  detection: EcosystemDetection;
  /** All loaded packs from registry. */
  packs: Pack[];
  /** Optional per-tool description augmenter. Caller passes a function
   *  that wraps `augmentDescription` with pre-fetched data. If absent,
   *  the base description is used as-is. */
  augmentDescription?: (
    base: string,
    tool: ToolDefinition,
    pack: Pack,
  ) => string;
}

/**
 * Compile the active tool catalog for an MCP server.
 *
 * Resolution rules:
 *   1. For each pack, only emit tools if detection.signals contains pack.id
 *      AND signal confidence >= pack.detection.minConfidence
 *   2. If multiple packs claim the same tool name, the highest-confidence
 *      detection wins (stable, deterministic)
 *   3. Tool name = "mneme.<pack-id>.<tool-id>" — fixed format, no override
 *
 * NEVER throws.
 */
export function buildActiveToolCatalog(ctx: ToolBuildContext): BuiltMcpTool[] {
  const packsById = new Map<string, Pack>();
  for (const p of ctx.packs) packsById.set(p.id, p);

  // Build a map: pack-id → confidence (only for detected ecosystems
  // whose confidence meets the pack's minConfidence threshold).
  const activePackConfidence = new Map<string, number>();
  for (const sig of ctx.detection.signals) {
    const pack = packsById.get(sig.id);
    if (!pack) continue;
    if (sig.confidence < pack.detection.minConfidence) continue;
    activePackConfidence.set(sig.id, sig.confidence);
  }

  const out: BuiltMcpTool[] = [];
  // Deterministic order: pack id alphabetical, tool id alphabetical
  const sortedPackIds = Array.from(activePackConfidence.keys()).sort();
  for (const packId of sortedPackIds) {
    const pack = packsById.get(packId)!;
    const conf = activePackConfidence.get(packId)!;
    const sortedTools = [...pack.tools].sort((a, b) => a.id.localeCompare(b.id));
    for (const tool of sortedTools) {
      const baseDescription = tool.description;
      const description = ctx.augmentDescription
        ? ctx.augmentDescription(baseDescription, tool, pack)
        : baseDescription;
      out.push({
        name: `mneme.${packId}.${tool.id}`,
        description,
        inputSchema: tool.inputSchema as Record<string, unknown>,
        packId,
        toolId: tool.id,
        confidence: conf,
      });
    }
  }

  return out;
}

/**
 * Look up a tool by its fully-qualified name within a pack list.
 *
 * Returns the matching pack + tool definition, or null if not found.
 * Used by the MCP `tools/call` dispatcher.
 */
export function lookupTool(
  toolName: string,
  packs: Pack[],
): { pack: Pack; tool: ToolDefinition } | null {
  const match = /^mneme\.([a-z][a-z0-9-]*)\.([a-z][a-z0-9_]*)$/.exec(toolName);
  if (!match) return null;
  const [, packId, toolId] = match;
  const pack = packs.find((p) => p.id === packId);
  if (!pack) return null;
  const tool = pack.tools.find((t) => t.id === toolId);
  if (!tool) return null;
  return { pack, tool };
}
