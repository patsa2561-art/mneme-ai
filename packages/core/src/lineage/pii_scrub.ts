/**
 * PII scrubbing for chromosomes — strip identifiable patterns BEFORE
 * crystallize so the chromosome is safe to push to a public-or-shared
 * spore (and safe to share as a Genome).
 *
 * What we scrub:
 *   - email addresses          → <email>@<domain>
 *   - absolute paths            → <path>
 *   - bearer tokens / API keys  → <secret>
 *   - GUIDs / UUIDs             → <uuid>
 *
 * What we KEEP:
 *   - commit hashes (already public via git)
 *   - tool names + categories
 *   - karma counts
 *   - relative file paths (within the repo)
 *
 * The function is idempotent — scrubbing already-scrubbed text is a no-op.
 */

const PATTERNS: Array<{ name: string; re: RegExp; replace: string | ((match: string) => string) }> = [
  // Email — preserve domain so the chromosome still tells us "from acme.com" without naming the user.
  {
    name: "email",
    re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
    replace: (m) => {
      const at = m.indexOf("@");
      return `<email>@${m.slice(at + 1)}`;
    },
  },
  // Absolute paths — Unix + Windows.
  { name: "abs-path-unix", re: /(?:^|[\s"`'])(\/(?:home|Users|root|var|tmp|opt)\/[^\s"`']*)/g, replace: " <path>" },
  { name: "abs-path-windows", re: /(?:^|[\s"`'])([A-Za-z]:\\[^\s"`']+)/g, replace: " <path>" },
  // Common token shapes.
  { name: "aws-key", re: /\bAKIA[0-9A-Z]{16}\b/g, replace: "<aws-key>" },
  { name: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, replace: "<github-token>" },
  { name: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replace: "<slack-token>" },
  { name: "google-api-key", re: /\bAIza[0-9A-Za-z_\-]{35}\b/g, replace: "<google-key>" },
  { name: "stripe-key", re: /\b(?:sk|pk)_(?:test|live)_[0-9a-zA-Z]{24,}\b/g, replace: "<stripe-key>" },
  // Bearer tokens (loose match — any 32+ char base64-like string preceded by Bearer).
  { name: "bearer", re: /\bBearer\s+[A-Za-z0-9._\-+/=]{16,}/gi, replace: "Bearer <token>" },
  // UUID v4-ish.
  { name: "uuid", re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, replace: "<uuid>" },
];

/** Scrub a string. Idempotent; safe to call repeatedly. */
export function scrubString(s: string): string {
  if (!s) return s;
  let out = s;
  for (const p of PATTERNS) {
    if (typeof p.replace === "string") {
      out = out.replace(p.re, p.replace);
    } else {
      out = out.replace(p.re, p.replace);
    }
  }
  return out;
}

/** Recursively scrub strings inside a JSON-serializable value.
 *  Arrays + objects walked; primitives passed through. */
export function scrubDeep<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubString(value) as unknown as T;
  if (Array.isArray(value)) return value.map(scrubDeep) as unknown as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrubDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}

/** Test helper: list pattern names that matched a given string. */
export function _scrubMatches(s: string): string[] {
  const hits: string[] = [];
  for (const p of PATTERNS) {
    if (p.re.test(s)) hits.push(p.name);
    p.re.lastIndex = 0; // reset stateful regex
  }
  return hits;
}
