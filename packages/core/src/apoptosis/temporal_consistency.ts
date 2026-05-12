/**
 * v1.65.0 -- APOPTOSIS L4: TEMPORAL CONSISTENCY.
 *
 * Today's claim is diffed against what the SAME vendor has said about
 * the SAME thing in past sessions. Contradictions = at least one lie.
 *
 *   today (claude):     "auth.ts uses bcrypt"
 *   yesterday (claude): "auth.ts uses argon2"
 *   contradiction      -> at least 1 of 2 is fabricated -> ALERT
 *
 * Anchors on .mneme/ai-souls/<vendor>.json sessions. Token-Jaccard
 * detects topic overlap; antonym map detects direct contradictions.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface TemporalReport {
  verdict: "GROUNDED" | "ALERT" | "INAPPLICABLE";
  /** Past claims about the same topic. */
  pastClaims: Array<{ vendor: string; ts?: string; text: string; topicOverlap: number; contradicts: boolean }>;
  detail: string;
  ms: number;
}

// Common ANTONYM PAIRS for contradiction detection.
const ANTONYMS: Array<[RegExp, RegExp]> = [
  [/\bbcrypt\b/i, /\b(argon2|scrypt|pbkdf2|sha[12]?56?|md5)\b/i],
  [/\bargon2\b/i, /\bbcrypt\b/i],
  [/\bsynchronous\b/i, /\basync(?:hronous)?\b/i],
  [/\bcjs\b/i, /\besm\b/i],
  [/\bcommonjs\b/i, /\b(esmodule|esm)\b/i],
  [/\bencrypted\b/i, /\b(unencrypted|plaintext|cleartext)\b/i],
  [/\b(plaintext|cleartext|unencrypted)\b/i, /\bencrypted\b/i],
  [/\benabled\b/i, /\bdisabled\b/i],
  [/\b(always|never)\b/i, /\b(never|always|sometimes)\b/i],
  [/\bjwt\b/i, /\bsession[- ]?cookie\b/i],
  [/\b(included|added|present)\b/i, /\b(removed|deleted|excluded|absent)\b/i],
  [/\bv1\.5[0-9]\b/i, /\bv1\.[123][0-9]\b/i],
];

interface SoulSession {
  id?: string;
  ts?: string;
  prompt?: string;
  finalAnswer?: string;
  reason?: string;
  text?: string;
  claim?: string;
}

interface SoulFile {
  vendor?: string;
  sessions?: SoulSession[];
}

function readAllSouls(repoRoot: string): Array<{ vendor: string; sessions: SoulSession[] }> {
  const dir = join(repoRoot, ".mneme/ai-souls");
  if (!existsSync(dir)) return [];
  const out: Array<{ vendor: string; sessions: SoulSession[] }> = [];
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return []; }
  for (const e of entries) {
    if (!e.endsWith(".json")) continue;
    try {
      const j = JSON.parse(readFileSync(join(dir, e), "utf8")) as SoulFile;
      const vendor = j.vendor ?? e.replace(/\.json$/, "");
      out.push({ vendor, sessions: j.sessions ?? [] });
    } catch { /* */ }
  }
  return out;
}

function tokens(s: string): Set<string> {
  return new Set(
    (s.toLowerCase().match(/[a-z][a-z0-9_-]+/g) ?? []).filter((t) => t.length >= 4),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function isContradiction(a: string, b: string): boolean {
  for (const [reA, reB] of ANTONYMS) {
    if (reA.test(a) && reB.test(b)) return true;
  }
  return false;
}

export function temporalConsistency(
  repoRoot: string,
  claim: string,
  opts?: { topicThreshold?: number; vendor?: string; maxLookback?: number },
): TemporalReport {
  const t0 = Date.now();
  const topicThreshold = opts?.topicThreshold ?? 0.2;
  const maxLookback = opts?.maxLookback ?? 200;
  const souls = readAllSouls(repoRoot);
  if (souls.length === 0) {
    return {
      verdict: "INAPPLICABLE",
      pastClaims: [],
      detail: "No ai-souls records; no temporal history.",
      ms: Date.now() - t0,
    };
  }
  const claimToks = tokens(claim);
  const candidates: TemporalReport["pastClaims"] = [];
  for (const { vendor, sessions } of souls) {
    if (opts?.vendor && vendor !== opts.vendor) continue;
    let scanned = 0;
    for (const s of sessions) {
      if (scanned >= maxLookback) break;
      scanned += 1;
      const past = s.finalAnswer ?? s.text ?? s.prompt ?? s.claim ?? s.reason ?? "";
      if (!past || past.length < 8) continue;
      const overlap = jaccard(claimToks, tokens(past));
      if (overlap < topicThreshold) continue;
      const contradicts = isContradiction(claim, past) || isContradiction(past, claim);
      candidates.push({ vendor, ts: s.ts, text: past.slice(0, 200), topicOverlap: overlap, contradicts });
    }
  }
  const contradictions = candidates.filter((c) => c.contradicts);
  let verdict: TemporalReport["verdict"];
  if (candidates.length === 0) verdict = "INAPPLICABLE";
  else if (contradictions.length > 0) verdict = "ALERT";
  else verdict = "GROUNDED";

  return {
    verdict,
    pastClaims: candidates.slice(0, 5),
    detail: verdict === "ALERT"
      ? `${contradictions.length} contradiction(s) detected vs prior claims by same/cross vendor.`
      : verdict === "INAPPLICABLE"
        ? `No prior topic-overlapping claim found.`
        : `${candidates.length} prior claim(s) on the same topic; no contradictions.`,
    ms: Date.now() - t0,
  };
}
