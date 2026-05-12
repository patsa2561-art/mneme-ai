/**
 * v1.78.0 -- LATTICE: Pulse Contract Parser.
 *
 * Mneme pulses include action contracts like:
 *   [INFO] HIGH inbox: Mneme v1.76.0 is available
 *   (say: 'upgrade Mneme' and I'll handle it.)
 *
 * The phrase `say: '<X>' and I'll handle it` is a CONTRACT: if the
 * user says <X>, the AI MUST treat it as a literal trigger and run
 * the suggested action, NOT synthesize a freeform response.
 *
 * This parser extracts those contracts so receiving AIs can honor
 * them. Closes the loop where the pulse told the user how to upgrade
 * but Gemini interpreted "update mneme ดีไหม" as something else.
 */

export interface PulseContract {
  /** The exact phrase the user is expected to say. */
  trigger: string;
  /** The action the AI commits to when user says the trigger. */
  promisedAction: string;
  /** Raw source line, for audit. */
  source: string;
}

/** Parse pulse text for `say: '<X>' and I'll handle it` style contracts. */
export function parsePulseContracts(pulseText: string): PulseContract[] {
  if (!pulseText) return [];
  const out: PulseContract[] = [];
  // Pattern: say: '<text>' and I'll <action>
  const re = /\(?\s*say\s*:\s*['"]([^'"]+)['"][^\n]*?(?:and|then)\s+(?:I'?ll|i will|ผม)\s+([^.\n)]+)/gi;
  for (const m of pulseText.matchAll(re)) {
    out.push({
      trigger: m[1]!.trim(),
      promisedAction: m[2]!.trim(),
      source: m[0]!.trim(),
    });
  }
  return out;
}

/** Test whether a user prompt matches any pulse contract. */
export function matchPulseContract(
  contracts: PulseContract[],
  userPrompt: string,
): PulseContract | null {
  if (!userPrompt || contracts.length === 0) return null;
  const norm = userPrompt.toLowerCase().trim();
  for (const c of contracts) {
    if (norm.includes(c.trigger.toLowerCase())) return c;
  }
  return null;
}

/** Render an active pulse contract as a markdown reminder for the AI. */
export function renderPulseContract(c: PulseContract): string {
  return [
    `## Active pulse contract`,
    ``,
    `The most recent Mneme pulse promised the user:`,
    `- If they say **"${c.trigger}"**, you will **${c.promisedAction}**.`,
    ``,
    `Honor this contract literally. Do NOT reinterpret \"${c.trigger}\" through prior conversation context.`,
  ].join("\n");
}
