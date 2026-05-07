/**
 * Markdown comment assembly for `mneme bot`.
 *
 * Pure data → string transform.  Takes the JSON-shaped outputs of one
 * or more analyzers and produces a single GitHub-Flavored Markdown
 * comment (also valid in GitLab and Bitbucket — all three platforms
 * accept GFM).
 *
 * Deterministic.  No I/O.  Stable ordering.  Easy to unit-test.
 */

import type { AuditCertificate, AxisVerdict } from "../audit/certify.js";

/** Subset of the atrophy repo-mode JSON we surface in the comment. */
export interface AtrophyAtRiskFile {
  filePath: string;
  totalTouches: number;
  tier: "safe" | "warn" | "at-risk";
  freshestKnowledge: number;
  allKnowers: Array<{
    name: string;
    email: string;
    knowledge: number;
    lastTouchDaysAgo: number;
    touchCount: number;
  }>;
}

export interface AtrophyReport {
  atRiskFiles: AtrophyAtRiskFile[];
  stats: {
    halfLifeDays: number;
    fileCount: number;
    filesWithLiveExpert: number;
    ghostedFiles: number;
    ghostedDeepFiles?: number;
  };
}

/** Subset of the ghost-code report we render. */
export interface GhostReport {
  hauntedFiles: Array<{
    filePath: string;
    score: number;
    reason: string;
    lastTouchDaysAgo: number;
  }>;
  totalCount: number;
}

/** Subset of the promise-debt ledger we render. */
export interface PromiseReport {
  open: number;
  kept: number;
  stale: number;
  topOpen: Array<{ author: string; promise: string; ageDays: number }>;
}

export interface CommentInput {
  /** Optional certify cert — if missing, the audit section is skipped. */
  audit?: AuditCertificate | null;
  atrophy?: AtrophyReport | null;
  ghost?: GhostReport | null;
  promise?: PromiseReport | null;
  /** Repo + commit context to render in the footer. */
  context?: {
    repo?: string;
    sha?: string;
    branch?: string;
  };
}

const VERDICT_ICON: Record<AxisVerdict, string> = {
  pass: "✅",
  warn: "⚠️",
  fail: "❌",
  skipped: "⊘",
};

/**
 * Render a single PR/MR comment.  Sections appear in a stable order
 * regardless of input ordering.
 */
