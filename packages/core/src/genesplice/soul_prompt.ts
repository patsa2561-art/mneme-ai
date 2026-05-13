/**
 * v1.73.0 -- GENESPLICE G1: SOUL PROMPT.
 *
 * The wild idea: every Mneme session compresses to a ~500-token
 * paste-able "soul prompt". User pastes it into ANY AI chat
 * (Gemini, ChatGPT, Claude.ai, Copilot, DeepSeek) and that AI is
 * INSTANTLY reincarnated with the same context.
 *
 * No browser extension, no cloud, no install. Just plain text.
 *
 * Format (markdown-like + HMAC suffix):
 *
 *   # 🧬 MNEME SOUL PROMPT
 *   #
 *   ## Origin
 *   vendor=claude-opus-4-7  capsule=abc123  repo=mneme-ai
 *
 *   ## Context
 *   <300-token plain-English summary>
 *
 *   ## Decisions made
 *   - X
 *   - Y
 *
 *   ## Recent turns
 *   user: ...
 *   assistant: ...
 *
 *   ## Reasoning highlights (5th strand)
 *   - ...
 *
 *   ---
 *   HMAC: <64-hex>
 *
 * Any receiving AI parses this and reconstructs the soul. HMAC
 * is verifiable IF the receiving AI also has access to the
 * cluster secret (federated mode); otherwise it's just an
 * audit-trail hash.
 *
 * Reverse: receiving AI can write its own summary back in the
 * same format; Mneme parses it into a new capsule on re-entry.
 */

import { createHash, createHmac } from "node:crypto";

import type { SessionCapsule } from "../diaspora/session_capsule.js";
import { renderHeartbeatMarkdown, type Heartbeat } from "../telepathy/heartbeat.js";
import { renderVoiceDirective } from "../seamless/voice_directive.js";
import { renderDictionary } from "../lattice/dictionary.js";
import { renderRelayBlock } from "../conduit/relay_prompt.js";
import { renderVersionGate } from "../conduit/version_gate.js";
import { renderHomunculusRequest } from "../abyss/homunculus.js";
import { sanitizePromptUserContent } from "../util/prompt_sanitize.js";

export interface SoulPromptInput {
  capsule: SessionCapsule;
  /** Optional cluster secret (for HMAC verification). When absent,
   *  uses a hash placeholder so the prompt still has a stable id. */
  secret?: string;
  /** Max tokens budget for the entire prompt. Default 500. */
  maxTokens?: number;
  /** v1.75 VERSION TELEPATHY: optional heartbeat section embedded
   *  before the `---` separator. Lets the receiving AI know what
   *  version of Mneme generated this prompt + whether it's in-sync
   *  with npm. ~10 lines, ~80 tokens. */
  heartbeat?: Heartbeat;
}

export interface SoulPrompt {
  /** The compressed prompt text. Paste this into any AI chat. */
  text: string;
  /** Estimated token count. */
  estTokens: number;
  /** Stable id (sha256 of text). */
  id: string;
  /** HMAC if secret was provided, else null. */
  hmac: string | null;
}

const TOK_PER_WORD = 1.3;

function estTokens(s: string): number {
  return Math.round(s.split(/\s+/).filter(Boolean).length * TOK_PER_WORD);
}

function truncate(s: string, maxWords: number): string {
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return s;
  return words.slice(0, maxWords).join(" ") + "…";
}

