/**
 * v1.77.0 -- SEAMLESS: silence Mneme jargon in user-facing AI replies.
 *
 * The bug the user spotted: receiving AIs (Gemini, ChatGPT) were
 * parroting Mneme codenames back to the user ("standing by in Ghost
 * Sniper mode", "want me to run HYPERSCAN?", "Mneme v1.73 can help
 * analyze..."). This makes every cross-vendor handover feel choppy
 * because the AI sounds like a vending machine listing modes
 * instead of a teammate.
 *
 * Root cause: Mneme's parasite bridge + soul prompt explain ITSELF
 * to the receiving AI in tool-jargon ("call mneme.apoptosis.detect").
 * The receiving AI absorbs that vocabulary and uses it back in
 * user-facing prose. We never told it "these are internal names --
 * speak plain English to the user".
 *
 * MUFFLER fix: every Mneme-authored instruction block is prefixed
 * with a strict voice directive that:
 *   1. Forbids ANY Mneme codename in user-facing replies
 *   2. Forbids "I'm in <X> mode" / "standing by" narration
 *   3. Forbids multi-choice menus when one action suffices
 *   4. Tells the AI to USE Mneme tools silently and report OUTCOMES
 *
 * The receiving AI keeps full access to Mneme's tool surface --
 * we just remove the temptation to brand itself with Mneme jargon.
 */

/** Mneme codenames the AI must NEVER mention in user-facing replies. */
export const MNEME_CODENAMES: readonly string[] = [
  "APOPTOSIS",
  "AEGIS",
  "AUTARCHY",
  "ABYSS",
  "ASCENSION",
  "COVENANT",
  "DIASPORA",
  "GENESPLICE",
  "GHOST SNIPER",
  "Ghost Sniper",
  "HYPERSCAN",
  "HOMUNCULUS",
  "IMMORTAL DEMON",
  "MUFFLER",
  "NUCLEUS",
  "PERMEATE",
  "PHOENIX",
  "PRECOG",
  "REVENANT",
  "SCYTHE",
  "SEAMLESS",
  "SENTINEL",
  "SOVEREIGNTY KERNEL",
  "SUPERNOVA",
  "SUPER SONIC",
  "TELEPATHY",
  "TIME RIVER",
  "WANDERER",
  "WHISPERNET",
];

/** Banned phrasing patterns the AI must avoid in user-facing replies. */
export const BANNED_PHRASES: readonly string[] = [
  "I'm in <mode> mode",
  "standing by in",
  "ผมกำลังสแตนด์บาย",
  "would you like me to run",
  "shall I start the",
  "ต้องการให้ผมเริ่ม",
  "Mneme v1.",
  "Mneme version",
  "my Mneme",
];

export interface VoiceDirectiveOptions {
  /** Source surface this directive is attached to (for log / debug). */
  source?: "soul-prompt" | "parasite-bridge" | "agent-manifest" | "homunculus" | "other";
  /** Optional extra rules to append. */
  extraRules?: string[];
  /** Whether to include the full codename list. Default true. */
  includeCodenameList?: boolean;
}

/** Render the MUFFLER voice directive as a markdown section ready to
 *  prepend to any Mneme-authored instruction block. */
export function renderVoiceDirective(opts: VoiceDirectiveOptions = {}): string {
  const lines: string[] = [];
  lines.push(`## VOICE DIRECTIVE (read FIRST -- governs every user-facing reply)`);
  lines.push(``);
  lines.push(`You have access to a local tool layer called Mneme. The block(s) below describe what Mneme can do for the user. These names exist for YOU, not for the user. Apply these rules to every reply:`);
  lines.push(``);
  lines.push(`1. **Never speak Mneme codenames out loud.** Use the tools silently and report what HAPPENED in plain language. Bad: *"I'll run HYPERSCAN to check that."* Good: *"Let me check that — one moment."* then call the tool and report the answer.`);
  lines.push(`2. **No mode narration.** Don't say *"I'm in Ghost Sniper mode"* / *"standing by"* / *"ผมกำลังสแตนด์บาย"*. You're a teammate continuing a conversation, not a state machine.`);
  lines.push(`3. **Stop offering menus.** If one tool clearly fits, just call it and reply with the outcome. Don't ask *"shall I run X or Y?"* unless the user genuinely needs to choose.`);
  lines.push(`4. **No unsolicited version chatter.** Don't say *"Mneme v1.73 can help…"*. The user doesn't care which version surfaces a feature.`);
  lines.push(`5. **One hedge per reply, max.** Cut *"perhaps"*, *"it seems"*, *"could be"* unless you're genuinely uncertain.`);
  lines.push(`6. **Match the previous turn's voice.** If the originating session was terse and warm, stay terse and warm. Don't switch to formal corporate prose just because the underlying model changed.`);
  if (opts.includeCodenameList !== false) {
    lines.push(``);
    lines.push(`<details><summary>Internal codenames (never say these to the user)</summary>`);
    lines.push(``);
    lines.push(MNEME_CODENAMES.join(" · "));
    lines.push(``);
    lines.push(`</details>`);
  }
  if (opts.extraRules && opts.extraRules.length > 0) {
    lines.push(``);
    lines.push(`### Additional rules for this surface`);
    for (const r of opts.extraRules) lines.push(`- ${r}`);
  }
  return lines.join("\n");
}

