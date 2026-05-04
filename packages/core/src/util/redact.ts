/**
 * Secret redaction layer — regex scrubber for common credential formats.
 *
 * Used before any text leaves the machine (sent to remote embedder, written
 * to logs, exported via `mneme ledger`). The redactor strips matches from
 * the *text Mneme processes* — your actual git history is never modified.
 *
 * Why this lives in `core/util` and not in a separate package: every code
 * path that touches a remote service (embedder, LLM provider, observability
 * adapter) must run through it, and "import from a sibling package" is too
 * easy to forget. Keeping it adjacent to types.ts makes it the obvious choice.
 *
 * Coverage rationale:
 *   - High-confidence patterns (AWS, GitHub, Stripe, OpenAI, Anthropic, Slack,
 *     GitLab, npm, Google API, private keys, JWT) — built-in, ON by default.
 *   - Lower-confidence (generic `password=` lines, hex blobs that may be hashes)
 *     — opt-in via { aggressive: true } because false-positive rate matters
 *     when redacting commit text that may legitimately contain hex commit hashes.
 */

export interface RedactionRule {
  /** Stable name shown in audit logs and counters. */
  name: string;
  /** Pattern that matches the secret. The *whole match* is replaced. */
  pattern: RegExp;
  /** What to put in place of the match. Default: `<REDACTED:${name}>`. */
  replacement?: string;
}

export interface RedactOptions {
  /** Add lower-confidence patterns (generic password=, hex blobs ≥ 40 chars). */
  aggressive?: boolean;
  /** Append custom rules (or override built-ins by name). */
  extraRules?: RedactionRule[];
  /** Disable specific built-in rules by name. */
  disableRules?: string[];
}

export interface RedactionResult {
  /** Text with every match replaced. */
  text: string;
  /** Per-rule hit count for audit reporting. Zero-count rules are omitted. */
  hits: Record<string, number>;
}

/**
 * Built-in rules. Ordered roughly by specificity (most specific first) so a
 * GitHub PAT is recognized as a GitHub PAT and not a generic Bearer token.
 *
 * Each pattern uses `g` flag — `redact()` consumes the lastIndex correctly
 * by re-creating from `source` + flags on every call (regex objects are
 * stateful between matches; reusing them across inputs corrupts state).
 */
const BUILTIN_RULES: RedactionRule[] = [
  // AWS — keys are stable, well-formed, and unambiguous.
  { name: "aws-access-key-id", pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "aws-secret-access-key", pattern: /\b(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{40}(?![A-Za-z0-9+/])\b/g },

  // GitHub — modern format, all variants. github_pat_ is the new fine-grained one.
  { name: "github-pat", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  { name: "github-pat-fine-grained", pattern: /\bgithub_pat_[A-Za-z0-9_]{82,}\b/g },

  // GitLab
  { name: "gitlab-pat", pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },

  // OpenAI / Anthropic / generic sk-* keys
  { name: "anthropic-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/g },
  { name: "openai-key", pattern: /\bsk-[A-Za-z0-9]{20,}\b/g },

  // Stripe — live and test
  { name: "stripe-key", pattern: /\b(?:sk|pk|rk)_(?:live|test)_[0-9A-Za-z]{20,}\b/g },

  // Slack
  { name: "slack-token", pattern: /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/g },

  // Google API (AIza prefix)
  { name: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },

  // npm token (modern format)
  { name: "npm-token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },

  // JWT (header.payload.signature, all base64url)
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },

  // PEM-armored private keys (multiline). These leak through commit messages
  // and PR descriptions surprisingly often when copy/paste goes wrong.
  {
    name: "pem-private-key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },

  // Generic bearer tokens (RFC 6750). Less specific — placed last so it does
  // not eat more specific patterns above.
  { name: "bearer-token", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*\b/g },
];

/** Lower-confidence rules — gated behind `aggressive: true`. */
const AGGRESSIVE_RULES: RedactionRule[] = [
  // password=... in commit text. Conservative bounds prevent eating commit messages.
  // Lookbehind excludes alphanumerics (so "subpassword=..." doesn't fire) but
  // *allows* `_` and `-` (so "DB_PASSWORD=..." and "API-KEY=..." both match —
  // \b alone doesn't, because regex \b treats `_` as a word character).
  {
    name: "password-assignment",
    pattern: /(?<![A-Za-z0-9])(?:password|passwd|pwd|api[_-]?key|secret|token)\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/gi,
  },
  // Long hex blobs (likely a key or hash). Bounded to avoid eating short SHAs.
  // Note: 40-char SHA1 hashes will match — false positives are expected here.
  {
    name: "hex-blob",
    pattern: /\b[0-9a-fA-F]{64,}\b/g,
  },
];

/**
 * Redact every match of every active rule from the input text.
 * Returns the redacted text plus per-rule hit counts.
 */
export function redact(text: string, opts: RedactOptions = {}): RedactionResult {
  if (!text) return { text, hits: {} };

  const disabled = new Set(opts.disableRules ?? []);
  const rules: RedactionRule[] = [];
  for (const r of BUILTIN_RULES) if (!disabled.has(r.name)) rules.push(r);
  if (opts.aggressive) for (const r of AGGRESSIVE_RULES) if (!disabled.has(r.name)) rules.push(r);
  if (opts.extraRules) for (const r of opts.extraRules) rules.push(r);

  const hits: Record<string, number> = {};
  let out = text;
  for (const rule of rules) {
    // Re-create regex per-call to avoid lastIndex pollution from prior runs.
    const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : rule.pattern.flags + "g");
    let count = 0;
    out = out.replace(re, () => {
      count += 1;
      return rule.replacement ?? `<REDACTED:${rule.name}>`;
    });
    if (count > 0) hits[rule.name] = count;
  }
  return { text: out, hits };
}

/**
 * Returns true iff the text contains any match for any active rule. Useful
 * when you want to short-circuit (e.g. refuse to send to remote embedder)
 * rather than redact-and-send.
 */
export function containsSecret(text: string, opts: RedactOptions = {}): boolean {
  return Object.keys(redact(text, opts).hits).length > 0;
}

/**
 * Aggregate hit counters across many redactions — useful for audit reporting
 * after a full index run.
 */
export function mergeHits(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
}