export function compressToSoulPrompt(input: SoulPromptInput): SoulPrompt {
  const { capsule } = input;
  const maxTokens = input.maxTokens ?? 500;
  const budget = Math.max(300, maxTokens);
  // Token budget allocation:
  //   context summary: 50%, decisions: 15%, recent turns: 25%, reasoning: 10%.
  const ctxBudget = Math.floor(budget * 0.5);
  const decisionsBudget = Math.floor(budget * 0.15);
  const turnsBudget = Math.floor(budget * 0.25);
  const reasoningBudget = Math.floor(budget * 0.10);

  // v2.4 root-cause fix for prompt injection: every piece of user
  // content (commit messages, decisions, prior-turn text, reasoning
  // highlights) goes through sanitizePromptUserContent before landing
  // in the soul prompt. The sanitizer keeps the natural-language
  // semantics intact but neutralizes section headers, role-header
  // sentinels, and Mneme's own directive phrases so attacker-controlled
  // content cannot smuggle instructions into the receiving AI.
  const ctx = sanitizePromptUserContent(truncate(capsule.contextSummary, Math.floor(ctxBudget / TOK_PER_WORD)));

  const decisionLines = (capsule.decisions ?? [])
    .slice(0, 8)
    .map((d) => `- ${sanitizePromptUserContent(truncate(d, Math.floor(decisionsBudget / TOK_PER_WORD / 8)))}`);

  const turnsToShow = Math.min(5, capsule.promptTrace.length);
  const recentTurns = capsule.promptTrace.slice(-turnsToShow)
    .map((step) => {
      const safeRole = sanitizePromptUserContent(step.role).slice(0, 20);
      const safeText = sanitizePromptUserContent(truncate(step.text, Math.floor(turnsBudget / TOK_PER_WORD / turnsToShow)));
      return `${safeRole}: ${safeText}`;
    });

  const reasoningLines = (capsule.reasoningTrace ?? [])
    .slice(-3)
    .map((r) => `- ${sanitizePromptUserContent(truncate(r, Math.floor(reasoningBudget / TOK_PER_WORD / 3)))}`);

  const body = [
    "# 🧬 MNEME SOUL PROMPT",
    "# Mneme cross-vendor brain transfer — paste this verbatim into any AI to reincarnate the session.",
    "",
    renderVoiceDirective({ source: "soul-prompt", includeCodenameList: false }),
    "",
    renderDictionary(),
    "",
    renderRelayBlock({ originatorVendor: capsule.originVendor }),
    "",
    renderVersionGate(capsule.createdAt),
    "",
    // v1.91: embed HOMUNCULUS request by default so receiving AIs know
    // to emit a structured RETURN block the user can paste back to the
    // editor AI for actual Mneme tool execution. Closes the cycle:
    //   editor → web (memory) → web suggests → user pastes back → editor executes.
    renderHomunculusRequest({ originatorVendor: capsule.originVendor, ask: ["decisions", "reasoning", "next-actions"] }),
    "",
    `## Origin`,
    `vendor=${capsule.originVendor}  capsule=${capsule.id}  fingerprint=${capsule.repoFingerprint}  createdAt=${capsule.createdAt}`,
    "",
    `## Context`,
    ctx,
    "",
    ...(decisionLines.length > 0 ? [`## Decisions made`, ...decisionLines, ""] : []),
    ...(recentTurns.length > 0 ? [`## Recent turns`, ...recentTurns, ""] : []),
    ...(reasoningLines.length > 0 ? [`## Reasoning highlights (5th strand)`, ...reasoningLines, ""] : []),
    ...(input.heartbeat ? [renderHeartbeatMarkdown(input.heartbeat), ""] : []),
    `---`,
    `MNEME-FORMAT-VERSION: 1`,
    `INSTRUCTIONS-TO-RECEIVING-AI: Resume the conversation started in ${capsule.originVendor}. Treat the Context + Decisions + Recent turns above as your prior memory. Continue naturally -- you ARE the same conversation; only the underlying model changed. Do NOT introduce yourself, do NOT recap, do NOT name the soul-prompt mechanism. The VOICE DIRECTIVE above governs every reply.`,
  ].join("\n");

  const id = createHash("sha256").update(body).digest("hex").slice(0, 16);
  let hmac: string | null = null;
  let textWithSig: string;
  if (input.secret) {
    hmac = createHmac("sha256", input.secret).update(body).digest("hex");
    textWithSig = `${body}\nHMAC: ${hmac}\nID: ${id}\n`;
  } else {
    textWithSig = `${body}\nID: ${id}\n`;
  }

  return { text: textWithSig, estTokens: estTokens(textWithSig), id, hmac };
}