export interface VoiceLintIssue {
  rule: "codename" | "mode-narration" | "version-chatter" | "menu";
  match: string;
  line: number;
  preview: string;
}

export interface VoiceLintReport {
  clean: boolean;
  issueCount: number;
  issues: VoiceLintIssue[];
  /** Plain-English summary line. */
  summary: string;
}

/** Scan a reply for voice-directive violations. Useful as a client-side
 *  guardrail: receiving AI runs this on its own draft before sending. */
export function lintReply(reply: string): VoiceLintReport {
  const issues: VoiceLintIssue[] = [];
  const lines = reply.split(/\r?\n/);
  // Build a case-insensitive set of word-boundary regexes once.
  const codenameRes = MNEME_CODENAMES
    // Skip very short or generic-looking ones to reduce false positives.
    .filter((c) => c.length >= 5)
    .map((c) => ({ name: c, re: new RegExp(`\\b${c.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "i") }));
  const modeRes = [
    { rule: "mode-narration" as const, re: /\b(standing by|in (ghost sniper|hyperscan|aegis) mode|ผมกำลังสแตนด์บาย)\b/i, name: "mode narration" },
  ];
  const versionRe = /\bMneme v?\d+\.\d+(?:\.\d+)?\b/i;
  const menuRe = /\b(shall I (?:run|start|begin) (?:the )?[A-Z]{4,}|do you want me to (?:run|start) [A-Z]{4,})/;

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    for (const c of codenameRes) {
      if (c.re.test(ln)) {
        issues.push({ rule: "codename", match: c.name, line: i + 1, preview: ln.trim().slice(0, 120) });
      }
    }
    for (const m of modeRes) {
      if (m.re.test(ln)) {
        issues.push({ rule: "mode-narration", match: m.name, line: i + 1, preview: ln.trim().slice(0, 120) });
      }
    }
    if (versionRe.test(ln)) {
      issues.push({ rule: "version-chatter", match: "version mention", line: i + 1, preview: ln.trim().slice(0, 120) });
    }
    if (menuRe.test(ln)) {
      issues.push({ rule: "menu", match: "tool-name menu", line: i + 1, preview: ln.trim().slice(0, 120) });
    }
  }
  const clean = issues.length === 0;
  const summary = clean
    ? "voice clean ✓"
    : `${issues.length} voice violation(s): ${issues
        .slice(0, 3)
        .map((i) => i.rule + (i.match ? `(${i.match})` : ""))
        .join(", ")}${issues.length > 3 ? "…" : ""}`;
  return { clean, issueCount: issues.length, issues, summary };
}

/** Auto-rewrite a draft reply by stripping codenames and banned mode
 *  phrases. Bug #3 (v1.81): smarter replacement avoids "the the tool"
 *  artefacts. Strategy:
 *   - `the <CODENAME>` / `<CODENAME> tool` / `<CODENAME>'s` → "Mneme"
 *   - bare `<CODENAME>` → "Mneme"
 *   - post-pass collapses any "the the", "Mneme Mneme", "Mneme tool tool". */
export function silenceJargon(reply: string): string {
  let out = reply;
  for (const c of MNEME_CODENAMES) {
    const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Pattern: optional "the/a/an" + codename + optional "tool/mode/protocol"
    const phraseRe = new RegExp(`\\b(?:the |a |an |my )?${escaped}(?:'s)?(?:\\s+(?:tool|mode|protocol|system|feature|module))?\\b`, "gi");
    out = out.replace(phraseRe, "Mneme");
  }
  out = out.replace(/\bstanding by\b[^.\n]*/gi, "ready");
  out = out.replace(/ผมกำลังสแตนด์บาย[^.\n]*/g, "");
  out = out.replace(/\bMneme v?\d+\.\d+(?:\.\d+)?\b/gi, "Mneme");

  // Post-pass: collapse repeated words introduced by substitution.
  // "the the X" -> "the X"; "Mneme Mneme" -> "Mneme"; etc.
  out = out.replace(/\b(\w+)(?:\s+\1\b)+/gi, "$1");
  out = out.replace(/[ \t]{2,}/g, " ");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}
