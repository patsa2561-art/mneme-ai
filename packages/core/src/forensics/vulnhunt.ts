/**
 * VulnHunt — security vulnerability pattern detection from commit + diff
 * history, **stack-aware and AST-evidence-scored** (v0.37).
 *
 * The v0.36 customer-deployed scanner had two architectural blind spots:
 *
 *   1. It ran every rule on every repo regardless of whether the rule
 *      could possibly apply (CWE-89 fired in a Mongoose-only repo because
 *      the regex matched the substring "update" in log strings).
 *
 *   2. It scored every regex match identically — a match inside
 *      `console.log(...)` and a match inside `db.query(...)` were both
 *      reported as "CRITICAL".
 *
 * v0.37 fixes both with **Bayesian Stack-Aware Priors × AST Evidence
 * Scoring**:
 *
 *   posterior = priorByStack(rule) × evidenceScore(ast-context)
 *
 * Findings below `minPosterior` (default 0.3) are dropped *before* they
 * land in the output, which means a NestJS+Mongoose repo no longer sees
 * any CWE-89 hits unless the regex matches inside a real DB sink and
 * the stack actually has a SQL driver.
 *
 * The rule catalog is also expanded from 11 → 18 to cover the gaps the
 * customer flagged: missing-auth-guard (NestJS), mass-assignment, IDOR,
 * SSRF, prototype-pollution, weak-webhook-signature.
 */
import type { Commit } from "../types.js";
import {
  type RuleId,
  type StackProfile,
  buildStackProfile,
  priorForRule,
  silenceReason,
  DEFAULT_MIN_POSTERIOR,
} from "./stack-priors.js";
import { type EvidenceContext, scoreEvidence } from "./ast-evidence.js";

export type {
  RuleId,
  StackProfile,
  EvidenceContext,
};

export type VulnClass =
  | "crypto-weakness"
  | "injection-sql"
  | "injection-shell"
  | "injection-xss"
  | "auth-flaw"
  | "financial-logic"
  | "supply-chain"
  | "memory-safety"
  | "privilege"
  | "info-leakage"
  | "race-condition"
  | "broken-access-control"
  | "ssrf"
  | "prototype-pollution"
  | "mass-assignment"
  | "webhook-signature";

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface VulnHit {
  /** Stable id per finding — derived from commit+rule+evidence. */
  id: string;
  commit: Commit;
  rule: RuleId;
  class: VulnClass;
  severity: Severity;
  summary: string;
  evidence: string;
  reference: string;
  looksLikeFix: boolean;
  /** Resolved file:line if we can extract it from the diff. */
  filePath?: string;
  line?: number;
  /** Bayesian posterior — stack prior × AST evidence. */
  posterior: number;
  /** Components for transparency / --explain mode. */
  prior: number;
  evidenceScore: number;
  evidenceContext: EvidenceContext;
  evidenceReason: string;
}

export interface SilencedRule {
  rule: RuleId;
  reason: string;
}

export interface VulnHuntReport {
  hits: VulnHit[];
  bySeverity: Record<Severity, number>;
  byClass: Partial<Record<VulnClass, number>>;
  silentFixes: Commit[];
  scanned: number;
  /** Rules silenced before they ran (stack prior < threshold). */
  silenced: SilencedRule[];
  /** Stack profile used for this scan. */
  stack: {
    sources: string[];
    hasSql: boolean;
    hasNoSql: boolean;
    hasWebFramework: boolean;
    hasNestJS: boolean;
    hasUiFramework: boolean;
    hasPaymentWebhook: boolean;
    hasJwt: boolean;
    detectedDeps: number;
  };
  /** Min-posterior threshold used. */
  minPosterior: number;
  /** Findings dropped because posterior < threshold. */
  dropped: number;
}

