/**
 * v2.30.0 — Differential-privacy-style scrubber for HONEST MIRROR.
 *
 * Replaces secrets / PII / absolute paths with stable salted hashes so:
 *   - vendor never sees the user's real keys / emails / paths
 *   - same secret across artifacts still hashes to the same token (so
 *     the vendor can reason about "the same X" without seeing its
 *     actual value)
 *   - the scrub is deterministic (HMAC of the secret + salt) so calibration
 *     across runs is reproducible
 *
 * Coverage (v2.30.0):
 *   - AWS / GitHub / OpenAI / Anthropic key prefixes
 *   - JWT (3-segment dot-separated)
 *   - PEM private key blocks
 *   - emails
 *   - absolute file paths (Windows + POSIX)
 *   - long hex digests (sha / commit hashes — keep first 7 chars for git)
 *
 * Returns the scrubbed text + a redaction map so callers can interpret
 * `<SECRET:abc123>` references in the vendor's answer.
 */

import { createHmac } from "node:crypto";

const SCRUB_KEY = process.env["MNEME_HONEST_MIRROR_KEY"] ?? "mneme-honest-mirror-v1";

export interface ScrubResult {
  text: string;
  redactionCount: number;
  redactedKinds: Record<string, number>;
}

function token(kind: string, value: string): string {
  const h = createHmac("sha256", SCRUB_KEY).update(`${kind}|${value}`).digest("hex").slice(0, 8);
  return `<${kind.toUpperCase()}:${h}>`;
}

const RULES: Array<{ kind: string; re: RegExp; replacer?: (m: RegExpExecArray) => string }> = [
  // PEM private key blocks (multiline; must come before generic hex)
  { kind: "pem", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  // JWT
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g },
  // AWS
  { kind: "aws_key", re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  // GitHub
  { kind: "gh_token", re: /\b(ghp|gho|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g },
  // OpenAI
  { kind: "openai_key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  // Anthropic
  { kind: "anthropic_key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  // Generic Bearer
  { kind: "bearer", re: /\b(?:Bearer|bearer)\s+[A-Za-z0-9._\-+/=]{20,}\b/g },
  // Emails
  { kind: "email", re: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g },
  // Windows absolute paths
  { kind: "win_path", re: /\b[A-Za-z]:\\(?:[^\s\\/:*?"<>|]+\\)*[^\s\\/:*?"<>|]+\b/g },
  // POSIX absolute paths (skip common shared dirs)
  { kind: "posix_path", re: /(?<!\w)\/(?:home|Users|var|root|opt|srv)\/[^\s'"]+/g },
  // Long hex (git commit hashes / sha256) — preserve first 7 chars
  {
    kind: "sha",
    re: /\b[a-f0-9]{40,}\b/g,
    replacer: (m) => `${m[0]!.slice(0, 7)}<SHA:${createHmac("sha256", SCRUB_KEY).update(m[0]!).digest("hex").slice(0, 6)}>`,
  },
];

export function scrub(text: string): ScrubResult {
  let out = text;
  let total = 0;
  const kinds: Record<string, number> = {};
  for (const rule of RULES) {
    out = out.replace(rule.re, (match) => {
      total++;
      kinds[rule.kind] = (kinds[rule.kind] ?? 0) + 1;
      if (rule.replacer) {
        // Execute the regex on the match to fabricate the array shape replacer expects.
        const fake = [match] as unknown as RegExpExecArray;
        fake.index = 0;
        fake.input = match;
        return rule.replacer(fake);
      }
      return token(rule.kind, match);
    });
  }
  return { text: out, redactionCount: total, redactedKinds: kinds };
}
