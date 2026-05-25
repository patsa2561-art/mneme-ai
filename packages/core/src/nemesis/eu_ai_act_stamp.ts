/**
 * v2.46.0 — NEMESIS ORGAN 3: EU AI Act Article 50 AUTO-STAMPER.
 *
 * EU AI Act Article 50 enforceable 2 Aug 2026 requires machine-readable
 * disclosure of AI-generated content. NEMESIS auto-appends a sentinel-
 * bracketed block to commit messages that's:
 *   - human-readable
 *   - machine-parseable (single regex)
 *   - HMAC-signed (tamper-evident; verifiable offline)
 *   - locale-independent
 *
 * Format (appended to commit message body):
 *
 *   <!-- AI-GENERATED-CONTENT
 *   regime=EU-AI-ACT-2024 article=50 vendor=claude-code confidence=0.98
 *   content-type=text/x-source-code at=2026-05-24T08:32:11.444Z
 *   hmac=7a6302153ee6a839...
 *   -->
 *
 * Pure deterministic; never throws. Caller wires it into git pre-commit
 * via `nemesis install-hook`.
 */

import { createHmac } from "node:crypto";
import type {
  Article50Stamp, Article50StampInput, StampResult, VerifyStampResult,
} from "./types.js";

const HMAC_KEY = process.env["MNEME_NEMESIS_KEY"] ?? "MNEME-NEMESIS-DEFAULT-KEY-v2.46";
const REGIME = "EU-AI-ACT-2024";
const ARTICLE = "50";

function canonicalStampBody(s: Omit<Article50Stamp, "hmac">, message: string): string {
  // Order matters for HMAC; we sort keys explicitly.
  return JSON.stringify({
    article: s.article,
    at: s.at,
    confidence: Number(s.confidence.toFixed(4)),
    contentType: s.contentType,
    message,
    regime: s.regime,
    vendor: s.vendor,
  });
}

export function stampArticle50(input: Article50StampInput): StampResult {
  if (!input || typeof input.vendor !== "string" || input.vendor.length === 0) {
    return {
      ok: false,
      reason: "vendor is required (e.g. 'claude-code', 'codex', 'cursor')",
      stampedMessage: input?.message ?? "",
      stamp: {
        at: "", vendor: "", confidence: 0, contentType: "text/x-source-code",
        hmac: "", regime: REGIME, article: ARTICLE,
      },
    };
  }
  const at = new Date().toISOString();
  const contentType = input.contentType ?? "text/x-source-code";
  const confidence = Math.max(0, Math.min(1, input.confidence ?? 0));
  const message = input.message ?? "";
  const body: Omit<Article50Stamp, "hmac"> = {
    at, vendor: input.vendor, confidence, contentType, regime: REGIME, article: ARTICLE,
  };
  const hmac = createHmac("sha256", HMAC_KEY).update(canonicalStampBody(body, message)).digest("hex").slice(0, 32);
  const stamp: Article50Stamp = { ...body, hmac };
  const block = [
    "",
    "<!-- AI-GENERATED-CONTENT",
    `regime=${REGIME} article=${ARTICLE} vendor=${input.vendor} confidence=${confidence.toFixed(2)}`,
    `content-type=${contentType} at=${at}`,
    `hmac=${hmac}`,
    "-->",
  ].join("\n");
  return {
    ok: true,
    stampedMessage: message.endsWith("\n") ? message + block : message + "\n" + block,
    stamp,
  };
}

/**
 * Parse a stamped message + HMAC-verify. Returns valid=false on any
 * tamper / missing field / regex mismatch.
 */
export function verifyStamp(stampedMessage: string): VerifyStampResult {
  if (!stampedMessage) return { valid: false, reason: "empty input" };
  const blockMatch = stampedMessage.match(/<!--\s*AI-GENERATED-CONTENT\s*([\s\S]*?)\s*-->/);
  if (!blockMatch) return { valid: false, reason: "no AI-GENERATED-CONTENT block found" };
  const block = blockMatch[1]!;
  const pick = (key: string): string | null => {
    const m = block.match(new RegExp(`(?:^|\\s)${key}=(\\S+)`));
    return m ? m[1]! : null;
  };
  const regime = pick("regime");
  const article = pick("article");
  const vendor = pick("vendor");
  const confidence = pick("confidence");
  const contentType = pick("content-type");
  const at = pick("at");
  const hmac = pick("hmac");
  if (!regime || !article || !vendor || !confidence || !contentType || !at || !hmac) {
    return { valid: false, reason: `missing fields in stamp block: regime=${!!regime} article=${!!article} vendor=${!!vendor} confidence=${!!confidence} contentType=${!!contentType} at=${!!at} hmac=${!!hmac}` };
  }
  if (regime !== REGIME) return { valid: false, reason: `regime mismatch: expected ${REGIME}, got ${regime}` };
  if (article !== ARTICLE) return { valid: false, reason: `article mismatch: expected ${ARTICLE}, got ${article}` };
  const confidenceNum = parseFloat(confidence);
  if (!Number.isFinite(confidenceNum)) return { valid: false, reason: "confidence is not a number" };
  // Recompute HMAC over the body + original message (everything before the block).
  const message = stampedMessage.slice(0, blockMatch.index).replace(/\n+$/, "");
  const body: Omit<Article50Stamp, "hmac"> = {
    at, vendor, confidence: confidenceNum, contentType, regime: REGIME, article: ARTICLE,
  };
  const expected = createHmac("sha256", HMAC_KEY).update(canonicalStampBody(body, message)).digest("hex").slice(0, 32);
  if (expected !== hmac) return { valid: false, reason: "HMAC mismatch — stamp was tampered" };
  return { valid: true, parsed: { ...body, hmac } };
}
