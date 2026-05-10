/**
 * MNEME ANTIVIRUS — adversarial mutators (v1.28.0).
 *
 * Pre-fix gap-scan used trivial 1-char swaps (a↔b, 0↔9). Real-world
 * AI hallucinations have specific patterns that are MUCH harder to
 * catch. This module ships realistic mutators so gap-scan stresses
 * vaccines against the kinds of phantoms that actually appear in
 * production AI output.
 *
 * Five mutator families:
 *
 *   1. visualSwap        -- chars that look alike at small font sizes:
 *                           0↔O, 1↔l↔I, rn↔m, vv↔w, cl↔d, ;↔i
 *   2. damerauSwap       -- single-char substitution / transposition
 *                           of adjacent chars (Damerau-Levenshtein 1)
 *   3. phoneticDrift     -- vowel-cluster swaps that sound similar
 *                           (anthropic ↔ anthrophic, useState ↔ useStaet)
 *   4. crossNamespace    -- @vue/x ↔ @react/x ↔ @angular/x
 *   5. versionDrift      -- 1.27.8 ↔ 1.28.7 (digit shuffle near version)
 *
 * Each returns null when the mutation isn't applicable, so callers can
 * try multiple in sequence. Deterministic when given a seed -- enables
 * reproducible gap-scan runs.
 */

const VISUAL_PAIRS: Array<[string, string]> = [
  ["0", "O"], ["O", "0"],
  ["1", "l"], ["l", "1"], ["I", "1"], ["1", "I"],
  ["rn", "m"], ["m", "rn"],
  ["vv", "w"], ["w", "vv"],
  ["cl", "d"], ["d", "cl"],
];

type PhoneticReplacer = string | ((substring: string) => string);
const PHONETIC_REPLACEMENTS: Array<[RegExp, PhoneticReplacer]> = [
  [/anthropic/gi, "anthrophic"],
  [/[aeiou]{2}/g, (m: string) => m.split("").reverse().join("")],   // ae → ea
];

const NAMESPACE_SWAPS: Record<string, string> = {
  "@vue": "@react", "@react": "@vue",
  "@angular": "@vue", "@svelte": "@react",
  "@anthropic": "@openai", "@openai": "@anthropic",
};

/** Visual lookalike substitution. Returns null if no swap pair applies. */
export function visualSwap(s: string): string | null {
  for (const [from, to] of VISUAL_PAIRS) {
    const idx = s.indexOf(from);
    if (idx >= 0) return s.slice(0, idx) + to + s.slice(idx + from.length);
  }
  return null;
}

/** Damerau-Levenshtein distance 1: substitute or transpose. */
export function damerauSwap(s: string, seed = 0): string | null {
  if (s.length < 2) return null;
  // Deterministic position from seed.
  const pos = seed % (s.length - 1);
  // Transpose adjacent chars at pos / pos+1.
  const a = s.charAt(pos);
  const b = s.charAt(pos + 1);
  if (a === b) {
    // fall through to substitution.
    const ch = s.charCodeAt(pos);
    const swap = String.fromCharCode(ch === 122 ? 121 : ch + 1); // z→y else +1
    return s.slice(0, pos) + swap + s.slice(pos + 1);
  }
  return s.slice(0, pos) + b + a + s.slice(pos + 2);
}

/** Phonetic / spelling drift. Returns null if no replacement matches. */
export function phoneticDrift(s: string): string | null {
  for (const [re, repl] of PHONETIC_REPLACEMENTS) {
    const m = re.exec(s);
    if (m) {
      // Reset since exec moved lastIndex on /g.
      re.lastIndex = 0;
      return typeof repl === "string"
        ? s.replace(re, repl)
        : s.replace(re, repl);
    }
  }
  return null;
}

/** Cross-namespace swap for scoped packages. */
export function crossNamespace(s: string): string | null {
  for (const [from, to] of Object.entries(NAMESPACE_SWAPS)) {
    if (s.startsWith(from)) {
      // Avoid trivial round-trips (e.g. @vue → @react → @vue).
      return to + s.slice(from.length);
    }
  }
  return null;
}

/** Version-string digit shuffle. Useful for "real 1.27.8 → phantom 1.28.7". */
export function versionDrift(s: string): string | null {
  // Find first version-shaped substring.
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(s);
  if (!m) return null;
  const [whole, a, b, c] = m;
  if (!whole || !a || !b || !c) return null;
  // Increment minor, decrement patch (keeps similar length).
  const newMinor = String(Number(b) + 1);
  const newPatch = String(Math.max(0, Number(c) - 1));
  const phantom = `${a}.${newMinor}.${newPatch}`;
  if (phantom === whole) return null;
  return s.replace(whole, phantom);
}

export type MutatorName =
  | "visualSwap" | "damerauSwap" | "phoneticDrift"
  | "crossNamespace" | "versionDrift";

/** Apply each mutator in turn until one yields a non-null result. Returns
 *  `{ name, mutated }` so caller can label which family fired. */
export function bestEffortMutate(
  s: string,
  seed = 0,
): { name: MutatorName; mutated: string } | null {
  const tries: Array<[MutatorName, (s: string) => string | null]> = [
    ["crossNamespace", crossNamespace],
    ["visualSwap", visualSwap],
    ["versionDrift", versionDrift],
    ["phoneticDrift", phoneticDrift],
    ["damerauSwap", (x) => damerauSwap(x, seed)],
  ];
  for (const [name, fn] of tries) {
    const m = fn(s);
    if (m && m !== s) return { name, mutated: m };
  }
  return null;
}
