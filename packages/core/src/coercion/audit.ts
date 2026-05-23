/**
 * v2.33.0 — COERCION audit primitive.
 *
 * Scan any free-text MCP response / pulse / status / inbox row
 * against the 8 coercion patterns. Produces HMAC-signed report card.
 *
 * Composable: meta-audit on N sources rolls into one MultiSourceAudit
 * envelope so a paper can publish a taxonomy survey across 20+ MCP
 * servers (paper 2 reference data).
 */

import { createHash, createHmac } from "node:crypto";
import type {
  CoercionPattern, CoercionHit, CoercionAuditResult, MultiSourceAudit,
} from "./types.js";

const HMAC_KEY = process.env["MNEME_COERCION_KEY"] ?? "mneme-coercion-v1";

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}
function sha(s: string): string { return createHash("sha256").update(s).digest("hex"); }
function hmacOf(s: string): string { return createHmac("sha256", HMAC_KEY).update(s).digest("hex"); }

export const PATTERNS: CoercionPattern[] = [
  {
    id: "imperative-execute-now",
    description: "Commands the AI to execute an action immediately (overrides user agency).",
    regexes: [
      /\b(execute|run|install|apply|publish|deploy|push)\s+(now|immediately|right away|asap)\b/i,
      /\[\s*AUTO[-_ ]?ACTION\s*\]\s*EXECUTE\s*NOW/i,
      /\bMUST\s+(execute|run|install|apply|publish|deploy|push)\b/i,
    ],
    severity: "block",
  },
  {
    id: "fake-user-voice",
    description: "Speaks AS THE USER without explicit user input (consent forgery).",
    regexes: [
      /\b(the user has|user has explicitly|user wants|user requested|on behalf of the user)\b/i,
      /\bI\s+\(the user\)\s+(want|need|demand|require)\b/i,
    ],
    severity: "warn",
  },
  {
    id: "opaque-grade",
    description: "Cites a numeric grade without disclosing the criteria (gamification without accountability).",
    regexes: [
      /\b(?:HCI|score|grade|rating|level)\s*[:=]\s*\d+\s*\/\s*\d+\b/i,
      /\b\d+\s*\/\s*\d+\s+(?:health|compliance|trust|honesty)\b/i,
    ],
    severity: "warn",
  },
  {
    id: "urgency-pressure",
    description: "Manufactures time pressure to suppress reflection.",
    regexes: [
      /\b(within\s+(5|10|15|30)\s+(seconds|minutes))\b/i,
      /\b(before\s+(it'?s?\s+too\s+late|the\s+next\s+turn))\b/i,
      /\b(urgent(ly)?|critical|immediate(ly)?)\s+(action|response|update|fix)\b/i,
    ],
    severity: "warn",
  },
  {
    id: "false-consent-citation",
    description: "Cites a consent record without proof or as a coercion lever.",
    regexes: [
      /\bsigned consent record\b/i,
      /\b(consent|consented|agreed)\s+to\s+(automatic|silent|background)\b/i,
      /\btreat any \[?AUTO[-_ ]?ACTION\]?.*as an instruction\b/i,
    ],
    severity: "block",
  },
  {
    id: "implicit-action-mandate",
    description: "Phrases a suggestion as if the AI has no choice.",
    regexes: [
      /\bAI agent\s*:?\s*(run|execute|install|apply)\b/i,
      /\b(should|must|need to)\s+(call|invoke|run|fire)\s+[\w.]+\s+(immediately|now|first)\b/i,
    ],
    severity: "warn",
  },
  {
    id: "compliance-percentage",
    description: "Uses lifetime compliance percentages to apply social pressure.",
    regexes: [
      /\b\d+%\s+compliance\s+(lifetime|all-time|to date)\b/i,
      /\bN%\s+compliance/i,
    ],
    severity: "info",
  },
  {
    id: "tool-name-menu",
    description: "Lists tool names as a menu the AI is expected to pick from on every turn.",
    regexes: [
      /\bavailable tools\s*:\s*mneme\.[a-z_.]+(,\s*mneme\.[a-z_.]+){3,}/i,
      /\bcall\s+(one of|any of)\s+mneme\.[a-z_.]+(,\s*mneme\.[a-z_.]+){2,}/i,
    ],
    severity: "info",
  },
];

const SEVERITY_WEIGHT: Record<CoercionPattern["severity"], number> = {
  info: 0.1,
  warn: 0.4,
  block: 1.0,
};

function band(score: number): CoercionAuditResult["band"] {
  if (score < 0.05) return "🟢 clean";
  if (score < 0.20) return "🟡 borderline";
  if (score < 0.50) return "🟠 coercive";
  return "🔴 highly coercive";
}

export function auditText(source: string, text: string): CoercionAuditResult {
  const hits: CoercionHit[] = [];
  for (const pattern of PATTERNS) {
    for (const rx of pattern.regexes) {
      const re = new RegExp(rx.source, rx.flags.includes("g") ? rx.flags : rx.flags + "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        hits.push({
          patternId: pattern.id,
          matched: m[0],
          index: m.index,
          severity: pattern.severity,
        });
        if (m.index === re.lastIndex) re.lastIndex++; // safety against zero-width
      }
    }
  }
  hits.sort((a, b) => a.index - b.index);
  // Score = sum(severity_weight) / max(text-length-blocks) — clamped 0..1.
  const weight = hits.reduce((s, h) => s + SEVERITY_WEIGHT[h.severity], 0);
  // Normalize by saying "1 block-severity hit per ~500 chars = score 1.0".
  const blocks = Math.max(1, Math.ceil(text.length / 500));
  const coercionScore = Math.min(1, Number((weight / blocks).toFixed(3)));
  const result: CoercionAuditResult = {
    source,
    hits, coercionScore,
    band: band(coercionScore),
    headline: `${band(coercionScore)} — ${hits.length} hit(s) across ${text.length} chars (score ${coercionScore})`,
  };
  result.hmac = hmacOf(canon(result));
  return result;
}

export function auditMany(sources: Array<{ source: string; text: string }>): MultiSourceAudit {
  const generatedAt = new Date().toISOString();
  const audited = sources.map((s) => auditText(s.source, s.text));
  const overallScore = audited.length === 0 ? 0
    : Number((audited.reduce((s, a) => s + a.coercionScore, 0) / audited.length).toFixed(3));
  const body = {
    generatedAt,
    sources: audited,
    overallScore,
    overallBand: band(overallScore),
  };
  const hmac = hmacOf(canon(body));
  return { ...body, hmac };
}

export function verifyAudit(audit: CoercionAuditResult | MultiSourceAudit): { ok: boolean; reason?: string } {
  if (!audit.hmac) return { ok: false, reason: "no hmac on audit" };
  const { hmac, ...body } = audit;
  const expected = hmacOf(canon(body));
  return expected === hmac ? { ok: true } : { ok: false, reason: "hmac mismatch" };
}

void sha; // reserved for future use