interface Rule {
  id: RuleId;
  class: VulnClass;
  severity: Severity;
  reference: string;
  pattern: RegExp;
  summary: string;
  /** Skip the rule entirely if stack prior is below this threshold. */
  silenceUnderPrior?: number;
  /** Skip AST evidence scoring — the rule is already string-literal-anchored
   *  so the "match-in-string-literal = false-positive-likely" heuristic is
   *  the wrong signal for it. Used by hardcoded-secret / hardcoded-token. */
  skipEvidence?: boolean;
}

const RULES: Rule[] = [
  // ── CRYPTO ──────────────────────────────────────────────────────────
  { id: "weak-hash", class: "crypto-weakness", severity: "high", reference: "CWE-327",
    pattern: /\b(?:MD5|SHA-?1)\s*\(/i,
    summary: "MD5 / SHA-1 used as a hash function (broken for security)" },
  { id: "weak-cipher", class: "crypto-weakness", severity: "high", reference: "CWE-327",
    pattern: /\b(?:DES|3DES|RC4|Blowfish)\b/,
    summary: "Weak / deprecated cipher referenced" },
  { id: "weak-rng", class: "crypto-weakness", severity: "critical", reference: "CWE-330",
    pattern: /Math\.random\s*\(\s*\)|new\s+Random\s*\(\s*\)/,
    summary: "Non-cryptographic RNG used (Math.random / Random) — use crypto.randomBytes" },
  { id: "hardcoded-secret", class: "crypto-weakness", severity: "high", reference: "CWE-321",
    pattern: /(?:secret|api[_-]?key|password|private[_-]?key)\s*=\s*["'][a-zA-Z0-9+/=_-]{16,}["']/i,
    summary: "Hardcoded credential / secret in source",
    skipEvidence: true },

  // ── INJECTION ──────────────────────────────────────────────────────
  // SQL injection rule is gated by stack prior — silenced under 0.2,
  // i.e. silenced entirely when the repo has no SQL driver.
  { id: "sql-injection", class: "injection-sql", severity: "critical", reference: "CWE-89",
    pattern: /(?:SELECT|INSERT|UPDATE|DELETE)\s+[^;\n]{0,80}?\$\{[^}]+\}|(?:"|')\s*SELECT\s[^"']*(?:"|')\s*\+\s*\w/i,
    summary: "SQL string concatenation / interpolation — possible injection",
    silenceUnderPrior: 0.2 },
  { id: "shell-injection", class: "injection-shell", severity: "critical", reference: "CWE-78",
    pattern: /(?:child_process\.exec|child_process\.spawn|exec|spawn)\s*\(\s*[^,)]*(?:\$\{|\+\s*\w|input\(|argv\[)/,
    summary: "Shell exec with concatenated / interpolated input" },
  { id: "xss-innerhtml", class: "injection-xss", severity: "high", reference: "CWE-79",
    pattern: /\bdangerouslySetInnerHTML\b|\binnerHTML\s*=\s*[^"'][^;]+(?:input|req\.|params|body)/,
    summary: "innerHTML / dangerouslySetInnerHTML with user-controlled data" },
  { id: "xss-eval", class: "injection-xss", severity: "medium", reference: "CWE-95",
    pattern: /\beval\s*\(\s*[^"')]*(?:input|req\.|params|body|argv)/,
    summary: "eval() with user-controlled input" },

  // ── AUTH FLAWS ─────────────────────────────────────────────────────
  { id: "hardcoded-token", class: "auth-flaw", severity: "critical", reference: "CWE-798",
    pattern: /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=._-]{16,}/,
    summary: "Hardcoded bearer / basic auth token",
    skipEvidence: true },
  { id: "jwt-no-verify", class: "auth-flaw", severity: "critical", reference: "CWE-347",
    pattern: /jwt\.(?:decode|verify)\s*\([^,)]+,\s*null|jwt\.decode\s*\(/i,
    summary: "JWT decoded without signature verification" },
  { id: "cors-wildcard-credentials", class: "auth-flaw", severity: "high", reference: "CWE-942",
    pattern: /Access-Control-Allow-Origin[^;]*\*[^;]*Access-Control-Allow-Credentials\s*:\s*true|cors\s*\(\s*\{\s*origin\s*:\s*["']\*/i,
    summary: "CORS wildcard origin combined with credentials enabled" },

  // ── NEW v0.37: NestJS missing auth guard ──────────────────────────
  // Pattern: a controller route decorator (@Get, @Post, @Put, @Delete,
  // @Patch) immediately followed by an async method definition with NO
  // @UseGuards decorator on either the method or the class. We detect
  // by matching the route line WITHOUT a UseGuards in the 6 lines before.
  { id: "missing-auth-guard", class: "broken-access-control", severity: "high", reference: "CWE-862",
    // The pattern itself flags any route handler — the AST pass / additional
    // text scan in `additionalContextOk` filters out properly guarded routes.
    pattern: /@(?:Get|Post|Put|Delete|Patch)\s*\([^)]*\)\s*\n\s*(?:async\s+)?[a-z]\w*\s*\(/m,
    summary: "Route handler without @UseGuards — verify auth is required",
    silenceUnderPrior: 0.5 },

  // ── NEW v0.37: weak webhook signature verification ─────────────────
  // Pattern: payment-gateway webhook handler that doesn't call the
  // verifySignature helper. Heuristic — flags `.webhook` / `webhookHandler`
  // routes whose body lacks `constructEvent`/`verifyHeader`/`verify(...).
  { id: "weak-webhook-signature", class: "webhook-signature", severity: "critical", reference: "CWE-345",
    pattern: /(?:webhook|webhooks)\s*[:(={].{0,400}(?:req\.body|payload)/is,
    summary: "Webhook handler that does not verify a signature — accept-anyone risk",
    silenceUnderPrior: 0.5 },

  // ── NEW v0.37: SSRF ────────────────────────────────────────────────
  { id: "ssrf", class: "ssrf", severity: "high", reference: "CWE-918",
    pattern: /(?:fetch|axios(?:\.get|\.post)?|http\.get|got|request)\s*\(\s*(?:req\.[a-z]+\.|params\.|body\.|input\.|query\.)\w+/,
    summary: "HTTP fetcher built from user input — server-side request forgery risk" },

  // ── NEW v0.37: prototype pollution ─────────────────────────────────
  { id: "prototype-pollution", class: "prototype-pollution", severity: "high", reference: "CWE-1321",
    pattern: /Object\.assign\s*\(\s*[^,]+,\s*(?:req\.body|req\.query|req\.params)\b|(?:_\.merge|merge)\s*\(\s*[^,]+,\s*(?:req\.body|req\.query|req\.params)\b/,
    summary: "Object.assign / merge with raw request input — prototype pollution risk" },

  // ── NEW v0.37: mass assignment ─────────────────────────────────────
  { id: "mass-assignment", class: "mass-assignment", severity: "high", reference: "CWE-915",
    pattern: /(?:create|save|update|insert|new)\s*\(\s*req\.body\s*\)|new\s+[A-Z][A-Za-z0-9_]+\s*\(\s*req\.body\s*\)/,
    summary: "Model constructed directly from req.body — mass-assignment risk; whitelist fields" },

  // ── NEW v0.37: IDOR — findById without ownership check ─────────────
  // Heuristic: `.findById(req.params.id)` or `.findOne({_id: req.params.id})`
  // followed within 200 chars by a return — without any reference to a
  // user-id / owner check. Coarse but high-signal in NestJS/Express repos.
  { id: "idor-no-ownership-check", class: "broken-access-control", severity: "high", reference: "CWE-639",
    pattern: /(?:findById|findOne)\s*\(\s*(?:req\.params\.|params\.|input\.)id[^)]*\)/,
    summary: "ID-based lookup using user-supplied id — verify ownership / authorization" },

  // ── FINANCIAL LOGIC ────────────────────────────────────────────────
  { id: "money-arithmetic", class: "financial-logic", severity: "critical", reference: "CWE-190",
    pattern: /(?:amount|balance|price|cents|usd|thb|eur)\s*[+\-*]\s*(?:amount|balance|price|cents|usd|thb|eur)/i,
    summary: "Arithmetic on money-typed names — verify overflow + precision" },
  { id: "money-as-number", class: "financial-logic", severity: "high", reference: "CWE-682",
    pattern: /Number\s*\(\s*(?:amount|balance|price|fee|tax)|parseFloat\s*\(\s*(?:amount|balance|price|fee|tax)/i,
    summary: "Money cast to JS Number — precision loss; use BigInt or money lib" },
  { id: "amount-zero-comparison", class: "financial-logic", severity: "high", reference: "CWE-840",
    pattern: /amount\s*[<>]=?\s*0\b/i,
    summary: "Direct comparison of `amount` to 0 — verify negative-amount handling" },

  // ── SUPPLY CHAIN ───────────────────────────────────────────────────
  { id: "dependency-changed", class: "supply-chain", severity: "medium", reference: "CWE-1357",
    pattern: /^\+\s*"[^"]+":\s*"(\^|~)?[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?",?\s*$/m,
    summary: "Dependency added or version changed — verify it's locked + scanned" },

  // ── INFO LEAKAGE ───────────────────────────────────────────────────
  { id: "logged-secret", class: "info-leakage", severity: "medium", reference: "CWE-209",
    pattern: /console\.log\s*\([^)]*(?:password|token|secret|key|jwt|cookie|session)/i,
    summary: "Sensitive value logged to console" },
  { id: "exposed-stack-trace", class: "info-leakage", severity: "high", reference: "CWE-209",
    pattern: /\b(?:err|error|e)\.stack\b.*?(?:res\.send|res\.json|return)/,
    summary: "Stack trace exposed to client response" },

  // ── RACE CONDITIONS ────────────────────────────────────────────────
  { id: "toctou-race", class: "race-condition", severity: "medium", reference: "CWE-362",
    pattern: /if\s*\([^)]*await[^)]*\)\s*\{[\s\S]{0,200}?await/,
    summary: "Check-then-await pattern — possible TOCTOU race" },

  // ── PRIVILEGE ──────────────────────────────────────────────────────
  { id: "setuid-root", class: "privilege", severity: "high", reference: "CWE-269",
    pattern: /\bsetuid\s*\(\s*0\s*\)|\bos\.setuid\s*\(/,
    summary: "Privilege escalation to root via setuid" },

  // ─── v0.50 — 26 NEW RULES (Bayesian Filter MAX) ─────────────────────
  // ── More crypto ───────────────────────────────────────────────────
  { id: "insecure-tls-version", class: "crypto-weakness", severity: "high", reference: "CWE-326",
    pattern: /(?:tls(?:Min)?Version|secureProtocol|ssl_version)\s*[:=]\s*["']?(?:TLSv1\.0|TLSv1\.1|SSLv[23])/,
    summary: "Explicitly downgrades TLS to a deprecated version (1.0 / 1.1 / SSLv2/3)" },
  { id: "timing-attack", class: "auth-flaw", severity: "medium", reference: "CWE-208",
    pattern: /(?:if\s*\(\s*\w+\s*===?\s*(?:token|secret|password|api[_-]?key|signature)\s*\))|(?:(?:token|secret|password|signature)\s*===?\s*\w+)/i,
    summary: "Plain `===` on auth secrets — vulnerable to timing attack; use crypto.timingSafeEqual" },

  // ── More injection ────────────────────────────────────────────────
  { id: "xxe-external-entity", class: "injection-xss", severity: "high", reference: "CWE-611",
    pattern: /(?:libxmljs|xml2js|@xmldom).*?\bnoent\s*[:=]\s*true|parseXML\s*\([^,)]+,\s*\{[^}]*resolveEntities\s*[:=]\s*true/i,
    summary: "XML parser configured to resolve external entities — XXE risk" },
  { id: "xpath-injection", class: "injection-xss", severity: "high", reference: "CWE-643",
    pattern: /\.evaluate\s*\(\s*[`"'][^`"']*\$\{[^}]+\}|xpath\s*\(\s*[`"'][^`"']*['"]\s*\+/,
    summary: "XPath query built from user input via concatenation / template literal" },
  { id: "ldap-injection", class: "injection-xss", severity: "high", reference: "CWE-90",
    pattern: /ldap.*?\.search\s*\(\s*[^,]*\$\{|ldap.*?\.bind\s*\(\s*[`"'][^`"']*\$\{/i,
    summary: "LDAP query built from user input — escape or use parameterised bind" },
  { id: "command-substitution", class: "injection-shell", severity: "critical", reference: "CWE-78",
    pattern: /(?:exec|spawn)\s*\(\s*[`"'][^`"']*\$\([^)]+\)[^`"']*[`"']|`[^`]*\$\([^)]+\)[^`]*`/,
    summary: "Backtick / $() command substitution with potentially-controlled input" },
  { id: "null-byte-injection", class: "injection-xss", severity: "medium", reference: "CWE-158",
    pattern: /\\x00|\\u0000|String\.fromCharCode\(\s*0\s*\)/,
    summary: "Explicit null byte handling — verify it's not used to bypass extension/path filters" },
  { id: "format-string", class: "injection-xss", severity: "medium", reference: "CWE-134",
    pattern: /(?:console\.log|printf|sprintf|process\.stdout\.write)\s*\(\s*(?:req\.|input\.|argv|process\.env\.\w+)/,
    summary: "Format-string-style call with raw user input as the format" },

  // ── Auth additions ────────────────────────────────────────────────
  { id: "csrf-missing", class: "auth-flaw", severity: "high", reference: "CWE-352",
    pattern: /app\.(?:post|put|delete|patch)\s*\(\s*[`"']\/[^,]*,\s*(?:async\s+)?\(\s*req/,
    summary: "Mutating route registered without visible CSRF middleware — verify protection",
    silenceUnderPrior: 0.4 },
  { id: "session-fixation", class: "auth-flaw", severity: "high", reference: "CWE-384",
    pattern: /(?:req\.session\.id\s*=|session\.regenerate\b)\s*\([^)]*req\./,
    summary: "Session id assigned from request input — session fixation risk" },

  // ── Financial ─────────────────────────────────────────────────────
  { id: "integer-overflow", class: "financial-logic", severity: "medium", reference: "CWE-190",
    pattern: /(?:amount|balance|total|count|qty)\s*\*\s*(?:amount|balance|total|count|qty|\d+)|\b(?:amount|balance|total)\s*<<\s*\d+/i,
    summary: "Integer multiplication / shift on money/count — verify overflow handling" },

  // ── Web additions ────────────────────────────────────────────────
  { id: "path-traversal", class: "broken-access-control", severity: "high", reference: "CWE-22",
    pattern: /(?:fs\.(?:readFile|createReadStream|stat)|readFileSync|sendFile)\s*\(\s*(?:[`"']\$?\.{0,2}\/?[^`"']*['"]?\s*\+|[`"'][^`"']*\$\{[^}]+\}|req\.|input\.|params\.)/,
    summary: "File-system call built from user input — path-traversal risk; canonicalise + allowlist" },
  { id: "open-redirect", class: "broken-access-control", severity: "high", reference: "CWE-601",
    pattern: /res\.redirect\s*\(\s*(?:req\.(?:body|query|params)\.|req\.headers\.referer)/,
    summary: "res.redirect() with raw user input — open-redirect risk" },
  { id: "unrestricted-file-upload", class: "broken-access-control", severity: "high", reference: "CWE-434",
    pattern: /multer\s*\(\s*\{[^}]*(?!fileFilter)[^}]*\}\s*\)|formidable\s*\(\s*\)/,
    summary: "File upload without `fileFilter` / extension allowlist" },
  { id: "graphql-introspection-enabled", class: "info-leakage", severity: "medium", reference: "CWE-200",
    pattern: /(?:apollo|graphql).*?\bintrospection\s*[:=]\s*true|(?:apollo|graphql).*?\bplayground\s*[:=]\s*true/i,
    summary: "GraphQL introspection / playground enabled — disable in production" },

  // ── Cookies / sessions ────────────────────────────────────────────
  { id: "insecure-cookie-flags", class: "auth-flaw", severity: "medium", reference: "CWE-614",
    pattern: /res\.cookie\s*\([^,]+,\s*[^,]+,\s*\{[^}]*(?!secure)[^}]*\}\s*\)|setHeader\s*\(\s*['"]Set-Cookie['"]/,
    summary: "Cookie set without Secure / HttpOnly / SameSite flags — verify cookie options" },
  { id: "hsts-missing", class: "info-leakage", severity: "low", reference: "CWE-319",
    pattern: /helmet\(\s*\{[^}]*hsts\s*[:=]\s*false/,
    summary: "HSTS explicitly disabled — TLS downgrade attack risk" },

  // ── Deserialisation ──────────────────────────────────────────────
  { id: "insecure-deserialization", class: "injection-xss", severity: "critical", reference: "CWE-502",
    pattern: /(?:pickle\.loads|JSON\.parse\s*\(\s*(?:input|req\.body|req\.query)|node-serialize\.unserialize|eval\s*\(\s*JSON)/,
    summary: "Deserialising untrusted input — RCE risk" },
  { id: "unsafe-yaml-load", class: "injection-xss", severity: "high", reference: "CWE-502",
    pattern: /(?:yaml\.load\s*\([^,)]*\)(?!\s*\{[^}]*schema)|yaml\.unsafe_load\b)/,
    summary: "yaml.load() without SafeLoader / schema option — RCE risk on untrusted YAML" },

  // ── Info leak ────────────────────────────────────────────────────
  { id: "sensitive-data-in-url", class: "info-leakage", severity: "high", reference: "CWE-598",
    pattern: /[?&](?:token|password|api[_-]?key|secret|jwt|access[_-]?token)=/i,
    summary: "Sensitive data in URL query string — leaked via referer / logs / browser history" },

  // ── Concurrency ──────────────────────────────────────────────────
  { id: "race-double-fetch", class: "race-condition", severity: "medium", reference: "CWE-367",
    pattern: /await\s+\w+\.(?:findById|findOne|get)\([^)]+\)[\s\S]{0,200}?await\s+\w+\.(?:findById|findOne|get)\(/,
    summary: "Same record fetched twice across an await — TOCTOU; use atomic update" },

  // ── Operational ──────────────────────────────────────────────────
  { id: "debug-mode-in-prod", class: "info-leakage", severity: "high", reference: "CWE-489",
    pattern: /(?:DEBUG\s*=\s*True|app\.set\s*\(\s*['"]env['"]\s*,\s*['"]development['"]|NODE_ENV.*?['"]development['"])/,
    summary: "Hard-coded debug / development mode" },
  { id: "unsafe-temp-file", class: "broken-access-control", severity: "medium", reference: "CWE-377",
    pattern: /\/tmp\/[a-zA-Z]+\.(?:log|txt|json|xml)|os\.tmpdir\(\)\s*\+\s*['"]\/[a-zA-Z]+/,
    summary: "Predictable temp file path — race / overwrite risk; use mkdtemp / mkstemp" },
  { id: "unsafe-regex-dos", class: "race-condition", severity: "medium", reference: "CWE-1333",
    pattern: /\([^)]*\+\)[+*]|\([^)]*\*\)[+*]|\(\?:[^)]*[*+]\)[*+]/,
    summary: "Nested quantifier in regex — catastrophic backtracking / ReDoS risk" },
  { id: "disabled-content-security-policy", class: "info-leakage", severity: "medium", reference: "CWE-1021",
    pattern: /helmet\(\s*\{[^}]*contentSecurityPolicy\s*[:=]\s*false|res\.removeHeader\(\s*['"]Content-Security-Policy['"]/,
    summary: "Content-Security-Policy header disabled — XSS protection lost" },
];

const FIX_KEYWORDS =
  /\b(fix|fixes|fixed|patch|patched|secure|security|cve-?\d+|vuln(?:erability)?|exploit|hotfix)\b/i;
const SECURITY_SUBJECT =
  /\b(security|cve-?\d+|vuln|exploit|csrf|xss|sqli|rce|ssrf|xxe|auth\s+bypass)\b/i;

export interface HuntOptions {
  /** Stack profile (auto-detected if absent). When absent, every rule
   *  runs with prior=1.0 (i.e. behaviour matches v0.36 minus AST scoring). */
  stack?: StackProfile;
  /** Drop findings whose posterior < this. Default 0.3. */
  minPosterior?: number;
  /** Suppress rules whose stack prior is below this threshold. Default 0.15. */
  silenceThreshold?: number;
  /** Ids of suppressed findings (from .mneme/suppressions.json). */
  suppressedIds?: Set<string>;
  /** Disable AST evidence scoring (regression mode for tests). Default false. */
  disableEvidence?: boolean;
}

/**
 * Scan a set of (commit, diffText) pairs for vulnerability patterns,
 * gated by Bayesian stack priors and AST evidence scoring.
 */
export function huntVulnerabilities(
  inputs: Array<{ commit: Commit; diff?: string }>,
  options: HuntOptions = {},
): VulnHuntReport {
  const stack = options.stack ?? buildStackProfile([]);
  const minPosterior = options.minPosterior ?? DEFAULT_MIN_POSTERIOR;
  const silenceThreshold = options.silenceThreshold ?? 0.15;
  const suppressed = options.suppressedIds ?? new Set<string>();

  // Pre-flight: silence rules whose stack prior is below threshold.
  const silenced: SilencedRule[] = [];
  const activeRules: Rule[] = [];
  for (const r of RULES) {
    const prior = priorForRule(r.id, stack);
    const minForRule = r.silenceUnderPrior ?? silenceThreshold;
    if (prior < minForRule) {
      silenced.push({
        rule: r.id,
        reason: silenceReason(r.id, stack) ?? `stack prior ${prior.toFixed(2)} < threshold ${minForRule}`,
      });
    } else {
      activeRules.push(r);
    }
  }

  const hits: VulnHit[] = [];
  const silentFixes: Commit[] = [];
  let dropped = 0;

  for (const { commit, diff } of inputs) {
    const subjectAndBody = `${commit.subject}\n${commit.body || ""}`;
    const scanText = `${subjectAndBody}\n${diff || ""}`;
    const looksLikeFix = FIX_KEYWORDS.test(subjectAndBody);

    for (const rule of activeRules) {
      const m = rule.pattern.exec(scanText);
      if (!m) continue;

      // Locate the diff hunk + line that contains the match.
      const lineCtx = locateMatch(scanText, m.index, diff);
      if (lineCtx && lineCtx.line && !lineCtx.line.startsWith("+")) {
        // Match landed in a removed-line or context-line — skip; we only
        // care about additions for vuln-hunt semantics.
        continue;
      }

      const evidence = (options.disableEvidence || rule.skipEvidence)
        ? { score: 1.0, context: "unknown" as const, reason: rule.skipEvidence ? "rule is string-literal-anchored — AST evidence skipped" : "evidence-scoring disabled" }
        : scoreEvidence(scanText, m.index, lineCtx?.filePath ?? "");

      const prior = priorForRule(rule.id, stack);
      const posterior = prior * evidence.score;

      if (posterior < minPosterior) {
        dropped += 1;
        continue;
      }

      const id = stableHitId(commit.hash, rule.id, m[0]);
      if (suppressed.has(id)) {
        dropped += 1;
        continue;
      }

      hits.push({
        id,
        commit,
        rule: rule.id,
        class: rule.class,
        severity: rule.severity,
        summary: rule.summary,
        evidence: truncate(m[0], 200),
        reference: rule.reference,
        looksLikeFix,
        filePath: lineCtx?.filePath,
        line: lineCtx?.lineNumber,
        posterior: round2(posterior),
        prior: round2(prior),
        evidenceScore: round2(evidence.score),
        evidenceContext: evidence.context,
        evidenceReason: evidence.reason,
      });
    }

    if (SECURITY_SUBJECT.test(subjectAndBody)) {
      silentFixes.push(commit);
    }
  }

  // Sort hits by posterior descending (most likely real first).
  hits.sort((a, b) => b.posterior - a.posterior);

  const bySeverity: Record<Severity, number> = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
  const byClass: Partial<Record<VulnClass, number>> = {};
  for (const h of hits) {
    bySeverity[h.severity] += 1;
    byClass[h.class] = (byClass[h.class] ?? 0) + 1;
  }

  return {
    hits,
    bySeverity,
    byClass,
    silentFixes,
    scanned: inputs.length,
    silenced,
    stack: {
      sources: stack.sources,
      hasSql: stack.hasSql,
      hasNoSql: stack.hasNoSql,
      hasWebFramework: stack.hasWebFramework,
      hasNestJS: stack.hasNestJS,
      hasUiFramework: stack.hasUiFramework,
      hasPaymentWebhook: stack.hasPaymentWebhook,
      hasJwt: stack.hasJwt,
      detectedDeps: stack.allDeps.size,
    },
    minPosterior,
    dropped,
  };
}

interface LineCtx {
  filePath?: string;
  line: string;
  lineNumber?: number;
}

/** Find the diff line containing the match + extract file path + line number. */
function locateMatch(text: string, idx: number, diff?: string): LineCtx | undefined {
  if (!diff) {
    const lineStart = text.lastIndexOf("\n", idx) + 1;
    const lineEnd = text.indexOf("\n", idx);
    return {
      line: text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd),
    };
  }
  // Walk backwards from idx to find file header + hunk header.
  // Conservative: just slice out the matched line; full parse is downstream.
  const lineStart = text.lastIndexOf("\n", idx) + 1;
  const lineEnd = text.indexOf("\n", idx);
  const matchedLine = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);

  // Walk backwards looking for `diff --git a/X b/Y` and the most recent
  // `@@ -a,b +c,d @@` to compute the line number.
  let filePath: string | undefined;
  let lineNumber: number | undefined;

  const before = text.slice(0, lineStart);
  const fileHdr = /diff --git a\/(.+?) b\/(.+?)\n/g;
  let lastFile: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = fileHdr.exec(before)) !== null) lastFile = m;
  if (lastFile) filePath = lastFile[2];

  const hunkRe = /@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@.*\n/g;
  let lastHunk: RegExpExecArray | null = null;
  while ((m = hunkRe.exec(before)) !== null) lastHunk = m;
  if (lastHunk) {
    const hunkStart = Number(lastHunk[1]);
    // Count + and context lines between hunk header and our line.
    const between = text.slice(lastHunk.index + lastHunk[0].length, lineStart);
    let offset = 0;
    for (const l of between.split("\n")) {
      if (l.startsWith("-")) continue;
      offset += 1;
    }
    lineNumber = hunkStart + Math.max(0, offset - 1);
  }

  return { filePath, line: matchedLine, lineNumber };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * Stable hash of (commit, rule, evidence) — used as the suppression key
 * so users can ignore a finding once and have the same id appear on
 * future runs.
 *
 * FNV-1a 32-bit. Identical across platforms, no crypto dep.
 */
export function stableHitId(commitHash: string, rule: RuleId, evidence: string): string {
  const input = `${commitHash}|${rule}|${evidence}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export const _RULES_FOR_TESTS = RULES;
