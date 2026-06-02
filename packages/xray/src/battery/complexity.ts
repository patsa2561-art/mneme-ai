/**
 * Complexity signal — wraps the real `outline.extractOutline` (deterministic
 * AST-structural scan). Reports symbol counts, the longest functions (refactor
 * hotspots), and max nesting depth. Symbol NAMES + signatures are structural
 * metadata, not source bodies — bodies are never read into the report.
 */
import { outline } from "@mneme-ai/core";
import type { ComplexityBlock } from "../types.js";
import { listTextFiles, readText } from "../util.js";

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|c|h|cpp|cc)$/i;

export function analyzeComplexity(repoPath: string, maxFiles: number): ComplexityBlock {
  const { files } = listTextFiles(repoPath, maxFiles);
  const hotspots: ComplexityBlock["hotspots"] = [];
  let totalSymbols = 0;
  let analysed = 0;
  let maxDepth = 0;

  for (const f of files) {
    if (!CODE_EXT.test(f.rel)) continue;
    const src = readText(f.abs);
    if (!src) continue;
    let o: ReturnType<typeof outline.extractOutline>;
    try {
      o = outline.extractOutline(src, { path: f.rel });
    } catch {
      continue;
    }
    analysed++;
    totalSymbols += o.symbolCount;
    for (const sym of o.symbols) {
      if (sym.depth > maxDepth) maxDepth = sym.depth;
      if (sym.kind === "function" || sym.kind === "method") {
        hotspots.push({ file: f.rel, symbol: sym.name, bodyLines: sym.bodyLines, startLine: sym.startLine });
      }
    }
  }

  hotspots.sort((a, b) => b.bodyLines - a.bodyLines);

  return {
    filesAnalysed: analysed,
    totalSymbols,
    hotspots: hotspots.slice(0, 15),
    maxDepth,
    note:
      hotspots.length === 0
        ? "No code symbols extracted."
        : `Largest function: ${hotspots[0].symbol} (${hotspots[0].bodyLines} lines). Long functions are the refactor hotspots.`,
  };
}
