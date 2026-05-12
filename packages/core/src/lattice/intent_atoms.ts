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
      "send my brain",
      "send brain to",
    ],
    tool: "mneme.genesplice.soul-prompt",
    priority: "absolute",
    intent: "generate a paste-able soul prompt to continue this conversation in another AI",
    promise: "กำลังบีบ context เป็น soul prompt — paste ปลายทางได้เลย.",
  },

  // ─── Cross-DEVICE (NEXUS short code -- phone / tablet / 2nd laptop) ──
  {
    triggers: [
      "brain to my phone",
      "brain to phone",
      "brain to my tablet",
      "brain to tablet",
      "brain to ipad",
      "brain to another device",
      "brain to my other device",
      "send brain to my phone",
      "send brain to tablet",
      "send brain to another device",
      "send to my other device",
      "to my phone",
      "to my tablet",
      "to my ipad",
      "ส่งสมองไปอีกเครื่อง",
      "ส่งสมองข้ามเครื่อง",
      "ส่งสมองไปมือถือ",
      "ส่งสมองไป tablet",
      "ส่งสมองไป ipad",
      "ไปมือถือ",
      "ไปอีกเครื่อง",
      "device handoff",
      "mint a code",
      "give me a code",
      "nexus code",
    ],
    tool: "mneme.synapse.mint_code",
    priority: "absolute",
    intent: "mint a 6-char NEXUS code (+ QR) so the user can type or scan on another device",
    promise: "code พร้อม — พิมพ์หรือสแกนที่อีกเครื่องได้เลย.",
  },

  // ─── Cross-INTERNET (Gist URL -- different network) ──────────────────
  {
    triggers: [
      "over the internet",
      "across the internet",
      "via gist",
      "to a gist",
      "share over",
      "ส่งสมองข้ามเน็ต",
      "ส่งข้ามเน็ต",
      "ผ่าน gist",
      "private link",
      "ขอ link",
      "share link",
    ],
    tool: "mneme.genesplice.gist-transmit",
    priority: "absolute",
    intent: "upload soul prompt to a private GitHub Gist and return a short URL",
    promise: "อัปโหลด Gist + ได้ link สั้นๆ.",
  },

  // ─── LAN bridge (same WiFi) ──────────────────────────────────────────
  {
    triggers: [
      "lan bridge",
      "wifi bridge",
      "เปิด lan",
      "ใช้ wifi เดียวกัน",
      "same network",
      "same wifi",
      "lan handoff",
      "local bridge",
      "http bridge",
    ],
    tool: "mneme.diaspora.bridge.start",
    priority: "absolute",
    intent: "start the local HMAC-token HTTP bridge for same-LAN brain sync",
    promise: "Bridge เปิดที่ :7741 — เครื่องเดียวกัน WiFi fetch ได้.",
  },

  // ─── Offline / USB (Wanderer .mwt) ──────────────────────────────────
  {
    triggers: [
      "pack สมองเป็น mwt",
      "pack เป็นไฟล์",
      "ส่งสมองผ่าน usb",
      "offline transfer",
      "pack as mwt",
      "wanderer pack",
      "ไม่มีเน็ต",
    ],
    tool: "mneme.avatar.wisdom-pack",
    priority: "strong",
    intent: "pack the brain as a signed .mwt file for USB / offline transfer",
  },

  // ─── Round-trip back to source ──────────────────────────────────────
  {
    triggers: [
      "ส่งสมองกลับ",
      "ส่งสมองกลับเครื่องหลัก",
      "ส่งสมองกลับ desktop",
      "send brain back",
      "send back to desktop",
      "return brain to source",
      "bring conversation back",
    ],
    tool: "mneme.synapse.mint_code",
    priority: "absolute",
    intent: "mint a NEXUS code so the user can paste the conversation back into the source AI",
    promise: "code พร้อม — พิมพ์ที่เครื่องหลักเพื่อ resume.",
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
