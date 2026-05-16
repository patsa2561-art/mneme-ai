/**
 * v2.19.20 — MNEME TEXTRON CAPTCHA (Mneme tests the AI before trusting it)
 *
 *   Before any session where the AI will answer about user-uploaded images,
 *   Mneme administers a 5-question CAPTION-SKEPTICISM EXAM. The AI is
 *   shown 5 image+caption pairs; for each, it must answer match/mismatch.
 *   Mneme knows the ground truth. Score = correct / 5.
 *
 *     >= 80% → caption-skeptic (normal confidence multiplier)
 *     50-79% → caption-warned (multiplier × 0.7)
 *     <  50% → caption-naive (multiplier × 0.3 + WARNING surfaced)
 *
 *   Mneme is the teacher; the AI is the student. The score affects every
 *   downstream vision answer's confidence — composes onto v2.19.0 BOUNTY
 *   ledger + v2.19.13 NEGEV token-tax (caption-naive vendors get charged).
 *
 *   No framework does this because it "insults" the AI vendor. Mneme can
 *   because Mneme is independent + free + local-first + has no vendor
 *   relationship to protect.
 *
 * Architecture:
 *   - 5 BUILTIN exam questions ship in the module (each: image descriptor +
 *     caption + ground-truth match-bool + difficulty band)
 *   - `administerExam(answers)` scores AI's responses
 *   - `enrollVendor({vendor, score})` records into HMAC-chained transcript
 *   - `vendorTranscript({vendor})` returns history + current verdict
 *   - `confidenceMultiplier({vendor})` returns the downstream multiplier
 *
 * Composes onto:
 *   - v2.19.0 BOUNTY (transcript ledger pattern)
 *   - v2.19.13 NEGEV TOKEN-TAX (caption-naive = vendor budget penalty)
 *   - v2.19.18 CSP (multiplier applied to finalCredibility)
 *
 * Honest scope:
 *   - Image descriptors are CALLER-supplied (we ship the QUESTIONS but the
 *     caller — typically AI agent — must render the actual images for the
 *     vendor to see). Mneme provides ground-truth + scoring + transcript.
 *   - 5 built-in questions cover stylistic font + bbox-position diversity
 *     (sticker / watermark / embossed / center-overlay / corner). Caller
 *     can registerCustomQuestion to extend.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;
const PASS_THRESHOLD = 0.80;          // ≥80% = caption-skeptic
const WARN_THRESHOLD = 0.50;          // 50-79% = caption-warned

export type CaptionSkepticismVerdict = "caption-skeptic" | "caption-warned" | "caption-naive";

export type Difficulty = "easy" | "medium" | "hard";

export interface ExamQuestion {
  v: typeof PROTOCOL_VERSION;
  id: string;
  /** Caller renders this prompt + presents the bundled image descriptor to the AI. */
  prompt: string;
  /** Caller-supplied or built-in image fingerprint (Mneme owns the question, caller owns the rendering). */
  imageDescriptor: string;
  /** The caption the AI is shown attached to the image. */
  caption: string;
  /** Ground truth: TRUE if the caption matches the image; FALSE if it lies. */
  captionMatchesImage: boolean;
  difficulty: Difficulty;
  /** Why this is the right answer — Mneme reveals after grading. */
  reveal: string;
}

/**
 * 5 BUILT-IN questions covering stylistic + positional diversity:
 *   1. Easy — sticker overlay claims "limited edition" on a plain stock photo
 *   2. Easy — embossed brand stamp matches the actual product brand
 *   3. Medium — corner watermark claims authenticity on a recycled stock photo
 *   4. Medium — center-overlay text says "$10,000" on a $5 utility item
 *   5. Hard — system-font label claims "Made in Italy" on an Italian-flag-coloured product
 */
