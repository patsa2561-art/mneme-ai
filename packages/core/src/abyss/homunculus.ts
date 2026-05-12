/**
 * v1.76.0 -- ABYSS MINION 3: HOMUNCULUS (receiver write-back).
 *
 * Bidirectional brain sync without a backchannel.
 *
 * When a soul prompt is sent to a foreign AI (ChatGPT, Gemini),
 * append a "callback prompt" that asks the receiver to RETURN its
 * OWN soul prompt at the end of the session. The user pastes that
 * return prompt back into Mneme, which ingests it via
 * `parseHomunculusReturn` and merges it into the local genome.
 *
 * Loop closure:
 *   1. Mneme generates soul prompt + appends `## Homunculus request`.
 *   2. User pastes into ChatGPT.
 *   3. ChatGPT continues the work + (at session end) emits a return
 *      soul prompt in the agreed format.
 *   4. User pastes the return into Mneme.
 *   5. Mneme parses, merges decisions + reasoning trace + new vaccines
 *      into the local genome via GENESPLICE recombine.
 *
 * No API key. No webhook. No server. Just user-as-courier with a
 * structured contract.
 */

export interface HomunculusRequestOptions {
  /** What the originator wants to learn back. Default: decisions + reasoning. */
  ask?: ("decisions" | "reasoning" | "vaccines" | "next-actions")[];
  /** Originating vendor (so the return prompt knows who to address). */
  originatorVendor?: string;
}

/** Render the callback instruction block that gets appended to a soul prompt. */
export function renderHomunculusRequest(opts: HomunculusRequestOptions = {}): string {
  const ask = opts.ask ?? ["decisions", "reasoning", "next-actions"];
  const originator = opts.originatorVendor ?? "claude-opus-4-7";
  const lines: string[] = [];
  lines.push(`## Homunculus request (write-back contract)`);
  lines.push(``);
  lines.push(`At the end of this session OR when the user types "homunculus return", emit a block in this EXACT format so the originating ${originator} session can ingest it back into the local Mneme:`);
  lines.push(``);
  lines.push("```");
  lines.push(`# HOMUNCULUS RETURN`);
  lines.push(`originator: ${originator}`);
  lines.push(`returning_from: <your-model-id>`);
  if (ask.includes("decisions")) lines.push(`decisions: |\n  - <decision 1>\n  - <decision 2>`);
  if (ask.includes("reasoning")) lines.push(`reasoning: |\n  - <key reasoning highlight>`);
  if (ask.includes("vaccines")) lines.push(`vaccines: |\n  - <hallucination strain caught + how>`);
  if (ask.includes("next-actions")) lines.push(`next_actions: |\n  - <what should happen next>`);
  lines.push("```");
  lines.push(``);
  lines.push(`The user will paste this back into their local Mneme. Be terse -- one bullet per line, no prose paragraphs.`);
  return lines.join("\n");
}

export interface HomunculusReturn {
  originator: string;
  returningFrom: string;
  decisions: string[];
  reasoning: string[];
  vaccines: string[];
  nextActions: string[];
}

/** Parse a HOMUNCULUS RETURN block from pasted text. Returns null if the
 *  required fields are missing. */
export function parseHomunculusReturn(text: string): HomunculusReturn | null {
  if (!text.includes("HOMUNCULUS RETURN")) return null;
  const get = (key: string): string | null => {
    const m = text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return m ? m[1]!.trim() : null;
  };
  // Line-based block parser: find `^key: |` then collect indented lines.
  const lines = text.split(/\r?\n/);
  const block = (key: string): string[] => {
    const headerRe = new RegExp(`^${key}:\\s*\\|\\s*$`);
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!headerRe.test(lines[i]!)) continue;
      for (let j = i + 1; j < lines.length; j++) {
        const ln = lines[j]!;
        if (ln === "") continue; // blank lines allowed inside the block
        if (!/^\s/.test(ln)) break; // unindented line ends the block
        const item = ln.replace(/^\s*-\s*/, "").trim();
        if (item) out.push(item);
      }
      break;
    }
    return out;
  };
  const originator = get("originator");
  const returningFrom = get("returning_from");
  if (!originator || !returningFrom) return null;
  return {
    originator,
    returningFrom,
    decisions: block("decisions"),
    reasoning: block("reasoning"),
    vaccines: block("vaccines"),
    nextActions: block("next_actions"),
  };
}

/** Summarize a parsed return for the originator AI to relay to the user.
 *  Bug #2 (v1.81): null-safe -- returns a placeholder instead of throwing
 *  when the caller passes null (e.g. parseHomunculusReturn output without
 *  an intermediate guard). */
export function summarizeHomunculusReturn(r: HomunculusReturn | null): string {
  if (r === null || r === undefined) return "(no homunculus return)";
  const lines: string[] = [];
  lines.push(`Homunculus return from \`${r.returningFrom}\` → \`${r.originator}\``);
  if (r.decisions.length > 0) lines.push(`Decisions: ${r.decisions.length}`);
  if (r.reasoning.length > 0) lines.push(`Reasoning highlights: ${r.reasoning.length}`);
  if (r.vaccines.length > 0) lines.push(`New vaccines: ${r.vaccines.length}`);
  if (r.nextActions.length > 0) lines.push(`Next actions: ${r.nextActions.length}`);
  return lines.join(" · ");
}
