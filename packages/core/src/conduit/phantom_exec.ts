/**
 * v1.80.0 -- CONDUIT: PHANTOM EXECUTION (the wildest power).
 *
 * Web AIs can't actually call Mneme tools. But the soul prompt
 * carries enough context (tool catalog excerpt + recent state) for
 * the web AI to SIMULATE a tool's likely output. Output is marked
 * `[PHANTOM]` so the user knows it's conceptual, not real.
 *
 * Use case: user is in ChatGPT-web, asks "what would mneme.apoptosis
 * say about this claim?". Web AI gives a phantom verdict with
 * disclaimer. User decides if real-exec via paste-back is worth it.
 *
 * NOT a substitute for real execution. A PHANTOM is a low-cost
 * preview that surfaces value while the user is still in the
 * destination AI's chat window.
 */

export interface PhantomRequest {
  /** The Mneme tool name the user asked about. */
  toolName: string;
  /** What the user wants the tool to do. */
  intent: string;
  /** Optional pre-existing context from the soul prompt. */
  context?: string;
}

export interface PhantomResponse {
  toolName: string;
  phantom: true;
  /** Conceptual output the AI generated. */
  conceptualOutput: string;
  /** Confidence in the phantom output (web AI's own self-rating). */
  confidence: "high" | "medium" | "low";
  /** Disclaimer the user MUST see. */
  disclaimer: string;
  /** What the user should do to get a real execution. */
  realExecHint: string;
}

/** Render the PHANTOM EXECUTION directive (embedded in soul prompts). */
export function renderPhantomDirective(): string {
  const lines: string[] = [];
  lines.push(`## Phantom Execution (PE) -- preview-without-running`);
  lines.push(``);
  lines.push(`When the user asks you to "run" or "call" a Mneme tool by name (e.g. \`mneme.apoptosis.detect\`), you cannot actually execute it from a paste-only surface. BUT you can preview a CONCEPTUAL output based on:`);
  lines.push(``);
  lines.push(`- the tool's description (if it appears in this soul prompt)`);
  lines.push(`- the conversation context above`);
  lines.push(`- general knowledge of what the tool likely does`);
  lines.push(``);
  lines.push(`Render the phantom output like this:`);
  lines.push(``);
  lines.push("```");
  lines.push(`[PHANTOM] mneme.<tool> (NOT actually executed -- conceptual preview)`);
  lines.push(`conceptual output:`);
  lines.push(`  <your best simulation in 1-3 sentences>`);
  lines.push(`confidence: <high | medium | low>`);
  lines.push(`for real execution: paste a CONDUIT RETURN block back into your editor AI`);
  lines.push("```");
  lines.push(``);
  lines.push(`This is HONESTY-WITH-VALUE. The user gets a preview now, can decide if real-exec is worth the round-trip.`);
  return lines.join("\n");
}

/** Build a phantom response (mostly used in tests + previews). */
export function buildPhantom(request: PhantomRequest, conceptualOutput: string, confidence: "high" | "medium" | "low" = "low"): PhantomResponse {
  return {
    toolName: request.toolName,
    phantom: true,
    conceptualOutput,
    confidence,
    disclaimer: `This is a PHANTOM preview of ${request.toolName} -- NOT a real execution. The receiving AI cannot run Mneme tools.`,
    realExecHint: `For real execution: paste a CONDUIT RETURN block back into your editor AI (Claude Code / Cursor / etc.).`,
  };
}
