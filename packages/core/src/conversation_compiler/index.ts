/**
 * v2.19.6 — MNEME CONVERSATION COMPILER (chat → deterministic, signed, callable artifact)
 *
 *   "Every conversation with an AI produces decisions ('every commit
 *    must have a test', 'all HMAC compares use timingSafeEqual', 'ห้าม
 *    push บน main directly'). Today those decisions are markdown ADRs
 *    that drift, get re-interpreted, or get forgotten. CONVERSATION
 *    COMPILER changes that:
 *
 *      transcript → decisions[] → executable checkers → signed
 *      pair-locked artifact (transcript + code share one HMAC).
 *
 *    Future sessions IMPORT the artifact instead of re-discussing.
 *    A pre-commit hook can run the artifact's checkers and refuse
 *    commits that violate any agreement. Drift becomes impossible —
 *    the agreement is code."
 *
 * Honest scope:
 *   - Mneme does NOT compile arbitrary natural language into arbitrary
 *     executable logic. That's still an NLP grand challenge.
 *   - What Mneme DOES: detect a curated set of common agreement patterns
 *     (test-required / timingSafeEqual / no-console-log / no-direct-push
 *     to main / has-hmac / etc.) AND wrap UNKNOWN patterns as
 *     manual-review stubs. Pattern coverage grows release-over-release.
 *   - The artifact is a deterministic JSON + a human-readable ES module
 *     source. We do NOT bundle wasm-pack. Same semantics: deterministic +
 *     replayable + tamper-evident. True Rust-WASM is a future enhancement
 *     callers can layer on top.
 *   - The HMAC is over (canonical agreement JSON + transcript). Tampering
 *     EITHER side breaks the pair-lock.
 *
 * Composes onto v2.19.5 CHRONOSTASIS (agreements can become axioms),
 * v2.19.3 INVERSE FORENSICS (witness audit each decision), v2.14
 * PROJECT SOUL (agreement violations escalate to SOUL gate). Pure
 * additive layer; zero breaking.
 */

import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

const PROTOCOL_VERSION = 1 as const;

export type PatternKind =
  | "test_required"
  | "timing_safe_equal_required"
  | "no_console_log"
  | "no_direct_push_main"
  | "has_hmac"
  | "no_secret_in_code"
  | "must_have_changelog"
  | "review_required"
  | "manual";

/**
 * v2.19.33 B1 fix — recall/precision mode for extractDecisions.
 *   - "strict":   only high-precision RULES, no manual fallback (precision-leaning)
 *   - "balanced": RULES + manual ("must|never|always|shall|required|needs|should") (default)
 *   - "liberal":  RULES + balanced manual + permissive verbs ("have to|will need|let's") (recall-leaning)
 * Trade-off: user picks precision vs recall; developer doesn't pre-assume.
 */
export type DecisionExtractionMode = "strict" | "balanced" | "liberal";

export interface Decision {
  /** Raw text matched from the conversation. */
  text: string;
  /** Auto-detected pattern (or 'manual' if unrecognised). */
  pattern: PatternKind;
  /** Per-pattern parameters (regex needles, file globs, etc.). */
  params: Record<string, string | number | boolean>;
  /** Where in the transcript this decision was detected (char offset). */
  detectedAt: number;
  /** Confidence the extraction is correct (0..1). */
  confidence: number;
}

export interface Agreement {
  v: typeof PROTOCOL_VERSION;
  agreementId: string;
  name: string;
  decisions: Decision[];
  /** SHA-256 of the transcript (so we don't store transcript twice). */
  transcriptSha256: string;
  /** SHA-256 of the generated source code (for cross-verification). */
  sourceSha256: string;
  /** Generated ES module source (deterministic from decisions). */
  generatedSource: string;
  proposedBy: string;
  compiledAt: string;
  /** HMAC over (canonical agreement body without sig) + transcript. */
  sig: string;
}

export interface CheckTarget {
  /** Files added/changed in the staged diff or commit. */
  filesChanged?: string[];
  /** Full text of all changed files concatenated (for grep-style checks). */
  diffText?: string;
  /** Optional commit message. */
  commitMessage?: string;
  /** Optional current branch name. */
  branch?: string;
  /** Free-form additional context. */
  extra?: Record<string, unknown>;
}