export function formatComment(input: CommentInput): string {
  const lines: string[] = [];
  lines.push(...renderHeader(input.audit));
  lines.push("");

  if (input.audit) {
    lines.push(...renderAuditSection(input.audit));
    lines.push("");
  }
  if (input.atrophy && input.atrophy.atRiskFiles.length > 0) {
    lines.push(...renderAtrophySection(input.atrophy));
    lines.push("");
  }
  if (input.ghost && input.ghost.hauntedFiles.length > 0) {
    lines.push(...renderGhostSection(input.ghost));
    lines.push("");
  }
  if (input.promise && (input.promise.open > 0 || input.promise.topOpen.length > 0)) {
    lines.push(...renderPromiseSection(input.promise));
    lines.push("");
  }

  lines.push(renderFooter(input.context));
  // Collapse any accidental triple-blank-lines into doubles for compact output.
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// ─── header ──────────────────────────────────────────────────────────

function renderHeader(audit: AuditCertificate | null | undefined): string[] {
  if (!audit) {
    return [
      `## 🤖 Mneme — pull request scan`,
      "",
      `**Verdict: ✅ pass** · no audit certificate (run \`mneme audit --baseline\` once to enable the full 5-axis check)`,
    ];
  }
  const verdict = audit.overallVerdict;
  const icon = VERDICT_ICON[verdict];
  const axes = audit.axes;
  const totalAxes = 5 + 4; // 5 main + 4 forensic
  const greenCount = countGreen(audit);
  const contradictions = (axes.aiNarrative.checks ?? []).reduce(
    (sum, c) => sum + (c.verifications ?? []).filter((v) => v.verdict === "contradicted").length,
    0,
  );
  return [
    `## 🤖 Mneme audit · \`mneme audit --certify\``,
    "",
    `**Verdict: ${icon} ${verdict}** · ${greenCount}/${totalAxes} axes green · ${contradictions} contradiction${contradictions === 1 ? "" : "s"}`,
  ];
}

function countGreen(audit: AuditCertificate): number {
  let n = 0;
  if (audit.axes.behavioralParity.verdict === "pass") n++;
  if (audit.axes.apiContractDrift.verdict === "pass") n++;
  if (audit.axes.testPassRate.verdict === "pass") n++;
  if (audit.axes.perfRegression.verdict === "pass") n++;
  if (audit.axes.aiNarrative.verdict === "pass") n++;
  if (audit.forensicAxes.size.verdict === "pass") n++;
  if (audit.forensicAxes.files.verdict === "pass") n++;
  if (audit.forensicAxes.style.verdict === "pass") n++;
  if (audit.forensicAxes.time.verdict === "pass") n++;
  return n;
}

// ─── audit section ───────────────────────────────────────────────────

function renderAuditSection(audit: AuditCertificate): string[] {
  const lines: string[] = [];
  lines.push("<details>");
  lines.push("<summary><b>📊 5-axis breakdown</b></summary>");
  lines.push("");
  lines.push("| Axis | Verdict | Detail |");
  lines.push("|---|---|---|");
  lines.push(rowFor("🎯 Behavioral parity", audit.axes.behavioralParity));
  lines.push(rowFor("📐 API contract drift", audit.axes.apiContractDrift));
  const t = audit.axes.testPassRate;
  lines.push(
    `| ✅ Test pass rate | ${VERDICT_ICON[t.verdict]} ${t.verdict} | ${escapeMd(t.reason)} (${escapeMd(t.before)} → ${escapeMd(t.after)}) |`,
  );
  const p = audit.axes.perfRegression;
  lines.push(
    `| ⚡ Perf regression | ${VERDICT_ICON[p.verdict]} ${p.verdict} | ${escapeMd(p.reason)} (${p.deltaPercent}%) |`,
  );
  lines.push(rowFor("📰 AI narrative", audit.axes.aiNarrative));
  lines.push("");
  lines.push("</details>");
  return lines;
}

function rowFor(name: string, v: { verdict: AxisVerdict; reason: string }): string {
  return `| ${name} | ${VERDICT_ICON[v.verdict]} ${v.verdict} | ${escapeMd(v.reason)} |`;
}

// ─── atrophy section ─────────────────────────────────────────────────

function renderAtrophySection(report: AtrophyReport): string[] {
  const lines: string[] = [];
  lines.push("### ⏳ Knowledge atrophy — files at risk in this PR");
  lines.push("");
  for (const f of report.atRiskFiles.slice(0, 10)) {
    const pct = Math.round(f.freshestKnowledge * 100);
    const knower = f.allKnowers[0];
    if (knower) {
      const handle = mentionFromEmail(knower.email) ?? knower.name;
      lines.push(
        `- \`${escapeMd(f.filePath)}\` — top knower **${pct}% fresh** (last touched ${humanDays(knower.lastTouchDaysAgo)}) — request review from ${handle}`,
      );
    } else {
      lines.push(`- \`${escapeMd(f.filePath)}\` — **${pct}% fresh** · no live expert`);
    }
  }
  return lines;
}

// ─── ghost section ───────────────────────────────────────────────────

function renderGhostSection(report: GhostReport): string[] {
  const lines: string[] = [];
  lines.push("### 👻 Ghost code — half-finished or stale");
  lines.push("");
  for (const f of report.hauntedFiles.slice(0, 5)) {
    lines.push(
      `- \`${escapeMd(f.filePath)}\` — score ${f.score.toFixed(2)} · ${escapeMd(f.reason)} (last touch ${humanDays(f.lastTouchDaysAgo)})`,
    );
  }
  if (report.totalCount > 5) {
    lines.push(`- _…and ${report.totalCount - 5} more_`);
  }
  return lines;
}

// ─── promise section ─────────────────────────────────────────────────

function renderPromiseSection(report: PromiseReport): string[] {
  const lines: string[] = [];
  lines.push("### 🤝 Promise-debt — unkept follow-ups");
  lines.push("");
  lines.push(`Open: **${report.open}** · kept: **${report.kept}** · stale: **${report.stale}**`);
  lines.push("");
  for (const p of report.topOpen.slice(0, 5)) {
    lines.push(`- ${escapeMd(p.author)} — _“${escapeMd(truncate(p.promise, 100))}”_ (${p.ageDays}d ago)`);
  }
  return lines;
}

// ─── footer ──────────────────────────────────────────────────────────

function renderFooter(ctx: CommentInput["context"]): string {
  const bits: string[] = [];
  bits.push("Generated by [Mneme](https://github.com/patsa2561-art/mneme-ai)");
  if (ctx?.repo) bits.push(`repo \`${escapeMd(ctx.repo)}\``);
  if (ctx?.sha) bits.push(`sha \`${escapeMd(ctx.sha.slice(0, 7))}\``);
  bits.push("all data computed locally");
  return `<sub>${bits.join(" · ")}</sub>`;
}

// ─── helpers ─────────────────────────────────────────────────────────

/** Escape pipe chars + carriage returns so a single value can't break the table. */
export function escapeMd(s: string): string {
  return String(s ?? "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

export function humanDays(days: number): string {
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 14) return `${Math.round(days)}d ago`;
  if (days < 60) return `${Math.round(days / 7)}w ago`;
  if (days < 730) return `${Math.round(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

/**
 * Best-effort GitHub-style mention from an email.  Returns undefined if
 * we can't safely synthesize one — callers should fall back to the
 * author's name in that case.
 */
export function mentionFromEmail(email: string): string | undefined {
  if (!email || !email.includes("@")) return undefined;
  // GitHub no-reply addresses look like "12345+username@users.noreply.github.com" —
  // they DO encode the username, so we extract it before the generic noreply guard.
  const noreplyMatch = email.match(/[0-9]+\+([a-zA-Z0-9-]+)@users\.noreply\.github\.com/i);
  if (noreplyMatch) return `@${noreplyMatch[1]}`;
  // Bot / no-reply addresses → don't ping.
  if (/no(-?)reply/i.test(email)) return undefined;
  const localPart = email.split("@")[0]!;
  // Conservative: only synthesize for plausible single-token usernames.
  if (/^[a-zA-Z0-9-]{1,39}$/.test(localPart)) return `@${localPart}`;
  return undefined;
}
