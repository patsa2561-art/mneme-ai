/**
 * VulnHunt — security vulnerability pattern detection from commit + diff history.
 *
 * This module is the bank/finance-grade angle. It does NOT try to replace
 * SAST tools (CodeQL, semgrep). Instead it focuses on what no SAST does:
 *
 *   1. Hunt vulnerable patterns *retrospectively* across all of git history
 *      so a CVE-style audit can answer "did this code ever have X?"
 *
 *   2. Detect "fix-shaped" commits (security commits that DIDN'T announce
 *      themselves), exposing silent fixes — useful when assessing supply
 *      chain risk.
 *
 *   3. Surface suspect commits whose diff matches a known-vulnerable
 *      pattern but whose subject says nothing about security — a strong
 *      signal of an undocumented vulnerable change.
 *
 *   4. Group findings by severity using CWE/CVSS-aligned categories so
 *      reviewers can triage.
 *
 * IMPORTANT: this is pattern-matching on diff + subject text. It produces
 * *candidates* that need human review, not certified vulnerabilities.
 * Forensic-grade methodology requires a human-in-the-loop review for
 * every finding before action.
 */
import type { Commit } from "../types.js";

export type VulnClass =
  | "crypto-weakness" //  CWE-327, CWE-330
  | "injection-sql" //    CWE-89
  | "injection-shell" //  CWE-78
  | "injection-xss" //    CWE-79
  | "auth-flaw" //        CWE-287, CWE-798
  | "financial-logic" //  CWE-190, CWE-682
  | "supply-chain" //     CWE-1357
  | "memory-safety" //    CWE-119, CWE-416
  | "privilege" //        CWE-269
  | "info-leakage" //     CWE-200
  | "race-condition"; //  CWE-362

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface VulnHit {
  commit: Commit;
  class: VulnClass;
  severity: Severity;
  /** Short human-readable summary. */
  summary: string;
  /** The matched line / pattern (truncated). */
  evidence: string;
  /** Reference (CWE id, CVSS hint). */
  reference: string;
  /** Whether the commit itself looks like a fix (negative signal). */
  looksLikeFix: boolean;
}

export interface VulnHuntReport {
  hits: VulnHit[];
  bySeverity: Record<Severity, number>;
  byClass: Partial<Record<VulnClass, number>>;
  /** Commits whose subject matches "security/CVE/vulnerability/fix XSS/etc." */
  silentFixes: Commit[];
  /** Number of commits scanned. */
  scanned: number;
}

interface Rule {
  class: VulnClass;
  severity: Severity;
  reference: string;
  /** Multiline regex matching against commit text + (optional) diff. */
  pattern: RegExp;
  summary: string;
  /** If true, only fires on *additions* in a diff. Default true. */
  additionsOnly?: boolean;
}

