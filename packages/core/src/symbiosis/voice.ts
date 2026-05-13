/**
 * v2.4.0 -- SYMBIOSIS · VOICE TUNER.
 *
 * Every AI has a personality. Claude is hedgy and verbose; GPT is
 * confident and concise; Gemini likes structured lists; Cursor wants
 * compact code-block-heavy answers. When Mneme writes content that
 * an AI will read (a soul prompt, a pulse banner, a tool description),
 * it should match the receiver's voice. Otherwise the AI re-formats
 * the input on the fly and burns tokens + drifts meaning.
 *
 * VOICE PROFILE — five axes per vendor:
 *   verbosity      0..1   how dense to write (low = punchy; high = wordy)
 *   hedging        0..1   density of "may / might / depending on" qualifiers
 *   codeRatio      0..1   share of output that should be code blocks vs prose
 *   structureBias  0..1   bullet-list / table preference (low = paragraphs)
 *   formalityBias  0..1   tone register (low = casual; high = formal)
 *
 * Source of profiles: empirical observation across our own AGENT
 * COMMAND MANIFEST + per-vendor pulse template logs (v1.42). Profiles
 * can be overridden by .mneme/symbiosis-voice.json — same shape.
 */

export interface VoiceProfile {
  vendor: string;
  /** 0..1 — preferred output density. */
  verbosity: number;
  /** 0..1 — density of qualifier words. */
  hedging: number;
  /** 0..1 — share of output as code blocks. */
  codeRatio: number;
  /** 0..1 — bullet-list / table bias. */
  structureBias: number;
  /** 0..1 — tone register. */
  formalityBias: number;
}

export const VOICE_CLAUDE: VoiceProfile = {
  vendor: "claude",
  verbosity: 0.65,
  hedging: 0.55,
  codeRatio: 0.35,
  structureBias: 0.55,
  formalityBias: 0.55,
};

export const VOICE_GPT: VoiceProfile = {
  vendor: "gpt",
  verbosity: 0.45,
  hedging: 0.30,
  codeRatio: 0.40,
  structureBias: 0.65,
  formalityBias: 0.45,
};

export const VOICE_GEMINI: VoiceProfile = {
  vendor: "gemini",
  verbosity: 0.40,
  hedging: 0.25,
  codeRatio: 0.30,
  structureBias: 0.80,
  formalityBias: 0.50,
};

export const VOICE_CURSOR: VoiceProfile = {
  vendor: "cursor",
  verbosity: 0.25,
  hedging: 0.15,
  codeRatio: 0.70,
  structureBias: 0.50,
  formalityBias: 0.30,
};

export const VOICE_CODEX: VoiceProfile = {
  vendor: "codex",
  verbosity: 0.25,
  hedging: 0.15,
  codeRatio: 0.75,
  structureBias: 0.45,
  formalityBias: 0.30,
};

export const VOICE_GENERIC: VoiceProfile = {
  vendor: "generic",
  verbosity: 0.50,
  hedging: 0.35,
  codeRatio: 0.40,
  structureBias: 0.55,
  formalityBias: 0.45,
};

export const BUILTIN_VOICES: VoiceProfile[] = [
  VOICE_CLAUDE,
  VOICE_GPT,
  VOICE_GEMINI,
  VOICE_CURSOR,
  VOICE_CODEX,
  VOICE_GENERIC,
];

export function voiceForVendor(vendor: string): VoiceProfile {
  const v = vendor.toLowerCase();
  if (v.includes("claude") || v.includes("anthropic")) return VOICE_CLAUDE;
  if (v.includes("gpt") || v.includes("openai") || v.includes("chatgpt")) return VOICE_GPT;
  if (v.includes("gemini") || v.includes("google")) return VOICE_GEMINI;
  if (v.includes("cursor")) return VOICE_CURSOR;
  if (v.includes("codex")) return VOICE_CODEX;
  return VOICE_GENERIC;
}

/** A short, AI-readable directive that primes the receiver to write
 *  in the requested voice. Drops into a soul prompt or system prompt. */
export function renderVoiceDirective(profile: VoiceProfile): string {
  const verbosityHint =
    profile.verbosity < 0.35 ? "Be terse" :
    profile.verbosity < 0.6  ? "Be concise" :
    "You may be detailed";
  const hedgeHint =
    profile.hedging < 0.25 ? "speak confidently, avoid 'may/might' filler" :
    profile.hedging < 0.5  ? "qualify only when uncertain" :
    "qualify claims you cannot verify";
  const codeHint =
    profile.codeRatio < 0.30 ? "prose-first; code only when needed" :
    profile.codeRatio < 0.6  ? "mix prose and code" :
    "code-first; minimal prose";
  const structureHint =
    profile.structureBias < 0.4 ? "paragraphs over bullets" :
    profile.structureBias < 0.7 ? "bullets when listing 3+ items" :
    "structured lists by default";
  return `[VOICE for ${profile.vendor}] ${verbosityHint}; ${hedgeHint}; ${codeHint}; ${structureHint}.`;
}

/** Compose a numeric "voice distance" between two profiles 0..1.
 *  Used by the success ledger to decide whether a prompt that worked
 *  for one vendor is likely to work for another. */
export function voiceDistance(a: VoiceProfile, b: VoiceProfile): number {
  const dims: Array<keyof VoiceProfile> = ["verbosity", "hedging", "codeRatio", "structureBias", "formalityBias"];
  let sumSq = 0;
  for (const d of dims) {
    const da = (a[d] as number) - (b[d] as number);
    sumSq += da * da;
  }
  return Math.min(1, Math.sqrt(sumSq / dims.length));
}
