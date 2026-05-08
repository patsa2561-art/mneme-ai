/**
 * Tool registry — collects all category modules into one ordered list +
 * a fast lookup map. Each category file exports a `tools: MnemeTool[]`
 * array; the registry concatenates them and surfaces them to the MCP
 * server as one flat catalog (with namespaced names like
 * `mneme.people.atrophy` for AI client navigation).
 */

import type { MnemeTool, ToolCategory } from "./_types.js";

import { memoryTools } from "./memory.js";
import { peopleTools } from "./people.js";
import { auditTools } from "./audit.js";
import { forensicsTools } from "./forensics.js";
import { insightsTools } from "./insights.js";
import { qualityTools } from "./quality.js";
import { quantTools } from "./quant.js";
import { labTools } from "./lab.js";
import { metaTools } from "./meta.js";
import { capabilitiesTool } from "./_capabilities.js";
import { smartDoTool } from "./_smart_do.js";

/** All Mneme tools, in display order. The capabilities syllabus comes first
 *  so AI clients that read tool lists top-down see it immediately. */
export function buildAllTools(): MnemeTool[] {
  return [
    capabilitiesTool,
    smartDoTool,
    ...memoryTools,
    ...peopleTools,
    ...auditTools,
    ...forensicsTools,
    ...insightsTools,
    ...qualityTools,
    ...quantTools,
    ...labTools,
    ...metaTools,
  ];
}

/** Build a fast lookup table keyed by tool name */
export function buildToolMap(): Map<string, MnemeTool> {
  const out = new Map<string, MnemeTool>();
  for (const t of buildAllTools()) {
    if (out.has(t.name)) {
      throw new Error(`MCP tool name collision: ${t.name}`);
    }
    out.set(t.name, t);
  }
  return out;
}

/** Group tools by category — used by the capabilities syllabus tool */
export function groupByCategory(): Map<ToolCategory, MnemeTool[]> {
  const out = new Map<ToolCategory, MnemeTool[]>();
  for (const t of buildAllTools()) {
    if (!out.has(t.category)) out.set(t.category, []);
    out.get(t.category)!.push(t);
  }
  return out;
}
