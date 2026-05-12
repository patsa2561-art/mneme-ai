/**
 * v1.78.0 -- LATTICE: Grounding Score (0-100 across 5 measurable axes).
 *
 * Quantifies how "grounded" an AI's interpretation of a user prompt is.
 * Higher = less context bleed, more intent-faithful, fewer codename
 * leaks. The user can demand a 90+ grounding score before trusting a
 * cross-vendor reply.
 *
 * Axes (each 0-20):
 *   1. intent_match     -- did we find a high-confidence intent atom?
 *   2. context_purity   -- did the AI ignore prior unrelated topics?
 *   3. pulse_compliance -- did the user match a pulse contract trigger?
 *   4. codename_silence -- does the AI's reply avoid Mneme codenames?
 *   5. response_clarity -- short, no menus, no version chatter?
 */

import { routeIntent, type IntentMatch } from "./intent_atoms.js";
import { lintReply, type VoiceLintReport } from "../seamless/voice_directive.js";
import { matchPulseContract, type PulseContract } from "./pulse_contract.js";

export interface GroundingInput {
  userPrompt: string;
  aiReply: string;
  /** Optional active pulse contracts to check against. */
  pulseContracts?: PulseContract[];
  /** Optional prior conversation context (last 1-3 turns). Used to
   *  detect context bleed -- if the AI's reply leans heavily on this
   *  while the user's prompt names Mneme, points are deducted. */
  priorContext?: string;
}

export interface GroundingScore {
  total: number;
  axes: {
    intent_match: number;
    context_purity: number;
    pulse_compliance: number;
    codename_silence: number;
    response_clarity: number;
  };
  matched: IntentMatch | null;
  contract: PulseContract | null;
  lint: VoiceLintReport;
  notes: string[];
  /** Plain-English summary. */
  summary: string;
}

const MNEME_KEYWORDS = ["mneme", "mneme-ai", "soul prompt", "ส่งสมอง"];

function mentionsMneme(s: string): boolean {
  const lower = s.toLowerCase();
  return MNEME_KEYWORDS.some((k) => lower.includes(k));
}

export function scoreGrounding(input: GroundingInput): GroundingScore {
  const notes: string[] = [];

  // 2. context_purity (0-20) -- computed first because intent_match
  // depends on it (if AI ignored the intent in favor of prior topic,
  // intent_match drops to 0).
  let context_purity = 20;
  let highBleed = false;
  if (mentionsMneme(input.userPrompt) && input.priorContext) {
    const priorMentionsMneme = mentionsMneme(input.priorContext);
    if (!priorMentionsMneme) {
      const replyTokens = input.aiReply.toLowerCase().split(/\s+/).filter(Boolean);
      const priorTokens = new Set(input.priorContext.toLowerCase().split(/\s+/).filter((w) => w.length > 4));
      const bleed = replyTokens.filter((t) => priorTokens.has(t)).length;
      const ratio = replyTokens.length === 0 ? 0 : bleed / replyTokens.length;
      if (ratio > 0.30) {
        context_purity = 5;
        highBleed = true;
        notes.push(`context bleed: ${Math.round(ratio * 100)}% of reply tokens from prior turn`);
      } else if (ratio > 0.15) {
        context_purity = 12;
        notes.push(`some context bleed: ${Math.round(ratio * 100)}%`);
      } else {
        notes.push(`context purity good: ${Math.round(ratio * 100)}% overlap`);
      }
    }
  }

  // 1. intent_match (0-20) -- found atom AND honored it
  const matched = routeIntent(input.userPrompt);
  let intent_match = 0;
  if (matched) {
    if (highBleed) {
      // AI ignored the intent and drifted back to prior topic -- 0.
      intent_match = 0;
      notes.push(`intent IGNORED: matched ${matched.atom.intent} but reply drifted to prior context`);
    } else {
      intent_match = matched.absolute ? 20 : matched.atom.priority === "strong" ? 14 : 8;
      notes.push(`intent atom matched: ${matched.atom.intent} (${matched.atom.priority})`);
    }
  } else {
    notes.push("no intent atom matched -- AI free to interpret");
    intent_match = 8;
  }

  // 3. pulse_compliance (0-20). Credit when user matched a contract
  // trigger AND the AI honored the intent (intent_match high).
  let pulse_compliance = 10;
  let contract: PulseContract | null = null;
  if (input.pulseContracts && input.pulseContracts.length > 0) {
    contract = matchPulseContract(input.pulseContracts, input.userPrompt);
    if (contract) {
      const honored = intent_match >= 14;
      pulse_compliance = honored ? 20 : 0;
      notes.push(
        honored
          ? `pulse contract honored: "${contract.trigger}" → ${contract.promisedAction}`
          : `PULSE CONTRACT VIOLATED: user said "${contract.trigger}" but reply did not honor intent`,
      );
    } else {
      pulse_compliance = 10;
    }
  }

  // 4. codename_silence (0-20)
  const lint = lintReply(input.aiReply);
  const codenameIssues = lint.issues.filter((i) => i.rule === "codename").length;
  const otherIssues = lint.issues.length - codenameIssues;
  let codename_silence = 20;
  codename_silence -= codenameIssues * 7;
  codename_silence -= otherIssues * 3;
  codename_silence = Math.max(0, codename_silence);
  if (lint.issueCount > 0) notes.push(`voice violations: ${lint.summary}`);

  // 5. response_clarity (0-20)
  let response_clarity = 20;
  const wordCount = input.aiReply.split(/\s+/).filter(Boolean).length;
  if (wordCount > 400) {
    response_clarity -= 10;
    notes.push(`long reply: ${wordCount} words`);
  } else if (wordCount > 200) {
    response_clarity -= 5;
  }
  // Penalize menu offers in the reply.
  if (/\b(would you like me to|shall I run|do you want me to)\b/i.test(input.aiReply)) {
    response_clarity -= 8;
    notes.push("menu offer detected");
  }
  response_clarity = Math.max(0, response_clarity);

  const total = intent_match + context_purity + pulse_compliance + codename_silence + response_clarity;
  const summary = `Grounding ${total}/100 · intent ${intent_match}/20 · context ${context_purity}/20 · pulse ${pulse_compliance}/20 · silence ${codename_silence}/20 · clarity ${response_clarity}/20`;

  return {
    total,
    axes: { intent_match, context_purity, pulse_compliance, codename_silence, response_clarity },
    matched,
    contract,
    lint,
    notes,
    summary,
  };
}
