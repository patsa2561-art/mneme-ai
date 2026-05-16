/**
 * v2.19.7 — MNEME RETROACTIVE COMPILE (mine git history → backdated agreements + broken-promise map)
 *
 *   "Scan every commit message + every persisted AI session transcript
 *    in `.mneme/` for agreement-shaped sentences (must / should / never
 *    / ห้าม / ต้อง). For each match, run the conversation_compiler
 *    pipeline → produce a backdated Agreement tied to the commit SHA.
 *    Then check: did SUBSEQUENT commits actually follow that agreement?
 *    Output: a map of EVERY broken promise in the repo's history, with
 *    commit SHAs + agreement excerpts + violation severity.
 *
 *    For the first time, a team can SEE the gap between what they said
 *    and what they did — measurable, recomputable, signed."
 *
 * Honest scope:
 *   - We don't claim to understand intent; we recognise the SHAPE of
 *     agreement-like sentences (the same pattern set conversation_compiler
 *     uses). Manual stubs are skipped during enforcement scoring.
 *   - Compliance check uses the same native checkers as run-time
 *     conversation_compiler, applied retroactively to each commit's diff.
 *     The output is a per-commit pass/fail with severity.
 *   - This is a READ-ONLY scan; no commits are modified.
 *
 * Composes onto v2.19.6 CONVERSATION COMPILER (reuses extractDecisions
 * + nativeCheck). Pure orchestrator over `git log` output (caller
 * supplies via `gitLog` callback so tests stay hermetic).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { extractDecisions, type Decision, type CheckTarget, type CheckResult } from "../conversation_compiler/index.js";

const PROTOCOL_VERSION = 1 as const;

export interface CommitRecord {
  sha: string;
  authorEmail: string;
  ts: string;
  message: string;
  filesChanged: string[];
  diffText: string;
  branch?: string;
}

export interface BackdatedAgreement {
  v: typeof PROTOCOL_VERSION;
  agreementId: string;
  sourceSha: string;
  sourceTs: string;
  decisions: Decision[];
  /** SHA-256 of the message that produced the decisions. */
  sourceSha256: string;
  sig: string;
}

export interface ComplianceViolation {
  v: typeof PROTOCOL_VERSION;
  violationId: string;
  agreementId: string;
  violatingCommitSha: string;
  violatingCommitTs: string;
  decisionText: string;
  pattern: string;
  severity: "info" | "warn" | "block";
  reason: string;
  sig: string;
}

export interface MineReport {
  v: typeof PROTOCOL_VERSION;
  reportId: string;
  scannedCommits: number;
  agreementsFound: BackdatedAgreement[];
  violations: ComplianceViolation[];
  brokenPromiseCount: number;
  /** Per-decision compliance stats. */
  perDecisionStats: Array<{ pattern: string; total: number; violated: number; rate: number }>;
  ranAt: string;
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}
function defaultSecret(): string {
  return process.env["MNEME_RETROACTIVE_SECRET"] || `mneme-retroactive-compile-v${PROTOCOL_VERSION}`;
}
function hmac(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}
function sha256(s: string): string {
  return createHmac("sha256", "retroactive-sha").update(s).digest("hex");
}
function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); } catch { return false; }
}