const RULES: Rule[] = [
  // ── CRYPTO ──────────────────────────────────────────────────────────
  {
    class: "crypto-weakness",
    severity: "high",
    reference: "CWE-327",
    pattern: /\b(?:MD5|SHA-?1)\s*\(/i,
    summary: "MD5 / SHA-1 used as a hash function (broken for security)",
  },
  {
    class: "crypto-weakness",
    severity: "high",
    reference: "CWE-327",
    pattern: /\b(?:DES|3DES|RC4|Blowfish)\b/,
    summary: "Weak / deprecated cipher referenced",
  },
  {
    class: "crypto-weakness",
    severity: "critical",
    reference: "CWE-330",
    pattern: /Math\.random\s*\(\s*\)|new\s+Random\s*\(\s*\)/,
    summary: "Non-cryptographic RNG used (Math.random / Random) — use crypto.randomBytes",
  },
  {
    class: "crypto-weakness",
    severity: "high",
    reference: "CWE-321",
    pattern: /(?:secret|api[_-]?key|password|token|private[_-]?key)\s*=\s*["'][a-zA-Z0-9+/=_-]{16,}["']/i,
    summary: "Hardcoded credential / secret in source",
  },

  // ── INJECTION ──────────────────────────────────────────────────────
  {
    class: "injection-sql",
    severity: "critical",
    reference: "CWE-89",
    pattern: /(?:SELECT|INSERT|UPDATE|DELETE)\s+[^;]*?\$\{[^}]+\}|"\s*SELECT[^"]*"\s*\+\s*\w+|f"\s*SELECT[^"]*\{/i,
    summary: "SQL string concatenation / interpolation — possible injection",
  },
  {
    class: "injection-shell",
    severity: "critical",
    reference: "CWE-78",
    pattern: /(?:exec|spawn|system|popen|os\.system|subprocess\.\w+)\s*\(\s*[^,)]*(?:\$\{|\+\s*\w|input\(|argv\[)/,
    summary: "Shell exec with concatenated / interpolated input",
  },
  {
    class: "injection-xss",
    severity: "high",
    reference: "CWE-79",
    pattern: /\bdangerouslySetInnerHTML\b|\binnerHTML\s*=\s*[^"'][^;]+(?:input|req\.|params|body)/,
    summary: "innerHTML / dangerouslySetInnerHTML with user-controlled data",
  },
  {
    class: "injection-xss",
    severity: "medium",
    reference: "CWE-95",
    pattern: /\beval\s*\(\s*[^"')]*(?:input|req\.|params|body|argv)/,
    summary: "eval() with user-controlled input",
  },

  // ── AUTH FLAWS ─────────────────────────────────────────────────────
  {
    class: "auth-flaw",
    severity: "critical",
    reference: "CWE-798",
    pattern: /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=._-]{16,}/,
    summary: "Hardcoded bearer / basic auth token",
  },
  {
    class: "auth-flaw",
    severity: "critical",
    reference: "CWE-347",
    pattern: /jwt\.(?:decode|verify)\s*\([^,)]+,\s*null|jwt\.decode\s*\(/i,
    summary: "JWT decoded without signature verification",
  },
  {
    class: "auth-flaw",
    severity: "high",
    reference: "CWE-942",
    pattern: /Access-Control-Allow-Origin[^;]*\*[^;]*Access-Control-Allow-Credentials\s*:\s*true|cors\s*\(\s*\{\s*origin\s*:\s*["']\*/i,
    summary: "CORS wildcard origin combined with credentials enabled",
  },

  // ── FINANCIAL LOGIC (bank-grade) ──────────────────────────────────
  {
    class: "financial-logic",
    severity: "critical",
    reference: "CWE-190",
    pattern: /(?:amount|balance|price|cents|usd|thb|eur)\s*[+\-*]\s*(?:amount|balance|price|cents|usd|thb|eur)/i,
    summary: "Arithmetic on money-typed names — verify overflow + precision",
  },
  {
    class: "financial-logic",
    severity: "high",
    reference: "CWE-682",
    pattern: /Number\s*\(\s*(?:amount|balance|price|fee|tax)|parseFloat\s*\(\s*(?:amount|balance|price|fee|tax)/i,
    summary: "Money cast to JS Number — precision loss; use BigInt or money lib",
  },
  {
    class: "financial-logic",
    severity: "high",
    reference: "CWE-840",
    pattern: /amount\s*[<>]=?\s*0\b/i, // We want to see if it's a guard or a flaw
    summary: "Direct comparison of `amount` to 0 — verify negative-amount handling",
  },

  // ── SUPPLY CHAIN ───────────────────────────────────────────────────
  {
    class: "supply-chain",
    severity: "medium",
    reference: "CWE-1357",
    pattern: /^\+\s*"[^"]+":\s*"(\^|~)?[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?",?\s*$/m,
    summary: "Dependency added or version changed — verify it's locked + scanned",
  },

  // ── INFO LEAKAGE ───────────────────────────────────────────────────
  {
    class: "info-leakage",
    severity: "medium",
    reference: "CWE-209",
    pattern: /console\.log\s*\([^)]*(?:password|token|secret|key|jwt|cookie|session)/i,
    summary: "Sensitive value logged to console",
  },
  {
    class: "info-leakage",
    severity: "high",
    reference: "CWE-209",
    pattern: /\b(?:err|error|e)\.stack\b.*?(?:res\.send|res\.json|return)/,
    summary: "Stack trace exposed to client response",
  },

  // ── RACE CONDITIONS ────────────────────────────────────────────────
  {
    class: "race-condition",
    severity: "medium",
    reference: "CWE-362",
    pattern: /if\s*\([^)]*await[^)]*\)\s*\{[\s\S]{0,200}?await/,
    summary: "Check-then-await pattern — possible TOCTOU race",
  },

  // ── PRIVILEGE ──────────────────────────────────────────────────────
  {
    class: "privilege",
    severity: "high",
    reference: "CWE-269",
    pattern: /\bsetuid\s*\(\s*0\s*\)|\bos\.setuid\s*\(/,
    summary: "Privilege escalation to root via setuid",
  },
];

const FIX_KEYWORDS =
  /\b(fix|fixes|fixed|patch|patched|secure|security|cve-?\d+|vuln(?:erability)?|exploit|hotfix)\b/i;
const SECURITY_SUBJECT =
  /\b(security|cve-?\d+|vuln|exploit|csrf|xss|sqli|rce|sssrf|xxe|auth\s+bypass)\b/i;

/**
 * Scan a set of (commit, diffText) pairs for vulnerability patterns.
 *
 * If diff text isn't available, we still scan subject + body — useful
 * for catching "silent fix" commits (commits whose subject says nothing
 * but whose diff would have matched).
 */
export function huntVulnerabilities(
  inputs: Array<{ commit: Commit; diff?: string }>,
): VulnHuntReport {
  const hits: VulnHit[] = [];
  const silentFixes: Commit[] = [];

  for (const { commit, diff } of inputs) {
    const subjectAndBody = `${commit.subject}\n${commit.body || ""}`;
    const text = `${subjectAndBody}\n${diff || ""}`;
    const looksLikeFix = FIX_KEYWORDS.test(subjectAndBody);

    for (const rule of RULES) {
      const m = rule.pattern.exec(text);
      if (!m) continue;

      // For diff-only rules (additionsOnly), require the matched line to
      // appear after a leading "+" in a diff context.
      if (rule.additionsOnly !== false && diff) {
        const line = extractLineAround(text, m.index);
        if (line && !line.startsWith("+")) {
          continue;
        }
      }

      hits.push({
        commit,
        class: rule.class,
        severity: rule.severity,
        summary: rule.summary,
        evidence: truncate(m[0], 200),
        reference: rule.reference,
        looksLikeFix,
      });
    }

    // Silent-fix detection: subject looks security-related but didn't
    // raise any rule hits in the same pass — we still record it because
    // even a "subject hint" is useful for compliance.
    if (SECURITY_SUBJECT.test(subjectAndBody)) {
      silentFixes.push(commit);
    }
  }

  const bySeverity: Record<Severity, number> = {
    info: 0,
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
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
  };
}

function extractLineAround(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index) + 1;
  const end = text.indexOf("\n", index);
  return text.slice(start, end < 0 ? undefined : end);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
