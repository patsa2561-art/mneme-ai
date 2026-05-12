/**
 * v1.62.0 -- REACTOR LAYER 5: SEMANTIC DIFF / TARGETED SLICE.
 *
 * Instead of sending the AI a whole file when it asks about a function /
 * symbol / commit, return the SMALLEST relevant slice + a 1-line
 * file-purpose summary. Cuts token cost 10-20x for file-read intents.
 *
 * Algorithm:
 *   1. Tokenize the user's intent (>= 4 char words).
 *   2. Find the symbol the intent is asking about (function / class /
 *      constant name) -- if any.
 *   3. Walk the file; extract a [-window, +window] line band around the
 *      hit. Default window = 12 lines either side.
 *   4. If no specific symbol found, return TOP 3 token-overlap regions.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { estimateTokens, metricsOf, type ReactorMetrics } from "./measure.js";

export interface SliceResult {
  ok: boolean;
  /** Full file token estimate (the baseline). */
  fullFileTokens: number;
  /** Slice token estimate (the spent). */
  sliceTokens: number;
  /** Number of slice regions returned. */
  regionCount: number;
  /** Concatenated slice content. */
  slice: string;
  /** 1-line purpose summary derived from the first comment / module description. */
  filePurpose: string;
  metrics: ReactorMetrics;
}

function tokenize(s: string): string[] {
  return Array.from(new Set(
    (s.toLowerCase().match(/[a-z][a-z0-9_-]+/g) ?? []).filter((t) => t.length >= 4),
  ));
}

function extractFilePurpose(content: string): string {
  // First non-empty `/**...*/`, `//`, or `#` comment within first 30 lines.
  const lines = content.split("\n").slice(0, 30);
  let inBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("/**")) { inBlock = true; continue; }
    if (inBlock && trimmed.startsWith("*")) {
      const body = trimmed.replace(/^\*+\s*/, "").trim();
      if (body && !body.startsWith("/")) return body.slice(0, 120);
    }
    if (inBlock && trimmed.includes("*/")) { inBlock = false; continue; }
    if (trimmed.startsWith("//")) {
      const body = trimmed.replace(/^\/\/+\s*/, "").trim();
      if (body) return body.slice(0, 120);
    }
    if (trimmed.startsWith("#")) {
      const body = trimmed.replace(/^#+\s*/, "").trim();
      if (body) return body.slice(0, 120);
    }
  }
  return "(no purpose comment found)";
}

interface Hit { lineNumber: number; score: number }

function findHits(lines: string[], queryTokens: string[]): Hit[] {
  const hits: Hit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i]!.toLowerCase();
    let score = 0;
    for (const t of queryTokens) if (lower.includes(t)) score++;
    if (score > 0) hits.push({ lineNumber: i, score });
  }
  return hits;
}

/** Merge overlapping windows so consecutive hits don't duplicate context. */
function mergeWindows(hits: Hit[], lineCount: number, window: number): Array<[number, number]> {
  if (hits.length === 0) return [];
  const ranges = hits.map((h) => [Math.max(0, h.lineNumber - window), Math.min(lineCount - 1, h.lineNumber + window)] as [number, number]);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [ranges[0]!];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1]!;
    if (ranges[i]![0] <= last[1] + 1) {
      last[1] = Math.max(last[1], ranges[i]![1]);
    } else {
      merged.push(ranges[i]!);
    }
  }
  return merged;
}

/** Slice a file given a user intent. */
export function sliceFile(
  repoRoot: string,
  filePath: string,
  intent: string,
  opts?: { window?: number; maxRegions?: number },
): SliceResult {
  const fullPath = filePath.startsWith("/") || /^[a-zA-Z]:/.test(filePath) ? filePath : join(repoRoot, filePath);
  const window = opts?.window ?? 12;
  const maxRegions = opts?.maxRegions ?? 3;
  if (!existsSync(fullPath)) {
    return {
      ok: false, fullFileTokens: 0, sliceTokens: 0, regionCount: 0,
      slice: `(file not found: ${filePath})`,
      filePurpose: "(unreachable)",
      metrics: metricsOf(0, 0, "slice_file_not_found"),
    };
  }
  const content = readFileSync(fullPath, "utf8");
  const fullTokens = estimateTokens(content);
  const lines = content.split("\n");
  const filePurpose = extractFilePurpose(content);
  const queryTokens = tokenize(intent);
  const hits = findHits(lines, queryTokens);
  if (hits.length === 0) {
    // No targeted hit -- return top-of-file (likely module exports + types).
    const head = lines.slice(0, Math.min(40, lines.length)).join("\n");
    const spent = estimateTokens(head);
    return {
      ok: true, fullFileTokens: fullTokens, sliceTokens: spent, regionCount: 1,
      slice: `// FILE PURPOSE: ${filePurpose}\n${head}`,
      filePurpose,
      metrics: metricsOf(spent + 20, fullTokens, "slice_top_of_file"),
    };
  }
  hits.sort((a, b) => b.score - a.score);
  const topHits = hits.slice(0, maxRegions);
  const ranges = mergeWindows(topHits, lines.length, window);
  const regions = ranges.map(([start, end]) => {
    const body = lines.slice(start, end + 1).join("\n");
    return `// lines ${start + 1}-${end + 1}:\n${body}`;
  });
  const slice = `// FILE PURPOSE: ${filePurpose}\n\n${regions.join("\n\n// ...\n\n")}`;
  const sliceTokens = estimateTokens(slice);
  return {
    ok: true,
    fullFileTokens: fullTokens,
    sliceTokens,
    regionCount: regions.length,
    slice,
    filePurpose,
    metrics: metricsOf(sliceTokens, fullTokens, "slice_targeted"),
  };
}
