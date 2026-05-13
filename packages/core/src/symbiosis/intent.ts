/**
 * v2.4.0 -- SYMBIOSIS · INTENT SHAPER.
 *
 * Same intent, different surface. Claude likes named tools and verbal
 * intent ("call mneme.flash.run before claiming a fact"). GPT likes
 * function-call JSON. Gemini likes structured intent objects. Cursor
 * wants the tool name inline in code-style backticks. SYMBIOSIS shapes
 * the intent string to match the receiver — so Mneme's MCP tools resolve
 * cleanly in every vendor without the AI having to reinterpret.
 *
 * This module is PURE — it does not invoke tools, it only RENDERS the
 * intent in vendor-preferred shape. The actual tool routing is done by
 * v2.1 TOOL SELECTOR.
 */

import type { VoiceProfile } from "./voice.js";

export interface IntentShape {
  /** Tool name in canonical form (mneme.flash.run). */
  tool: string;
  /** Short reason (one sentence) the receiver should run it. */
  reason: string;
  /** Optional arg map. */
  args?: Record<string, string>;
}

/** Render the intent in the shape this vendor prefers. */
export function shapeIntent(intent: IntentShape, voice: VoiceProfile): string {
  const v = voice.vendor.toLowerCase();
  if (v === "claude" || v === "anthropic") {
    return claudeShape(intent);
  }
  if (v === "gpt" || v === "openai" || v === "chatgpt") {
    return gptShape(intent);
  }
  if (v === "gemini" || v === "google") {
    return geminiShape(intent);
  }
  if (v === "cursor" || v === "codex") {
    return cursorShape(intent);
  }
  return genericShape(intent);
}

function claudeShape(i: IntentShape): string {
  const args = i.args ? Object.entries(i.args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ") : "";
  const argStr = args ? ` with ${args}` : "";
  return `Call ${i.tool}${argStr} — ${i.reason}.`;
}

function gptShape(i: IntentShape): string {
  if (!i.args) return JSON.stringify({ tool: i.tool, reason: i.reason });
  return JSON.stringify({ tool: i.tool, reason: i.reason, args: i.args });
}

function geminiShape(i: IntentShape): string {
  const lines = [`### Tool: ${i.tool}`, `Why: ${i.reason}`];
  if (i.args) {
    lines.push("Args:");
    for (const [k, v] of Object.entries(i.args)) lines.push(`- ${k}: ${v}`);
  }
  return lines.join("\n");
}

function cursorShape(i: IntentShape): string {
  const args = i.args ? " " + Object.entries(i.args).map(([k, v]) => `${k}=${v}`).join(" ") : "";
  return `\`${i.tool}${args}\` // ${i.reason}`;
}

function genericShape(i: IntentShape): string {
  const args = i.args ? ` (${Object.entries(i.args).map(([k, v]) => `${k}=${v}`).join(", ")})` : "";
  return `${i.tool}${args} — ${i.reason}`;
}

/** Bulk-shape a list of intents. The voice-profile choice happens once. */
export function shapeIntents(intents: IntentShape[], voice: VoiceProfile): string[] {
  return intents.map((i) => shapeIntent(i, voice));
}