// Local copy of the native checker logic (matches conversation_compiler:nativeCheck)
function checkAgreementDecision(d: Decision, t: CheckTarget): CheckResult {
  switch (d.pattern) {
    case "test_required": {
      const files = t.filesChanged || [];
      const hasTest = files.some((f) => /\.(test|spec)\./i.test(f) || /(^|\/)tests?\//i.test(f));
      return { decisionText: d.text, pattern: d.pattern, ok: hasTest, reason: hasTest ? "test file present" : "no test file in commit", severity: hasTest ? "info" : "block" };
    }
    case "timing_safe_equal_required": {
      const diff = t.diffText || "";
      if (!/hmac|signature/i.test(diff)) return { decisionText: d.text, pattern: d.pattern, ok: true, reason: "no HMAC compare in diff", severity: "info" };
      const lines = diff.split("\n");
      const offending = lines.find((line) => /===|!==/.test(line) && /hmac|signature|\bsig\b/i.test(line));
      const usesTS = /timingSafeEqual\s*\(/i.test(diff);
      const ok = usesTS || !offending;
      return { decisionText: d.text, pattern: d.pattern, ok, reason: ok ? "OK" : "HMAC compared with === instead of timingSafeEqual", severity: ok ? "info" : "block" };
    }
    case "no_console_log": {
      const has = /\bconsole\.log\s*\(/i.test(t.diffText || "");
      return { decisionText: d.text, pattern: d.pattern, ok: !has, reason: has ? "console.log added" : "no console.log", severity: has ? "warn" : "info" };
    }
    case "no_direct_push_main": {
      const branch = (t.branch || "").toLowerCase();
      const onMain = branch === "main" || branch === "master";
      return { decisionText: d.text, pattern: d.pattern, ok: !onMain, reason: onMain ? "direct commit on " + branch : "branch ok", severity: onMain ? "block" : "info" };
    }
    case "has_hmac": {
      const has = /createHmac\s*\(/i.test(t.diffText || "");
      return { decisionText: d.text, pattern: d.pattern, ok: has, reason: has ? "HMAC primitive present" : "no HMAC", severity: has ? "info" : "warn" };
    }
    case "no_secret_in_code": {
      const diff = t.diffText || "";
      const patterns: RegExp[] = [/sk-(?:proj-)?[A-Za-z0-9_-]{16,}/, /-----BEGIN [A-Z ]+PRIVATE KEY-----/, /AKIA[0-9A-Z]{16}/, /\b(?:password|secret|api[_-]?key)\s*[:=]\s*["'][^"'\s]{8,}["']/i];
      for (const p of patterns) if (p.test(diff)) return { decisionText: d.text, pattern: d.pattern, ok: false, reason: "secret-shaped string", severity: "block" };
      return { decisionText: d.text, pattern: d.pattern, ok: true, reason: "ok", severity: "info" };
    }
    case "must_have_changelog": {
      const files = t.filesChanged || [];
      const has = files.some((f) => /CHANGELOG/i.test(f));
      return { decisionText: d.text, pattern: d.pattern, ok: has, reason: has ? "CHANGELOG touched" : "no CHANGELOG entry", severity: has ? "info" : "block" };
    }
    default:
      return { decisionText: d.text, pattern: d.pattern, ok: true, reason: "manual — skipped in retroactive scoring", severity: "info" };
  }
}

export function mineHistory(input: {
  commits: CommitRecord[];
  secret?: string;
}): MineReport {
  const ranAt = new Date().toISOString();
  const agreementsFound: BackdatedAgreement[] = [];
  const violations: ComplianceViolation[] = [];
  // Extract decisions per commit message + record as backdated agreement
  for (const c of input.commits) {
    const decs = extractDecisions({ transcript: c.message });
    // Only count NON-manual decisions for enforcement
    const auto = decs.filter((d) => d.pattern !== "manual");
    if (auto.length === 0) continue;
    const sourceSha256 = sha256(c.message);
    const agreementId = "rag-" + createHmac("sha256", "mneme-retroactive-id")
      .update(`${c.sha}|${sourceSha256}`)
      .digest("hex").slice(0, 14);
    const aBody: Omit<BackdatedAgreement, "sig"> = {
      v: PROTOCOL_VERSION,
      agreementId,
      sourceSha: c.sha,
      sourceTs: c.ts,
      decisions: auto,
      sourceSha256,
    };
    const aSig = hmac(aBody, input.secret ?? defaultSecret());
    agreementsFound.push({ ...aBody, sig: aSig });
  }
  // Walk forward: for each commit AFTER an agreement was proposed, check compliance.
  // Sort commits chronologically.
  const sorted = [...input.commits].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  for (const ag of agreementsFound) {
    const agreementTs = Date.parse(ag.sourceTs);
    for (const c of sorted) {
      // Skip the commit that PRODUCED the agreement — a commit doesn't violate
      // its own birth even if its filesChanged would technically miss the rule.
      if (c.sha === ag.sourceSha) continue;
      if (Date.parse(c.ts) <= agreementTs) continue; // only commits strictly after the agreement
      const target: CheckTarget = { filesChanged: c.filesChanged, diffText: c.diffText, ...(c.branch ? { branch: c.branch } : {}) };
      for (const d of ag.decisions) {
        const r = checkAgreementDecision(d, target);
        if (!r.ok && r.severity !== "info") {
          const violationId = "v-" + createHmac("sha256", "mneme-retroactive-violation-id")
            .update(`${ag.agreementId}|${c.sha}|${d.pattern}`)
            .digest("hex").slice(0, 14);
          const vBody: Omit<ComplianceViolation, "sig"> = {
            v: PROTOCOL_VERSION,
            violationId,
            agreementId: ag.agreementId,
            violatingCommitSha: c.sha,
            violatingCommitTs: c.ts,
            decisionText: d.text,
            pattern: d.pattern,
            severity: r.severity ?? "warn",
            reason: r.reason,
          };
          const vSig = hmac(vBody, input.secret ?? defaultSecret());
          violations.push({ ...vBody, sig: vSig });
        }
      }
    }
  }
  // Per-decision stats
  const perPattern = new Map<string, { total: number; violated: number }>();
  for (const ag of agreementsFound) {
    for (const d of ag.decisions) {
      const e = perPattern.get(d.pattern) ?? { total: 0, violated: 0 };
      e.total++;
      perPattern.set(d.pattern, e);
    }
  }
  for (const v of violations) {
    const e = perPattern.get(v.pattern);
    if (e) e.violated++;
  }
  const perDecisionStats = Array.from(perPattern.entries()).map(([pattern, { total, violated }]) => ({
    pattern,
    total,
    violated,
    rate: total === 0 ? 0 : Math.round((violated / total) * 1000) / 1000,
  }));

  const reportId = "rmine-" + createHmac("sha256", "mneme-retroactive-report-id")
    .update(`${ranAt}|${input.commits.length}|${agreementsFound.length}|${violations.length}`)
    .digest("hex").slice(0, 14);
  const rBody: Omit<MineReport, "sig"> = {
    v: PROTOCOL_VERSION,
    reportId,
    scannedCommits: input.commits.length,
    agreementsFound,
    violations,
    brokenPromiseCount: violations.filter((v) => v.severity === "block").length,
    perDecisionStats,
    ranAt,
  };
  const rSig = hmac(rBody, input.secret ?? defaultSecret());
  return { ...rBody, sig: rSig };
}

export function verifyReport(r: MineReport, secret?: string): boolean {
  const { sig, ...body } = r;
  return safeEqHex(hmac(body, secret ?? defaultSecret()), sig);
}

export function formatReportLine(r: MineReport): string {
  return `📜 RETROACTIVE · scanned ${r.scannedCommits} commits · found ${r.agreementsFound.length} agreements · ${r.brokenPromiseCount} broken promises`;
}