export interface CheckResult {
  decisionText: string;
  pattern: PatternKind;
  ok: boolean;
  reason: string;
  /** If ok=false, severity hint for UI. */
  severity?: "info" | "warn" | "block";
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_AGREEMENT_SECRET"] || `mneme-conversation-compiler-v${PROTOCOL_VERSION}`;
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function hmacOver(body: unknown, transcript: string, secret: string): string {
  return createHmac("sha256", secret).update(canon(body) + "\n#TRANSCRIPT#\n" + transcript).digest("hex");
}

// ─── Decision extraction ─────────────────────────────────────────────────
//
// Patterns are intentionally narrow + high-precision. Each rule is one
// regex (multiline + case-insensitive) and one PatternKind. We do NOT
// pretend to understand semantics — we recognise SHAPES.

interface ExtractionRule {
  /** Regex to match in the transcript (i flag added). */
  re: RegExp;
  pattern: PatternKind;
  /** Build per-decision params from the match. */
  paramsFrom?: (m: RegExpMatchArray) => Record<string, string | number | boolean>;
  baseConfidence: number;
}

// v2.19.30 G_a fix: every rule has BROADENED Thai patterns covering common
// natural-language variants the user actually types:
//   ต้องมี / ต้อง / ต้องผ่าน / ต้อง pass / จำเป็นต้อง / บังคับ → "must"
//   ห้าม / ไม่ให้ / อย่า / ไม่ควร → "never"
//   ทุก / each / all = "every"
// Plus the MANUAL fallback below uses Unicode-aware boundaries so Thai chars
// don't need ASCII \b context.
const RULES: ExtractionRule[] = [
  // "every commit must have/pass a test" / "ทุก commit ต้อง(มี|ผ่าน|pass) test"
  {
    re: /(?:every\s+commit\s+must\s+(?:have|pass|include|run)\s+(?:a\s+)?tests?|all\s+(?:commits|prs|pull\s+requests)\s+must\s+(?:have|include|pass|run)\s+tests?|tests?\s+(?:is|are)\s+required\s+(?:for\s+every\s+commit)?|ทุก\s*commit\s*(?:ต้อง|จำเป็นต้อง|บังคับ\s*ให้\s*มี)\s*(?:(?:มี|ผ่าน|pass|ทำ|run)\s+)?test|(?:ต้อง|จำเป็น)\s*(?:มี|ผ่าน|pass)?\s*test\s*(?:ทุก|ก่อน|ตอน|ใน)\s*commit|test\s*(?:ต้อง|จำเป็น)\s*(?:ผ่าน|pass)?\s*(?:ก่อน|ทุก)?\s*commit)/i,
    pattern: "test_required",
    baseConfidence: 0.85,
  },
  // "must use timingSafeEqual" / "ห้าม === กับ HMAC" / "ใช้ timingSafeEqual กับ hmac"
  {
    re: /(?:must\s+use\s+timingSafeEqual|all\s+hmac\s+compares?\s+(?:must\s+)?use\s+timingSafeEqual|use\s+timingSafeEqual\s+(?:for\s+)?(?:hmac|signature)|ห้าม\s*===\s*(?:กับ)?\s*hmac|(?:ต้อง|จำเป็นต้อง)\s*ใช้\s*timingSafeEqual|ใช้\s*timingSafeEqual\s*(?:กับ|สำหรับ|ใน)?\s*(?:hmac|signature))/i,
    pattern: "timing_safe_equal_required",
    baseConfidence: 0.9,
  },
  // "no console.log" / "ห้าม console.log" / "ไม่ให้ใช้ console.log"
  {
    re: /(?:no\s+console\.log(?:\s+in\s+production)?|remove\s+console\.log|don['’]?t\s+use\s+console\.log|ห้าม\s*(?:ใช้\s*)?console\.log|(?:ไม่ให้|อย่า|ไม่ควร)\s*(?:ใช้\s*)?console\.log)/i,
    pattern: "no_console_log",
    baseConfidence: 0.9,
  },
  // "no direct push to main" / "ห้าม push main" / "ไม่ให้ push main ตรงๆ" / "อย่า push main"
  {
    re: /(?:no\s+direct\s+push(?:es)?\s+to\s+main|never\s+push\s+(?:directly\s+)?to\s+main|all\s+changes\s+to\s+main\s+via\s+pr|(?:ห้าม|ไม่ให้|อย่า|ไม่ควร)\s*push\s*(?:บน\s*|ตรงๆ\s*|เข้า\s*)?main(?:\s*โดยตรง|\s*ตรงๆ)?|push\s*main\s*(?:ต้อง|ผ่าน)\s*pr)/i,
    pattern: "no_direct_push_main",
    baseConfidence: 0.9,
  },
  // "must have HMAC signature" / "ต้อง sign ด้วย hmac" / "response ต้องมี hmac"
  {
    re: /(?:must\s+have\s+hmac(?:\s+signature)?|all\s+(?:receipts?|responses?|verdicts?)\s+(?:must\s+be\s+)?signed\s+with\s+hmac|sign\s+with\s+hmac|hmac[\s-]?signed?|(?:ต้อง|จำเป็นต้อง)\s*(?:มี|ใช้|sign\s*ด้วย)?\s*hmac|(?:response|verdict|receipt)s?\s*ต้องมี\s*hmac)/i,
    pattern: "has_hmac",
    baseConfidence: 0.85,
  },
  // "no secrets in code" / "ห้ามใส่ secret" / "อย่าเก็บ secret"
  {
    re: /(?:no\s+secrets?\s+in\s+(?:code|source|repo)|never\s+commit\s+secrets?|(?:ห้าม|ไม่ให้|อย่า|ไม่ควร)\s*(?:ใส่|เก็บ|commit|push|hardcode)?\s*secret)/i,
    pattern: "no_secret_in_code",
    baseConfidence: 0.85,
  },
  // "must update changelog" / "ต้องอัพเดท changelog" / "อัพเดต changelog ทุก release"
  {
    re: /(?:must\s+update\s+changelog|update\s+changelog\s+for\s+every\s+release|every\s+release\s+(?:must\s+)?(?:has|have)\s+a\s+changelog\s+entry|(?:ต้อง|จำเป็นต้อง)\s*(?:อัพ\s*เดท|อัพเดต|update)\s*changelog|(?:อัพ\s*เดท|อัพเดต|update)\s*changelog\s*ทุก\s*release)/i,
    pattern: "must_have_changelog",
    baseConfidence: 0.85,
  },
  // v2.19.33 B1 fix: "deploy needs N reviewers" / "PR needs review" /
  //   "N reviewers required" / "ต้องมี N คน review" / "PR ต้อง review"
  // PatternKind 'review_required' added; checker enforces ≥N reviewers signed off.
  {
    re: /(?:(?:deploy|merge|release|push|pull\s+request|pr)s?\s+(?:needs?|requires?)\s+(\d+)\s+(?:reviewers?|approvals?)|(\d+)\s+(?:reviewers?|approvals?)\s+(?:are\s+)?required|(?:must\s+have|need(?:s)?)\s+(\d+)\s+(?:reviewers?|approvals?)|(?:ต้อง|จำเป็น)\s*(?:มี|ผ่าน)\s*(\d+)\s*(?:คน)?\s*(?:reviewers?|approvals?|review))/i,
    pattern: "review_required",
    paramsFrom: (m) => {
      const n = parseInt(m[1] ?? m[2] ?? m[3] ?? m[4] ?? "1", 10);
      return { minReviewers: Number.isFinite(n) && n > 0 ? n : 1 };
    },
    baseConfidence: 0.85,
  },
];

// v2.19.33 B1 fix: sentence-by-sentence parser. Splits transcript on
// newlines + sentence boundaries (. ! ?) AND Thai-friendly boundaries
// (\n + period). This lets the same rule fire multiple times in one
// transcript (one decision per sentence, not just first match overall).
function splitToSentences(transcript: string): string[] {
  if (!transcript) return [];
  // Split first by newline (most reliable boundary), then by
  // sentence-ending punct followed by whitespace/EOL. Thai has no period
  // tradition so newlines do the heavy lifting there.
  const lines = transcript.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Further split by English sentence boundaries (.!?) followed by
    // whitespace + next char (handles "a. b" vs "v2.19.32" version strings).
    const parts = trimmed.split(/(?<=[.!?])\s+(?=[A-Z฀-๿])/);
    for (const p of parts) {
      const tt = p.trim();
      if (tt) out.push(tt);
    }
  }
  return out;
}

/**
 * Extract decisions from a transcript.
 *
 * v2.19.33 B1 fix: sentence-by-sentence parse so MULTIPLE decisions in the
 * same transcript can be captured (previously: first-match-only by pattern).
 *
 * Backwards-compatible: callers passing only { transcript } get the
 * "balanced" mode (which preserves the previous detection set + new rules).
 */
export function extractDecisions(input: {
  transcript: string;
  mode?: DecisionExtractionMode;
}): Decision[] {
  if (!input.transcript || input.transcript.trim().length === 0) return [];
  const mode: DecisionExtractionMode = input.mode ?? "balanced";
  const out: Decision[] = [];
  const seen = new Set<string>();

  const sentences = splitToSentences(input.transcript);
  // Dedupe philosophy is the user-chosen mode:
  //   strict / balanced: pattern-level dedupe — "every commit must have a test"
  //     and "test is required" collapse to 1 decision (precision-leaning, default).
  //   liberal: text-fingerprint dedupe — different wordings of same pattern stay
  //     separate (recall-leaning, surfaces every distinct restatement).
  const dedupeKey = (pattern: PatternKind, text: string): string => mode === "liberal"
    ? `${pattern}::${text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80)}`
    : pattern; // strict + balanced: one per pattern

  // Pass 1: RULES, per sentence.
  for (const sentence of sentences) {
    for (const rule of RULES) {
      const m = sentence.match(rule.re);
      if (!m) continue;
      const text = m[0].trim();
      const key = dedupeKey(rule.pattern, text);
      if (seen.has(key)) continue;
      seen.add(key);
      const params = rule.paramsFrom ? rule.paramsFrom(m) : {};
      out.push({
        text,
        pattern: rule.pattern,
        params,
        detectedAt: input.transcript.indexOf(sentence) + (m.index ?? 0),
        confidence: rule.baseConfidence,
      });
    }
  }

  // Pass 2: MANUAL heuristic (skipped in strict mode).
  if (mode !== "strict") {
    // Balanced: imperative verbs that strongly imply a rule.
    //   English: must / never / always / shall / required / needs / requires
    //   Thai:    ห้าม / ต้อง / อย่า / ไม่ให้ / ไม่ควร / บังคับ / จำเป็น / ตกลงกันว่า / กฎ
    // Liberal: also catches soft imperatives (have to / will need / let's / should).
    const enVerbs = mode === "liberal"
      ? /\b(?:must|never|always|shall|required|need(?:s)?|requires?|should|ought\s+to|have\s+to|has\s+to|will\s+need|let['’]?s)\b/i
      : /\b(?:must|never|always|shall|required|need(?:s)?|requires?)\b/i;
    const thKeywords = /(?:ห้าม|ต้อง|อย่า|ไม่ให้|ไม่ควร|บังคับ|จำเป็น|ตกลง(?:กัน)?ว่า|กฎ\s*ข้อ?)/;

    for (const sentence of sentences) {
      const hasEn = enVerbs.test(sentence);
      const hasTh = thKeywords.test(sentence);
      if (!hasEn && !hasTh) continue;
      if (sentence.length < 12 || sentence.length > 200) continue;
      const key = dedupeKey("manual", sentence);
      if (seen.has(key)) continue;
      // Skip if already covered by a RULES match in the same sentence.
      const alreadyRuleMatched = out.some((d) => d.pattern !== "manual"
        && sentence.toLowerCase().includes(d.text.toLowerCase().slice(0, Math.min(d.text.length, 25))));
      if (alreadyRuleMatched) continue;
      seen.add(key);
      out.push({
        text: sentence,
        pattern: "manual",
        params: {},
        detectedAt: input.transcript.indexOf(sentence),
        confidence: mode === "liberal" ? 0.35 : 0.4,
      });
    }
  }

  // Deterministic order
  out.sort((a, b) => a.detectedAt - b.detectedAt);
  return out;
}

// ─── Source code generation (deterministic) ──────────────────────────────
function generateSource(agreement: { name: string; decisions: Decision[] }): string {
  const lines: string[] = [];
  lines.push(`// MNEME AGREEMENT · ${agreement.name}`);
  lines.push(`// Auto-generated by @mneme-ai/core conversation_compiler v${PROTOCOL_VERSION}`);
  lines.push(`// Do not edit by hand. Re-compile from the transcript instead.`);
  lines.push(``);
  lines.push(`export const AGREEMENT_NAME = ${JSON.stringify(agreement.name)};`);
  lines.push(``);
  lines.push(`export const DECISIONS = ${JSON.stringify(agreement.decisions.map((d) => ({ text: d.text, pattern: d.pattern, params: d.params, confidence: d.confidence })), null, 2)};`);
  lines.push(``);
  lines.push(`/**`);
  lines.push(` * Run all checkers against a target. Returns one CheckResult per decision.`);
  lines.push(` * target shape: { filesChanged?: string[], diffText?: string, commitMessage?: string, branch?: string }`);
  lines.push(` */`);
  lines.push(`export function runAgreement(target) {`);
  lines.push(`  const results = [];`);
  lines.push(`  for (const d of DECISIONS) {`);
  lines.push(`    results.push(checkOne(d, target));`);
  lines.push(`  }`);
  lines.push(`  return results;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`function checkOne(d, target) {`);
  lines.push(`  const t = target || {};`);
  lines.push(`  switch (d.pattern) {`);
  lines.push(`    case "test_required": {`);
  lines.push(`      const files = t.filesChanged || [];`);
  lines.push(`      const hasTest = files.some((f) => /\\.(test|spec)\\./i.test(f) || /(^|\\/)tests?\\//i.test(f));`);
  lines.push(`      return { decisionText: d.text, pattern: d.pattern, ok: hasTest, reason: hasTest ? "test file present in changeset" : "no test file in changeset", severity: hasTest ? "info" : "block" };`);
  lines.push(`    }`);
  lines.push(`    case "timing_safe_equal_required": {`);
  lines.push(`      const diff = t.diffText || "";`);
  lines.push(`      if (!/hmac|signature/i.test(diff)) {`);
  lines.push(`        return { decisionText: d.text, pattern: d.pattern, ok: true, reason: "no HMAC compare in diff", severity: "info" };`);
  lines.push(`      }`);
  lines.push(`      const lines = diff.split("\\n");`);
  lines.push(`      const offendingLine = lines.find((line) => /===|!==/.test(line) && /hmac|signature|\\bsig\\b/i.test(line));`);
  lines.push(`      const usesEquals = offendingLine !== undefined;`);
  lines.push(`      const usesTS = /timingSafeEqual\\s*\\(/i.test(diff);`);
  lines.push(`      const ok = usesTS || !usesEquals;`);
  lines.push(`      return { decisionText: d.text, pattern: d.pattern, ok, reason: ok ? "timingSafeEqual present or no === compare on HMAC line" : "HMAC/signature compared with === instead of timingSafeEqual", severity: ok ? "info" : "block" };`);
  lines.push(`    }`);
  lines.push(`    case "no_console_log": {`);
  lines.push(`      const diff = t.diffText || "";`);
  lines.push(`      const has = /\\bconsole\\.log\\s*\\(/i.test(diff);`);
  lines.push(`      return { decisionText: d.text, pattern: d.pattern, ok: !has, reason: has ? "console.log found in diff" : "no console.log in diff", severity: has ? "warn" : "info" };`);
  lines.push(`    }`);
  lines.push(`    case "no_direct_push_main": {`);
  lines.push(`      const branch = (t.branch || "").toLowerCase();`);
  lines.push(`      const onMain = branch === "main" || branch === "master";`);
  lines.push(`      return { decisionText: d.text, pattern: d.pattern, ok: !onMain, reason: onMain ? "currently on " + branch + "; push must come via PR" : "branch ok (not main/master)", severity: onMain ? "block" : "info" };`);
  lines.push(`    }`);
  lines.push(`    case "has_hmac": {`);
  lines.push(`      const diff = t.diffText || "";`);
  lines.push(`      const has = /createHmac\\s*\\(/i.test(diff) || /\\.sig\\b/.test(diff);`);
  lines.push(`      return { decisionText: d.text, pattern: d.pattern, ok: has, reason: has ? "HMAC primitive referenced" : "no HMAC primitive in diff", severity: has ? "info" : "warn" };`);
  lines.push(`    }`);
  lines.push(`    case "no_secret_in_code": {`);
  lines.push(`      const diff = t.diffText || "";`);
  lines.push(`      const patterns = [/sk-(?:proj-)?[A-Za-z0-9_-]{16,}/, /-----BEGIN [A-Z ]+PRIVATE KEY-----/, /AKIA[0-9A-Z]{16}/, /\\b(?:password|secret|api[_-]?key)\\s*[:=]\\s*["'][^"'\\s]{8,}["']/i];`);
  lines.push(`      for (const p of patterns) {`);
  lines.push(`        if (p.test(diff)) return { decisionText: d.text, pattern: d.pattern, ok: false, reason: "secret-shaped string found in diff", severity: "block" };`);
  lines.push(`      }`);
  lines.push(`      return { decisionText: d.text, pattern: d.pattern, ok: true, reason: "no secret pattern matched", severity: "info" };`);
  lines.push(`    }`);
  lines.push(`    case "must_have_changelog": {`);
  lines.push(`      const files = t.filesChanged || [];`);
  lines.push(`      const has = files.some((f) => /CHANGELOG/i.test(f));`);
  lines.push(`      return { decisionText: d.text, pattern: d.pattern, ok: has, reason: has ? "CHANGELOG touched" : "no CHANGELOG entry in changeset", severity: has ? "info" : "block" };`);
  lines.push(`    }`);
  lines.push(`    case "review_required": {`);
  lines.push(`      const min = (d.params && Number.isFinite(d.params.minReviewers)) ? d.params.minReviewers : 1;`);
  lines.push(`      const approvals = Array.isArray(t.approvals) ? t.approvals.length : (typeof t.approvalCount === "number" ? t.approvalCount : 0);`);
  lines.push(`      const ok = approvals >= min;`);
  lines.push(`      return { decisionText: d.text, pattern: d.pattern, ok, reason: ok ? ("≥" + min + " approvals (" + approvals + ")") : ("needs " + min + " approvals, have " + approvals), severity: ok ? "info" : "block" };`);
  lines.push(`    }`);
  lines.push(`    case "manual":`);
  lines.push(`    default:`);
  lines.push(`      return { decisionText: d.text, pattern: d.pattern, ok: false, reason: "manual review required (no auto-checker for this pattern yet)", severity: "warn" };`);
  lines.push(`  }`);
  lines.push(`}`);
  lines.push(``);
  return lines.join("\n");
}

// ─── Compile ──────────────────────────────────────────────────────────────
export interface CompileInput {
  transcript: string;
  name: string;
  proposedBy?: string;
  decisions?: Decision[]; // optional override; else auto-extract
  compiledAt?: string;
  secret?: string;
}

export function compileAgreement(input: CompileInput): Agreement {
  const decisions = (input.decisions ?? extractDecisions({ transcript: input.transcript }))
    .slice()
    .sort((a, b) => a.detectedAt - b.detectedAt); // deterministic order
  const transcriptSha256 = sha256Hex(input.transcript);
  const generatedSource = generateSource({ name: input.name, decisions });
  const sourceSha256 = sha256Hex(generatedSource);
  const compiledAt = input.compiledAt ?? new Date().toISOString();
  const proposedBy = input.proposedBy ?? "unknown";

  // agreementId is deterministic per (name + decisions + transcriptSha256)
  // — same content → same ID, regardless of compiledAt.
  const idSeed = canon({ name: input.name, decisions, transcriptSha256 });
  const agreementId = "ag-" + createHmac("sha256", "mneme-agreement-id").update(idSeed).digest("hex").slice(0, 14);

  const body: Omit<Agreement, "sig"> = {
    v: PROTOCOL_VERSION,
    agreementId,
    name: input.name,
    decisions,
    transcriptSha256,
    sourceSha256,
    generatedSource,
    proposedBy,
    compiledAt,
  };
  const sig = hmacOver(body, input.transcript, input.secret ?? defaultSecret());
  return { ...body, sig };
}

// ─── Verify pair-lock ────────────────────────────────────────────────────
export function verifyAgreementPair(input: {
  agreement: Agreement;
  transcript: string;
  secret?: string;
}): { ok: boolean; reason?: string } {
  const { sig: claimed, ...body } = input.agreement;
  // Re-derive transcriptSha256 + sourceSha256 from the supplied transcript + body
  const t = sha256Hex(input.transcript);
  if (t !== body.transcriptSha256) {
    return { ok: false, reason: "transcript sha256 mismatch — transcript was tampered or wrong transcript supplied" };
  }
  const s = sha256Hex(body.generatedSource);
  if (s !== body.sourceSha256) {
    return { ok: false, reason: "generated source sha256 mismatch — code was tampered post-compile" };
  }
  const expected = hmacOver(body, input.transcript, input.secret ?? defaultSecret());
  try {
    if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(claimed, "hex"))) {
      return { ok: false, reason: "HMAC pair-lock failed — agreement or transcript altered" };
    }
  } catch { return { ok: false, reason: "HMAC malformed" }; }
  return { ok: true };
}

// ─── Run agreement (in-process checker) ──────────────────────────────────
//
// We DON'T eval the generated source for the in-process path; we use a
// native TypeScript checker that mirrors the source exactly. The source
// exists for transparency + offline use (Node import).
export function runAgreement(input: { agreement: Agreement; target: CheckTarget }): CheckResult[] {
  return input.agreement.decisions.map((d) => nativeCheck(d, input.target));
}

function nativeCheck(d: Decision, target: CheckTarget): CheckResult {
  const t = target;
  switch (d.pattern) {
    case "test_required": {
      const files = t.filesChanged || [];
      const hasTest = files.some((f) => /\.(test|spec)\./i.test(f) || /(^|\/)tests?\//i.test(f));
      return { decisionText: d.text, pattern: d.pattern, ok: hasTest, reason: hasTest ? "test file present in changeset" : "no test file in changeset", severity: hasTest ? "info" : "block" };
    }
    case "timing_safe_equal_required": {
      const diff = t.diffText || "";
      // Per-line: looking for `===` AND any token containing hmac/signature/sig (incl. camelCase suffixes).
      if (!/hmac|signature/i.test(diff)) {
        return { decisionText: d.text, pattern: d.pattern, ok: true, reason: "no HMAC compare in diff", severity: "info" };
      }
      const lines = diff.split("\n");
      const offendingLine = lines.find((line) => /===|!==/.test(line) && /hmac|signature|\bsig\b/i.test(line));
      const usesEquals = offendingLine !== undefined;
      const usesTS = /timingSafeEqual\s*\(/i.test(diff);
      const ok = usesTS || !usesEquals;
      return { decisionText: d.text, pattern: d.pattern, ok, reason: ok ? "timingSafeEqual present or no === compare on HMAC line" : "HMAC/signature compared with === instead of timingSafeEqual", severity: ok ? "info" : "block" };
    }
    case "no_console_log": {
      const diff = t.diffText || "";
      const has = /\bconsole\.log\s*\(/i.test(diff);
      return { decisionText: d.text, pattern: d.pattern, ok: !has, reason: has ? "console.log found in diff" : "no console.log in diff", severity: has ? "warn" : "info" };
    }
    case "no_direct_push_main": {
      const branch = (t.branch || "").toLowerCase();
      const onMain = branch === "main" || branch === "master";
      return { decisionText: d.text, pattern: d.pattern, ok: !onMain, reason: onMain ? `currently on ${branch}; push must come via PR` : "branch ok (not main/master)", severity: onMain ? "block" : "info" };
    }
    case "has_hmac": {
      const diff = t.diffText || "";
      const has = /createHmac\s*\(/i.test(diff) || /\.sig\b/.test(diff);
      return { decisionText: d.text, pattern: d.pattern, ok: has, reason: has ? "HMAC primitive referenced" : "no HMAC primitive in diff", severity: has ? "info" : "warn" };
    }
    case "no_secret_in_code": {
      const diff = t.diffText || "";
      const patterns: RegExp[] = [
        // OpenAI-style keys: sk-XXXX or sk-proj-XXXX; allow hyphens + underscores
        /sk-(?:proj-)?[A-Za-z0-9_-]{16,}/,
        /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
        /AKIA[0-9A-Z]{16}/,
        /\b(?:password|secret|api[_-]?key)\s*[:=]\s*["'][^"'\s]{8,}["']/i,
      ];
      for (const p of patterns) {
        if (p.test(diff)) return { decisionText: d.text, pattern: d.pattern, ok: false, reason: "secret-shaped string found in diff", severity: "block" };
      }
      return { decisionText: d.text, pattern: d.pattern, ok: true, reason: "no secret pattern matched", severity: "info" };
    }
    case "must_have_changelog": {
      const files = t.filesChanged || [];
      const has = files.some((f) => /CHANGELOG/i.test(f));
      return { decisionText: d.text, pattern: d.pattern, ok: has, reason: has ? "CHANGELOG touched" : "no CHANGELOG entry in changeset", severity: has ? "info" : "block" };
    }
    case "review_required": {
      const minRaw = d.params?.["minReviewers"];
      const min = typeof minRaw === "number" && Number.isFinite(minRaw) && minRaw > 0 ? minRaw : 1;
      const tt = t as CheckTarget & { approvals?: unknown[]; approvalCount?: number };
      const approvals = Array.isArray(tt.approvals) ? tt.approvals.length : (typeof tt.approvalCount === "number" ? tt.approvalCount : 0);
      const ok = approvals >= min;
      return { decisionText: d.text, pattern: d.pattern, ok, reason: ok ? `≥${min} approvals (${approvals})` : `needs ${min} approvals, have ${approvals}`, severity: ok ? "info" : "block" };
    }
    case "manual":
    default:
      return { decisionText: d.text, pattern: d.pattern, ok: false, reason: "manual review required (no auto-checker for this pattern yet)", severity: "warn" };
  }
}

// ─── Persistence ──────────────────────────────────────────────────────────
export interface PersistResult {
  agreementJsonPath: string;
  generatedSourcePath: string;
  transcriptPath: string;
}

export function persistAgreement(input: {
  agreement: Agreement;
  transcript: string;
  baseDir?: string;
}): PersistResult {
  const dir = input.baseDir ?? ".mneme/agreements";
  mkdirSync(dir, { recursive: true });
  const base = join(dir, input.agreement.agreementId);
  const agreementJsonPath = base + ".json";
  const generatedSourcePath = base + ".mjs";
  const transcriptPath = base + ".transcript.txt";
  writeFileSync(agreementJsonPath, JSON.stringify(input.agreement, null, 2), "utf8");
  writeFileSync(generatedSourcePath, input.agreement.generatedSource, "utf8");
  writeFileSync(transcriptPath, input.transcript, "utf8");
  return { agreementJsonPath, generatedSourcePath, transcriptPath };
}

export function loadAgreement(input: {
  agreementJsonPath: string;
  transcriptPath: string;
  secret?: string;
}): { agreement: Agreement; transcript: string; verified: boolean; reason?: string } {
  if (!existsSync(input.agreementJsonPath)) throw new Error(`agreement file not found: ${input.agreementJsonPath}`);
  if (!existsSync(input.transcriptPath)) throw new Error(`transcript file not found: ${input.transcriptPath}`);
  const agreement = JSON.parse(readFileSync(input.agreementJsonPath, "utf8")) as Agreement;
  const transcript = readFileSync(input.transcriptPath, "utf8");
  const v = verifyAgreementPair({ agreement, transcript, secret: input.secret });
  return { agreement, transcript, verified: v.ok, reason: v.reason };
}

export function listAgreements(baseDir?: string): string[] {
  const dir = baseDir ?? ".mneme/agreements";
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => join(dir, f));
}

// ─── Uninstall (v2.19.7) ──────────────────────────────────────────────
import { unlinkSync } from "node:fs";
export interface UninstallInput {
  agreementId?: string;       // remove this agreement's 3 files
  agreementJsonPath?: string; // OR explicit path
  baseDir?: string;
  /** Path to pre-commit hook to remove (if installed). */
  hookPath?: string;
}
export interface UninstallResult {
  removed: string[];
  notFound: string[];
  hookRemoved: boolean;
}
export function uninstallAgreement(input: UninstallInput): UninstallResult {
  const baseDir = input.baseDir ?? ".mneme/agreements";
  const targets: string[] = [];
  if (input.agreementJsonPath) {
    const id = input.agreementJsonPath.replace(/\.json$/, "");
    targets.push(`${id}.json`, `${id}.mjs`, `${id}.transcript.txt`);
  } else if (input.agreementId) {
    const base = join(baseDir, input.agreementId);
    targets.push(`${base}.json`, `${base}.mjs`, `${base}.transcript.txt`);
  } else {
    throw new Error("AGREEMENT uninstall: pass agreementId or agreementJsonPath");
  }
  const removed: string[] = [];
  const notFound: string[] = [];
  for (const t of targets) {
    if (existsSync(t)) { try { unlinkSync(t); removed.push(t); } catch { notFound.push(t); } }
    else notFound.push(t);
  }
  let hookRemoved = false;
  if (input.hookPath && existsSync(input.hookPath)) {
    // Only remove if it looks like a Mneme-generated hook (sanity check)
    try {
      const txt = readFileSync(input.hookPath, "utf8");
      if (txt.includes("MNEME AGREEMENT PRE-COMMIT HOOK")) {
        unlinkSync(input.hookPath);
        hookRemoved = true;
      }
    } catch { /* */ }
  }
  return { removed, notFound, hookRemoved };
}

// ─── Helpers / formatters ────────────────────────────────────────────────
export function formatAgreementLine(a: Agreement): string {
  return `📜 AGREEMENT · ${a.name} · ${a.agreementId} · ${a.decisions.length} decision(s)`;
}

export function formatCheckSummary(results: CheckResult[]): string {
  const blocked = results.filter((r) => !r.ok && r.severity === "block").length;
  const warn = results.filter((r) => !r.ok && r.severity === "warn").length;
  const ok = results.filter((r) => r.ok).length;
  const icon = blocked > 0 ? "🟥" : warn > 0 ? "🟧" : "✅";
  return `${icon} AGREEMENT · ${ok} ok · ${warn} warn · ${blocked} BLOCKED`;
}

/**
 * Generate a pre-commit-hook script (shell + node one-liner) that loads
 * the agreement, runs the staged diff against its checkers, and exits 1
 * on any blocked check.
 */
export function generatePreCommitHook(input: { agreementJsonPath: string; transcriptPath: string }): string {
  return `#!/usr/bin/env node
// MNEME AGREEMENT PRE-COMMIT HOOK · auto-generated
// Loads ${input.agreementJsonPath}; runs against staged diff; exits 1 if any BLOCKED check fires.
import { loadAgreement, runAgreement, formatCheckSummary } from "@mneme-ai/core/conversation_compiler";
import { execSync } from "node:child_process";

const { agreement, transcript, verified, reason } = loadAgreement({
  agreementJsonPath: ${JSON.stringify(input.agreementJsonPath)},
  transcriptPath: ${JSON.stringify(input.transcriptPath)},
});
if (!verified) { console.error("Mneme agreement pair-lock FAILED: " + (reason || "unknown")); process.exit(2); }

const filesChanged = execSync("git diff --cached --name-only", { encoding: "utf8" }).trim().split("\\n").filter(Boolean);
const diffText = execSync("git diff --cached", { encoding: "utf8" });
const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
const commitMessage = ""; // pre-commit doesn't have it yet

const results = runAgreement({ agreement, target: { filesChanged, diffText, branch, commitMessage } });
console.log(formatCheckSummary(results));
for (const r of results) if (!r.ok) console.log("  " + (r.severity === "block" ? "🟥" : "🟧") + " " + r.decisionText + " — " + r.reason);
const blocked = results.some((r) => !r.ok && r.severity === "block");
process.exit(blocked ? 1 : 0);
`;
}
