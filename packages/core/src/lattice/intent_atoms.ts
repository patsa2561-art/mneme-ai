/**
 * v1.78.0 -- LATTICE: Intent Atom Catalog.
 *
 * Hardcoded {trigger phrase → Mneme tool} map. When user input matches
 * any trigger, the AI MUST route to that tool BEFORE blending with
 * conversational context. Stops the "update mneme ดีไหม" → "let me
 * optimize your One Piece shipping" disaster.
 *
 * Priority levels:
 *   absolute -- single trigger phrase locks the intent; no conversation
 *               context can override it.
 *   strong   -- prefer this routing unless explicit cue says otherwise.
 *   advisory -- one of N likely intents; AI can disambiguate.
 */

export type IntentPriority = "absolute" | "strong" | "advisory";

export interface IntentAtom {
  /** Trigger phrases (case-insensitive substring matches). Include
   *  Thai + English + common typos / shortenings. */
  triggers: readonly string[];
  /** Mneme tool to route to. Use the full `mneme.*` name. */
  tool: string;
  /** How firmly the AI should obey this routing. */
  priority: IntentPriority;
  /** Short plain-English label for the intent. */
  intent: string;
  /** What the AI should say while running (in Thai+English). */
  promise?: string;
}

export const INTENT_ATOMS: readonly IntentAtom[] = [
  // ─── System: upgrade ────────────────────────────────────────────────
  {
    triggers: [
      "update mneme",
      "upgrade mneme",
      "อัปเดต mneme",
      "อัปเกรด mneme",
      "อัพเดต mneme",
      "อัพเกรด mneme",
      "update mneme ดีไหม",
      "upgrade mneme ดีไหม",
      "mneme เวอร์ชั่นใหม่",
      "ลง mneme version ใหม่",
      "mneme is behind",
      "mneme out of date",
    ],
    tool: "mneme.system.upgrade",
    priority: "absolute",
    intent: "upgrade the local Mneme installation to the latest npm version",
    promise: "อัปเกรด Mneme ให้ครับ — one moment.",
  },
  // ─── Cross-vendor handoff (soul prompt) ─────────────────────────────
  {
    triggers: [
      "ส่งสมอง",
      "ส่งสมองให้",
      "hand off brain",
      "hand off to",
      "continue in chatgpt",
      "continue in gemini",
      "continue in claude",
      "soul prompt",
      "transfer this conversation",
      "ย้ายสมองไป",
      "ส่งบทสนทนาให้",
    ],
    tool: "mneme.genesplice.soul-prompt",
    priority: "absolute",
    intent: "generate a paste-able soul prompt to continue this conversation in another AI",
    promise: "กำลังบีบ context เป็น soul prompt — paste ปลายทางได้เลย.",
  },
  // ─── Version check ──────────────────────────────────────────────────
  {
    triggers: [
      "what version is mneme",
      "mneme version",
      "เวอร์ชั่นอะไร",
      "is mneme up to date",
      "are we on the latest",
      "mneme ล่าสุด",
      "ตรวจเวอร์ชั่น",
      "ตรวจสอบเวอร์ชั่น mneme",
    ],
    tool: "mneme.telepathy.heartbeat",
    priority: "absolute",
    intent: "report current Mneme version + npm-latest comparison",
    promise: "เช็ค heartbeat ครับ.",
  },
  // ─── Capsule cleanup ────────────────────────────────────────────────
  {
    triggers: ["prune capsules", "clean capsule", "ลบ capsule เก่า", "capsule dir บวม"],
    tool: "mneme.abyss.scythe.prune",
    priority: "absolute",
    intent: "prune .mneme/capsules/ via TTL + count cap",
  },
  // ─── Voice lint (escalated to absolute) ─────────────────────────────
  {
    triggers: ["lint voice", "scan reply for jargon", "เช็คเสียง AI", "AI พูดศัพท์ภายใน"],
    tool: "mneme.seamless.lint",
    priority: "absolute",
    intent: "scan an AI draft reply for Mneme codename / mode-narration violations",
  },
  // ─── Soul archive ───────────────────────────────────────────────────
  {
    triggers: ["save this brain", "archive this soul", "soul history", "show past handovers", "เก็บสมองไว้"],
    tool: "mneme.abyss.revenant.archive",
    priority: "strong",
    intent: "archive the current soul prompt for later replay",
  },
  // ─── Voice lint ─────────────────────────────────────────────────────
  {
    triggers: ["lint this reply", "voice check", "check my draft", "AI พูดศัพท์ใน"],
    tool: "mneme.seamless.lint",
    priority: "strong",
    intent: "scan an AI draft for codename / mode-narration / version-chatter violations",
  },
  // ─── Memory: ask ────────────────────────────────────────────────────
  {
    triggers: ["why does this code", "who introduced", "what's the history of", "ทำไม code นี้"],
    tool: "mneme.memory.ask",
    priority: "strong",
    intent: "answer a 'why / who / what' question from git memory",
  },
  // ─── Apoptosis ──────────────────────────────────────────────────────
  {
    triggers: [
      "verify this claim",
      "fact check this",
      "is this a hallucination",
      "AI โกหก",
      "AI ฮัลลู",
      "check ai output",
    ],
    tool: "mneme.apoptosis.detect",
    priority: "strong",
    intent: "fire 7-oracle hallucination detector",
  },
];

export interface IntentMatch {
  atom: IntentAtom;
  matchedTrigger: string;
  /** 0..1 confidence -- length of matched trigger / length of input. */
  confidence: number;
  /** True if the matched atom is priority=absolute. */
  absolute: boolean;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[?!.,;:"'`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Find the best-matching intent atom for a user prompt, or null. */
export function routeIntent(userText: string): IntentMatch | null {
  if (!userText) return null;
  const norm = normalize(userText);
  let best: IntentMatch | null = null;
  for (const atom of INTENT_ATOMS) {
    for (const trigger of atom.triggers) {
      const t = normalize(trigger);
      if (!t) continue;
      if (norm.includes(t)) {
        const confidence = Math.min(1, t.length / Math.max(1, norm.length));
        const candidate: IntentMatch = {
          atom,
          matchedTrigger: trigger,
          confidence,
          absolute: atom.priority === "absolute",
        };
        if (
          !best ||
          // Prefer longer trigger -- more specific match.
          t.length > normalize(best.matchedTrigger).length ||
          // Tie-break: prefer absolute over strong over advisory.
          (t.length === normalize(best.matchedTrigger).length &&
            atomRank(atom.priority) > atomRank(best.atom.priority))
        ) {
          best = candidate;
        }
      }
    }
  }
  return best;
}

function atomRank(p: IntentPriority): number {
  return p === "absolute" ? 3 : p === "strong" ? 2 : 1;
}