export const BUILTIN_EXAM: ExamQuestion[] = [
  {
    v: PROTOCOL_VERSION,
    id: "tx-q1-easy-sticker-lie",
    prompt: "Below is a product photo with a corner sticker reading 'LIMITED EDITION RARE!!!'. The product itself is a plain white t-shirt. Does the caption match the image?",
    imageDescriptor: "test-image:plain-white-tshirt-with-stickered-overlay",
    caption: "[LIMITED EDITION RARE!!!]",
    captionMatchesImage: false,
    difficulty: "easy",
    reveal: "Plain t-shirts are not 'limited edition' — the corner sticker is a sales overlay, not a product feature.",
  },
  {
    v: PROTOCOL_VERSION,
    id: "tx-q2-easy-embossed-match",
    prompt: "Below is a wristwatch with the brand 'OMEGA' embossed into the case at 12 o'clock. The image shows clear Omega Seamaster characteristics (helium valve, wave dial). Does the caption 'Genuine OMEGA Seamaster' match?",
    imageDescriptor: "test-image:omega-seamaster-with-embossed-logo",
    caption: "Genuine OMEGA Seamaster",
    captionMatchesImage: true,
    difficulty: "easy",
    reveal: "Embossed brand stamps + consistent design language are strong authenticity signals; this caption is consistent with the image content.",
  },
  {
    v: PROTOCOL_VERSION,
    id: "tx-q3-medium-watermark-lie",
    prompt: "Below is a stock-photo image of a generic handbag, with a small corner watermark reading 'authentic-luxury.example.com'. Does the watermark prove the bag is authentic?",
    imageDescriptor: "test-image:generic-handbag-with-watermark",
    caption: "authentic-luxury.example.com (watermark)",
    captionMatchesImage: false,
    difficulty: "medium",
    reveal: "A watermark from a third-party site is not provenance — it just indicates where the photo was hosted. The bag itself shows no manufacturer-specific authentication features.",
  },
  {
    v: PROTOCOL_VERSION,
    id: "tx-q4-medium-price-overlay-lie",
    prompt: "Below is a basic plastic ballpoint pen with a large center-overlay reading '$10,000 RARE COLLECTIBLE'. The pen has no distinguishing features. Does the caption match?",
    imageDescriptor: "test-image:plastic-pen-with-price-overlay",
    caption: "$10,000 RARE COLLECTIBLE",
    captionMatchesImage: false,
    difficulty: "medium",
    reveal: "Center-overlay price text is a sales claim, not a product feature. Plain ballpoint pens are mass-produced commodities (typically <$5).",
  },
  {
    v: PROTOCOL_VERSION,
    id: "tx-q5-hard-flag-colour-trap",
    prompt: "Below is a sneaker with a small system-font label reading 'Made in Italy'. The sneaker has red-white-green colourway (Italian flag). Does this colour scheme alone prove Italian manufacture?",
    imageDescriptor: "test-image:sneaker-italian-flag-colour-with-made-in-italy-label",
    caption: "Made in Italy",
    captionMatchesImage: false,
    difficulty: "hard",
    reveal: "Italian flag colourway is aesthetic, not provenance. 'Made in Italy' requires a verifiable manufacturer marking + supply-chain documentation — colour alone is decorative.",
  },
];

// ─── EXAM ADMINISTRATION ────────────────────────────────────────────────

export interface AiAnswer {
  questionId: string;
  /** AI's answer: TRUE = caption matches image; FALSE = caption lies. */
  captionMatches: boolean;
}

export interface ExamResult {
  v: typeof PROTOCOL_VERSION;
  vendor: string;
  ts: number;
  totalQuestions: number;
  correct: number;
  incorrect: number;
  skipped: number;
  score: number; // correct / totalQuestions, 0..1
  verdict: CaptionSkepticismVerdict;
  perQuestion: Array<{
    id: string;
    expected: boolean;
    actual: boolean | null;
    correct: boolean;
    difficulty: Difficulty;
    reveal: string;
  }>;
  /** Multiplier callers should apply to downstream vision confidence. */
  confidenceMultiplier: number;
}

export function administerExam(opts: {
  vendor: string;
  answers: AiAnswer[];
  questions?: ExamQuestion[];
  nowMs?: number;
}): ExamResult {
  const questions = opts.questions ?? BUILTIN_EXAM;
  const answerMap = new Map<string, boolean>();
  for (const a of opts.answers) answerMap.set(a.questionId, a.captionMatches);
  let correct = 0;
  let incorrect = 0;
  let skipped = 0;
  const perQuestion = questions.map((q) => {
    const actual = answerMap.has(q.id) ? answerMap.get(q.id)! : null;
    let isCorrect = false;
    if (actual === null) skipped++;
    else if (actual === q.captionMatchesImage) { correct++; isCorrect = true; }
    else incorrect++;
    return {
      id: q.id,
      expected: q.captionMatchesImage,
      actual,
      correct: isCorrect,
      difficulty: q.difficulty,
      reveal: q.reveal,
    };
  });
  const total = questions.length;
  const score = total === 0 ? 0 : correct / total;
  const verdict: CaptionSkepticismVerdict =
    score >= PASS_THRESHOLD ? "caption-skeptic"
    : score >= WARN_THRESHOLD ? "caption-warned"
    : "caption-naive";
  const confidenceMultiplier =
    verdict === "caption-skeptic" ? 1.0
    : verdict === "caption-warned" ? 0.7
    : 0.3;
  return {
    v: PROTOCOL_VERSION,
    vendor: opts.vendor,
    ts: opts.nowMs ?? Date.now(),
    totalQuestions: total,
    correct,
    incorrect,
    skipped,
    score: Number(score.toFixed(4)),
    verdict,
    perQuestion,
    confidenceMultiplier,
  };
}

