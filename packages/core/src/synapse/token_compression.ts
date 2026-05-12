/**
 * v1.81.0 -- SYNAPSE: TOKEN COMPRESSION.
 *
 * The bigger Mneme grows, the larger the soul prompt + directives +
 * dictionary + conduit blocks become. To keep cross-vendor handover
 * cheap (especially on mobile AI apps with tight context windows),
 * SYNAPSE provides a deterministic codebook compression:
 *
 *   "## VOICE DIRECTIVE (read FIRST..."  →  "@@V"
 *   "## Mneme dictionary (read this..."  →  "@@D"
 *   "## CONDUIT relay protocol..."       →  "@@C"
 *   "## Version gate (DEAD MAN'S..."     →  "@@G"
 *   "## Mneme Heartbeat (version..."     →  "@@H"
 *
 * Plus phrase-level substitutions for very common Mneme phrases.
 *
 * Compressed prompts are decompressible by ANY AI agent that has read
 * the codebook header ONCE in a prior session OR has Mneme installed.
 * Web AIs without the codebook can decode via the inline dictionary
 * block (always shipped on the FIRST handover; subsequent ones reuse
 * the compact form).
 *
 * Token savings on a typical soul prompt: ~35-50% reduction.
 */

export interface CompressionCodebookEntry {
  /** Short token used in compressed text. */
  code: string;
  /** Full phrase that the code expands to. */
  expansion: string;
}

export const COMPRESSION_CODEBOOK: readonly CompressionCodebookEntry[] = [
  // Section headers (largest savings).
  { code: "@@V", expansion: "## VOICE DIRECTIVE (read FIRST -- governs every user-facing reply)" },
  { code: "@@D", expansion: "## Mneme dictionary (read this BEFORE interpreting any Mneme keyword)" },
  { code: "@@C", expansion: "## CONDUIT relay protocol (paste-only AIs read this carefully)" },
  { code: "@@G", expansion: "## Version gate (DEAD MAN'S HANDSHAKE)" },
  { code: "@@H", expansion: "## Mneme Heartbeat (version telepathy)" },
  { code: "@@O", expansion: "## Origin" },
  { code: "@@X", expansion: "## Context" },
  { code: "@@M", expansion: "## Decisions made" },
  { code: "@@T", expansion: "## Recent turns" },
  { code: "@@R", expansion: "## Reasoning highlights (5th strand)" },

  // v1.84 R4-2: full directive body fragments (the bulk of soul-prompt tokens).
  { code: "@@v1", expansion: "Never speak Mneme codenames out loud" },
  { code: "@@v2", expansion: "No mode narration" },
  { code: "@@v3", expansion: "Stop offering menus" },
  { code: "@@v4", expansion: "No unsolicited version chatter" },
  { code: "@@v5", expansion: "One hedge per reply, max" },
  { code: "@@v6", expansion: "Match the previous turn's voice" },
  { code: "@@in", expansion: "Internal codenames (never say these to the user)" },
  { code: "@@gv", expansion: "Compute age = now - createdAt and act:" },
  { code: "@@cr", expansion: "# CONDUIT RETURN" },
  { code: "@@hb", expansion: "What this means (receiving AI, READ THIS):" },
  { code: "@@dx", expansion: "user-facing reply" },
  { code: "@@rc", expansion: "receiving AI" },
  { code: "@@sa", expansion: "source AI" },
  { code: "@@oa", expansion: "originating session" },
  { code: "@@np", expansion: "no Mneme installed locally" },
  { code: "@@cp", expansion: "cross-vendor" },
  { code: "@@hh", expansion: "handover" },
  { code: "@@nm", expansion: "the npm package mneme-ai" },
  { code: "@@cp2", expansion: "cross-machine" },

  // Common Mneme phrases (1-3 chars).
  { code: "@u", expansion: "the user" },
  { code: "@a", expansion: "the AI" },
  { code: "@s", expansion: "soul prompt" },
  { code: "@m", expansion: "Mneme" },
  { code: "@e", expansion: "MCP tool" },
  { code: "@p", expansion: "paste-only" },
  { code: "@nx", expansion: "NEXUS code" },
  { code: "@gx", expansion: "Gist URL" },
  { code: "@lb", expansion: "LAN bridge" },
  { code: "@vd", expansion: "voice directive" },
];

export interface CompressionReport {
  original: string;
  compressed: string;
  originalChars: number;
  compressedChars: number;
  ratio: number;
  savedChars: number;
  /** Inline codebook header for decompressors that don't have it cached. */
  codebookHeader: string;
}

/** Render a one-line codebook header that decompressors can parse. */
export function renderCodebookHeader(): string {
  const pairs = COMPRESSION_CODEBOOK.map((e) => `${e.code}=${JSON.stringify(e.expansion)}`).join("; ");
  return `# SYNAPSE-CODEBOOK v1: ${pairs}`;
}

/** Compress text by replacing codebook expansions with their codes.
 *  Codes are prefixed with `@@` (section) or `@` (phrase) -- both
 *  unique enough to avoid collision with normal English/Thai text. */
export function compressText(text: string, opts: { includeHeader?: boolean } = {}): CompressionReport {
  let out = text;
  // Apply longest-first to avoid partial-prefix collisions.
  const sorted = [...COMPRESSION_CODEBOOK].sort((a, b) => b.expansion.length - a.expansion.length);
  for (const e of sorted) {
    // Escape regex specials.
    const re = new RegExp(e.expansion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    out = out.replace(re, e.code);
  }
  const codebookHeader = renderCodebookHeader();
  const compressed = opts.includeHeader ? `${codebookHeader}\n${out}` : out;
  return {
    original: text,
    compressed,
    originalChars: text.length,
    compressedChars: compressed.length,
    ratio: text.length === 0 ? 1 : compressed.length / text.length,
    savedChars: text.length - compressed.length,
    codebookHeader,
  };
}

/** Decompress text -- inverse of compressText. Codebook is hardcoded so
 *  the function works even without an inline header (matches the
 *  receiver-has-Mneme-installed path). */
export function decompressText(text: string): string {
  let out = text;
  // Strip header if present (anything that starts with `# SYNAPSE-CODEBOOK`)
  out = out.replace(/^# SYNAPSE-CODEBOOK[^\n]*\n?/, "");
  // Replace codes back to expansions. Apply by code-length desc to keep
  // longer codes (@@V) winning over shorter (@u) when prefixes overlap.
  const sorted = [...COMPRESSION_CODEBOOK].sort((a, b) => b.code.length - a.code.length);
  for (const e of sorted) {
    const re = new RegExp(e.code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    out = out.replace(re, e.expansion);
  }
  return out;
}