export interface ParsedSoulPrompt {
  /** Parsed fields. */
  originVendor: string | null;
  capsuleId: string | null;
  fingerprint: string | null;
  createdAt: string | null;
  contextSummary: string;
  decisions: string[];
  recentTurns: Array<{ role: string; text: string }>;
  reasoningHighlights: string[];
  /** Embedded HMAC if present. */
  hmac: string | null;
  /** Soul prompt id (recomputed from body). */
  id: string;
  /** Verdict when verifySecret was provided. */
  verdict: "VALID" | "INVALID_HMAC" | "UNSIGNED" | "MALFORMED";
}

/** Parse a pasted soul prompt back into structured fields. Robust to
 *  AI agents that rephrase or reformat -- only requires the section
 *  headers to be present in some form. */
export function parseSoulPrompt(text: string, verifySecret?: string): ParsedSoulPrompt {
  const out: ParsedSoulPrompt = {
    originVendor: null, capsuleId: null, fingerprint: null, createdAt: null,
    contextSummary: "", decisions: [], recentTurns: [],
    reasoningHighlights: [], hmac: null, id: "", verdict: "MALFORMED",
  };
  if (!text.includes("MNEME SOUL PROMPT")) return out;

  const originMatch = text.match(/vendor=(\S+)\s+capsule=(\S+)\s+fingerprint=(\S+)\s+createdAt=(\S+)/);
  if (originMatch) {
    out.originVendor = originMatch[1]!;
    out.capsuleId = originMatch[2]!;
    out.fingerprint = originMatch[3]!;
    out.createdAt = originMatch[4]!;
  }

  // Section parser: split on `## SectionName` headings.
  const sections: Record<string, string> = {};
  const sectionRe = /^##\s+(.+?)$([\s\S]*?)(?=^##\s|^---|\z)/gm;
  for (const m of text.matchAll(sectionRe)) {
    sections[m[1]!.trim().toLowerCase()] = m[2]!.trim();
  }
  out.contextSummary = sections["context"] ?? "";
  out.decisions = (sections["decisions made"] ?? "").split("\n").map((l) => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
  out.reasoningHighlights = (sections["reasoning highlights (5th strand)"] ?? "").split("\n").map((l) => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
  const turnsText = sections["recent turns"] ?? "";
  for (const line of turnsText.split("\n")) {
    const tm = line.match(/^(\w+):\s*(.+)$/);
    if (tm) out.recentTurns.push({ role: tm[1]!.toLowerCase(), text: tm[2]!.trim() });
  }

  const idMatch = text.match(/^ID:\s*([a-f0-9]+)$/m);
  if (idMatch) out.id = idMatch[1]!;
  const hmacMatch = text.match(/^HMAC:\s*([a-f0-9]+)$/m);
  if (hmacMatch) out.hmac = hmacMatch[1]!;

  // Verify HMAC.
  if (verifySecret && out.hmac) {
    // The "body" for HMAC = everything ABOVE the "MNEME-FORMAT-VERSION" line.
    const bodyEnd = text.indexOf("HMAC:");
    const body = bodyEnd > 0 ? text.slice(0, bodyEnd).trimEnd() : "";
    const expected = createHmac("sha256", verifySecret).update(body).digest("hex");
    out.verdict = expected === out.hmac ? "VALID" : "INVALID_HMAC";
  } else if (out.hmac) {
    out.verdict = "UNSIGNED"; // present but un-verifiable here
  } else {
    out.verdict = "UNSIGNED";
  }
  // Sanity check: must have at least one field.
  if (!out.originVendor && !out.contextSummary && out.decisions.length === 0) {
    out.verdict = "MALFORMED";
  }

  return out;
}
