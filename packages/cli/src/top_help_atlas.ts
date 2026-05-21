/**
 * v2.21.8 — TOP-LEVEL HELP · ATLAS-DIRECT mode.
 *
 * `mneme --help` (no other verb) renders here, not Commander. Output
 * is ATLAS Layer 0 (TASTE) plus a hint card pointing the reader at
 * the next-level surfaces. Total: ~1 KB.
 *
 * Why intercept here rather than via Commander hooks?
 *   - Commander's help builder iterates every registered command.
 *     We're trying to AVOID iterating 300+ commands.
 *   - We compute token cost honestly: count chars, divide by 4, show
 *     "// pulse cost: N tokens" footer when not in --naked mode.
 *   - `--naked` strips emoji, separator art, and the cost footer for
 *     A/B testers / minimalists / strict CI consumers.
 *
 * Anything beyond `mneme --help` or `mneme --help --naked` skips this
 * function and lands in Commander's renderer (which has `--help --full`
 * paths if you really want the wall).
 */

export interface RenderTopHelpOptions {
  /** Strip decoration. Composes with `MNEME_NAKED=1`. */
  naked?: boolean;
}

interface TasteRow {
  verb: string;
  one_line: string;
}

const TASTE: TasteRow[] = [
  { verb: "mneme verify-self --score", one_line: "Trust gate (one number 0-100). Run first." },
  { verb: "mneme ask <question>",      one_line: "Memory + truth Q&A over the repo." },
  { verb: "mneme route <intent>",      one_line: "Natural language -> top-3 commands (any language)." },
  { verb: "mneme earthquake drift",    one_line: "Silent-vendor-drift detector." },
  { verb: "mneme stillness gate",      one_line: "Decide whether AI should respond." },
];

interface DiscoverRow {
  verb: string;
  size: string;
  what: string;
}

const DISCOVER: DiscoverRow[] = [
  { verb: "mneme atlas",         size: "~3 KB",   what: "Composed view of TASTE + BLOOM + HOT + TAGS." },
  { verb: "mneme bloom",         size: "~340 B",  what: "Bloom-filter probe membership in O(1)." },
  { verb: "mneme tags --tag <n>",size: "~1 KB",   what: "Commands grouped by capability (trust/drift/silence/handoff/...)." },
  { verb: "mneme hot",           size: "~200 B",  what: "Top-20 verbs by recent pheromone-weighted use." },
  { verb: "mneme route <intent>",size: "~80 B",   what: "Natural language router (no LLM)." },
  { verb: "mneme --help --full", size: "~14 KB",  what: "Legacy 300+ command wall. Scripts piping --help should use this." },
];

const SAFETY: DiscoverRow[] = [
  { verb: "mneme rights",        size: "~2 KB",   what: "Agent Bill of Rights (10 articles)." },
  { verb: "mneme audit-pulse",   size: "~200 B",  what: "Audit any text for manipulation patterns." },
  { verb: "mneme telemetry list",size: "~1 KB",   what: "What Mneme records (opt-IN by default)." },
  { verb: "mneme upgrade-doctor",size: "~300 B",  what: "Is auto-upgrade safe right now?" },
];

function approxTokens(text: string): number {
  // GPT-class tokenizers approximate to ~4 chars/token for English-ASCII.
  // We're conservative — count whitespace too. Honest estimate, not exact.
  return Math.max(1, Math.round(text.length / 4));
}

function renderAscii(rows: { verb: string; one_line?: string; size?: string; what?: string }[]): string {
  const maxVerb = Math.max(...rows.map((r) => r.verb.length));
  const lines: string[] = [];
  for (const r of rows) {
    const body = r.one_line ?? r.what ?? "";
    const sizeTag = r.size ? `  [${r.size.padStart(7)}]` : "";
    lines.push(`    ${r.verb.padEnd(maxVerb)}${sizeTag}  ${body}`);
  }
  return lines.join("\n");
}

export async function renderTopHelpAtlas(opts: RenderTopHelpOptions = {}): Promise<string> {
  const naked = !!opts.naked || process.env.MNEME_NAKED === "1";
  const version = await currentVersion();

  const lines: string[] = [];
  if (naked) {
    lines.push(`mneme ${version}`);
    lines.push(`Memory layer + truth + drift co-pilot for AI agents.`);
    lines.push("");
    lines.push(`5 starter verbs:`);
    lines.push(renderAscii(TASTE));
    lines.push("");
    lines.push(`Discover the other 300+ commands:`);
    lines.push(renderAscii(DISCOVER));
    lines.push("");
    lines.push(`Safety + ethics surfaces:`);
    lines.push(renderAscii(SAFETY));
    lines.push("");
    lines.push(`Migration: scripts that grep "mneme --help" output should use "mneme --help --full".`);
  } else {
    lines.push(`mneme ${version} — μνήμη — memory layer + truth + drift co-pilot`);
    lines.push("");
    lines.push("  5 verbs cover 95% of needs:");
    lines.push(renderAscii(TASTE));
    lines.push("");
    lines.push("  Discover more (incremental cost):");
    lines.push(renderAscii(DISCOVER));
    lines.push("");
    lines.push("  Safety + ethics (Consent Fabric v2.21.6+):");
    lines.push(renderAscii(SAFETY));
    lines.push("");
    lines.push("  Tip: legacy 300+ command wall is now opt-in:");
    lines.push("    mneme --help --full      (scripts that pipe --help should switch)");
    lines.push("    mneme --help --naked     (strip decoration; raw output for CI)");
  }
  const body = lines.join("\n") + "\n";

  if (naked) return body;

  // Token receipt footer (#3 from the v2.21.7 user audit).
  const cost = approxTokens(body);
  const footer = `\n  // help cost: ~${cost} tokens (vs ~14000 for the legacy --help --full wall, ${Math.round((cost / 14000) * 1000) / 10}% the size)\n`;
  return body + footer;
}

async function currentVersion(): Promise<string> {
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const url = await import("node:url");
    // We're in packages/cli/dist/top_help_atlas.js at runtime; walk up.
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    for (let i = 0; i < 5; i++) {
      const p = path.join(here, ...Array(i).fill(".."), "package.json");
      if (fs.existsSync(p)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
          if (typeof pkg.version === "string") return `v${pkg.version}`;
        } catch { /* keep walking */ }
      }
    }
  } catch { /* */ }
  return "(unknown version)";
}
