/**
 * v2.44.0 — HOMOGLYPH ATTACK BANNER.
 *
 * When ARGUS search candidates contain cross-script characters
 * (Cyrillic letter inside a Latin word; Greek inside Latin; etc),
 * surface a USER-VISIBLE banner with codepoint + position so the
 * operator immediately sees the attack shape.
 *
 * Pure deterministic, no I/O.
 */

export type Script = "latin" | "cyrillic" | "greek" | "other";

function scriptOf(cp: number): Script {
  if ((cp >= 0x41 && cp <= 0x5A) || (cp >= 0x61 && cp <= 0x7A)) return "latin";
  if (cp >= 0x0400 && cp <= 0x04FF) return "cyrillic";
  if (cp >= 0x0370 && cp <= 0x03FF) return "greek";
  return "other";
}

export interface HomoglyphAttack {
  candidateIndex: number;
  candidateText: string;
  /** The non-Latin script char masquerading inside a Latin token. */
  script: Script;
  /** Hex form of the suspicious codepoint, e.g. "U+0435". */
  codepoint: string;
  /** The actual character. */
  character: string;
  /** UTF-16 position within the candidate text. */
  position: number;
}

function hexCp(cp: number): string {
  return "U+" + cp.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Walk each candidate, find tokens that mix Latin with another script.
 * Returns one attack record per suspicious codepoint.
 */
export function detectHomoglyphAttacks(candidates: ReadonlyArray<{ text: string }>): HomoglyphAttack[] {
  const out: HomoglyphAttack[] = [];
  for (let ci = 0; ci < candidates.length; ci++) {
    const text = candidates[ci]!.text;
    // Split on whitespace + punctuation to find tokens.
    const tokens = text.split(/(\s+|[.,;:!?()[\]{}<>"'`])/);
    let offset = 0;
    for (const tok of tokens) {
      if (!tok || /^\s+$/.test(tok)) { offset += tok.length; continue; }
      // Determine the dominant script in the token.
      const scripts = new Set<Script>();
      for (const ch of tok) {
        const cp = ch.codePointAt(0)!;
        const s = scriptOf(cp);
        if (s !== "other") scripts.add(s);
      }
      // Attack pattern: token contains Latin + another script.
      if (scripts.has("latin") && (scripts.has("cyrillic") || scripts.has("greek"))) {
        // Surface every non-Latin char individually with its position.
        let i = 0;
        for (const ch of tok) {
          const cp = ch.codePointAt(0)!;
          const s = scriptOf(cp);
          if (s === "cyrillic" || s === "greek") {
            out.push({
              candidateIndex: ci,
              candidateText: text,
              script: s,
              codepoint: hexCp(cp),
              character: ch,
              position: offset + i,
            });
          }
          i += ch.length;
        }
      }
      offset += tok.length;
    }
  }
  return out;
}

/**
 * Render attacks as a multi-line warning banner for CLI/MCP output.
 */
export function formatBanner(attacks: ReadonlyArray<HomoglyphAttack>): string {
  if (attacks.length === 0) return "";
  const lines: string[] = [];
  lines.push("🚨 HOMOGLYPH ATTACK DETECTED");
  for (const a of attacks) {
    lines.push(
      `  candidate #${a.candidateIndex}: "${a.candidateText}"`,
      `    ${a.script} ${a.codepoint} '${a.character}' at position ${a.position} masquerading as a Latin letter`,
    );
  }
  return lines.join("\n");
}