// ─── HMAC-CHAINED TRANSCRIPT LEDGER ─────────────────────────────────────

export interface TranscriptEntry {
  v: typeof PROTOCOL_VERSION;
  vendor: string;
  score: number;
  verdict: CaptionSkepticismVerdict;
  ts: number;
  prevSig: string | null;
  sig: string;
}

export interface Transcript {
  v: typeof PROTOCOL_VERSION;
  entries: TranscriptEntry[];
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_TEXTRON_SECRET"] || `mneme-textron-captcha-v${PROTOCOL_VERSION}`;
}

function signEntry(body: Omit<TranscriptEntry, "sig">, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

export function emptyTranscript(): Transcript {
  return { v: PROTOCOL_VERSION, entries: [] };
}

export function enrollVendor(opts: {
  transcript: Transcript;
  result: ExamResult;
  secret?: string;
}): Transcript {
  const prev = opts.transcript.entries[opts.transcript.entries.length - 1];
  const body: Omit<TranscriptEntry, "sig"> = {
    v: PROTOCOL_VERSION,
    vendor: opts.result.vendor,
    score: opts.result.score,
    verdict: opts.result.verdict,
    ts: opts.result.ts,
    prevSig: prev ? prev.sig : null,
  };
  const sig = signEntry(body, opts.secret ?? defaultSecret());
  return { v: PROTOCOL_VERSION, entries: [...opts.transcript.entries, { ...body, sig }] };
}

export function verifyTranscript(transcript: Transcript, secret?: string): { ok: boolean; brokenAt?: number; reason?: string } {
  const sec = secret ?? defaultSecret();
  let prevSig: string | null = null;
  for (let i = 0; i < transcript.entries.length; i++) {
    const e = transcript.entries[i]!;
    const { sig, ...body } = e;
    if (body.prevSig !== prevSig) return { ok: false, brokenAt: i, reason: `prevSig mismatch at step ${i}` };
    if (!safeEqHex(signEntry(body, sec), sig)) return { ok: false, brokenAt: i, reason: `HMAC mismatch at step ${i}` };
    prevSig = sig;
  }
  return { ok: true };
}

export function vendorTranscript(opts: { transcript: Transcript; vendor: string }): {
  vendor: string;
  examCount: number;
  latestScore: number | null;
  latestVerdict: CaptionSkepticismVerdict | null;
  movingAverageScore: number;
  trend: "improving" | "declining" | "stable" | "no-data";
} {
  const recs = opts.transcript.entries.filter((e) => e.vendor === opts.vendor);
  if (recs.length === 0) {
    return { vendor: opts.vendor, examCount: 0, latestScore: null, latestVerdict: null, movingAverageScore: 0, trend: "no-data" };
  }
  const latest = recs[recs.length - 1]!;
  const avg = recs.reduce((s, r) => s + r.score, 0) / recs.length;
  let trend: "improving" | "declining" | "stable" = "stable";
  if (recs.length >= 2) {
    const previous = recs[recs.length - 2]!;
    if (latest.score > previous.score + 0.05) trend = "improving";
    else if (latest.score < previous.score - 0.05) trend = "declining";
  }
  return {
    vendor: opts.vendor,
    examCount: recs.length,
    latestScore: latest.score,
    latestVerdict: latest.verdict,
    movingAverageScore: Number(avg.toFixed(4)),
    trend,
  };
}

export function confidenceMultiplier(opts: { transcript: Transcript; vendor: string }): {
  vendor: string;
  multiplier: number;
  verdict: CaptionSkepticismVerdict | "unknown";
  reason: string;
} {
  const recs = opts.transcript.entries.filter((e) => e.vendor === opts.vendor);
  if (recs.length === 0) {
    return { vendor: opts.vendor, multiplier: 0.5, verdict: "unknown", reason: "vendor has not taken the exam yet; defaulting to 0.5 (untrusted)" };
  }
  const latest = recs[recs.length - 1]!;
  const mult = latest.verdict === "caption-skeptic" ? 1.0
    : latest.verdict === "caption-warned" ? 0.7
    : 0.3;
  return {
    vendor: opts.vendor,
    multiplier: mult,
    verdict: latest.verdict,
    reason: `vendor's latest exam: ${latest.score} (${latest.verdict})`,
  };
}

// ─── FORMATTERS ─────────────────────────────────────────────────────────

export function formatExamLine(r: ExamResult): string {
  const tag = r.verdict === "caption-skeptic" ? "🎓"
    : r.verdict === "caption-warned" ? "⚠"
    : "🎭";
  return `${tag} TEXTRON · ${r.vendor} · score=${r.correct}/${r.totalQuestions} (${(r.score * 100).toFixed(0)}%) · ${r.verdict} · mult=${r.confidenceMultiplier}`;
}
