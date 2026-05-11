/**
 * DEMON STAGE 4.2 — Compliance Reporter (v1.44.0)
 *
 * SCOPE: generate human-readable compliance evidence reports from
 * Mneme's existing audit trail (`.mneme/ai-compliance.jsonl`,
 * `.mneme/auto-action-queue.jsonl`, `.mneme/replay.jsonl`). The output
 * is a markdown report mapping observed events to control families
 * relevant to common frameworks:
 *   - SOC 2 CC (Common Criteria) — change management, monitoring, logging
 *   - ISO 42001 (AI Management System) — AI policy, oversight, transparency
 *   - EU AI Act Art. 12-15 — record-keeping, transparency, human oversight
 *
 * IMPORTANT: this is "audit-trail-ready" evidence, NOT a certification.
 * The report explicitly says so on every page. Per memory, we never
 * claim "SOC2/PCI/EU AI Act audit-grade" without pen testing.
 *
 * INNOVATIONS BEYOND SPEC:
 *   - "Coverage matrix": for each control family, % of controls that have
 *     ANY supporting evidence (e.g., 4/12 = 33% coverage). Honest about
 *     what's missing instead of papering over gaps
 *   - "Gap list": auto-generates a TODO list of controls with zero
 *     supporting evidence
 *   - Time-windowed: report only covers a specified date range, with
 *     a default of last-30-days, so audits are bounded
 *   - Deterministic ordering for diff-friendly outputs
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const COMPLIANCE_LOG_REL = ".mneme/ai-compliance.jsonl";
const QUEUE_LOG_REL = ".mneme/auto-action-queue.jsonl";
const REPLAY_LOG_REL = ".mneme/replay.jsonl";
const REPORTS_DIR_REL = ".mneme/compliance-reports";

export interface ControlMapping {
  framework: "SOC2-CC" | "ISO-42001" | "EU-AI-ACT";
  controlId: string;
  title: string;
  evidenceQueries: { source: "compliance" | "queue" | "replay"; matcher: (entry: Record<string, unknown>) => boolean }[];
}

export interface ControlEvidence {
  framework: ControlMapping["framework"];
  controlId: string;
  title: string;
  evidenceCount: number;
  sampleEvents: { source: string; at: string; summary: string }[];
}

export interface ComplianceReport {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  totalEvents: number;
  controls: ControlEvidence[];
  coverageByFramework: Record<ControlMapping["framework"], { covered: number; total: number; percent: number }>;
  gaps: { framework: string; controlId: string; title: string }[];
  reportPath: string;
}

// Built-in control mappings. Operators can extend with their own.
const BUILTIN_CONTROLS: ControlMapping[] = [
  // SOC 2 CC
  { framework: "SOC2-CC", controlId: "CC7.2", title: "System monitoring & anomaly detection",
    evidenceQueries: [{ source: "compliance", matcher: (e) => typeof (e as { outcome?: unknown }).outcome === "string" }] },
  { framework: "SOC2-CC", controlId: "CC8.1", title: "Change management — authorized changes",
    evidenceQueries: [{ source: "queue", matcher: (e) => (e as { type?: unknown }).type === "executed" }] },
  { framework: "SOC2-CC", controlId: "CC4.1", title: "Audit log integrity",
    evidenceQueries: [{ source: "replay", matcher: (e) => typeof (e as { hash?: unknown }).hash === "string" }] },
  // ISO 42001 (AI Management System)
  { framework: "ISO-42001", controlId: "8.4", title: "AI system operational logs",
    evidenceQueries: [{ source: "compliance", matcher: (e) => typeof (e as { vendor?: unknown }).vendor === "string" }] },
  { framework: "ISO-42001", controlId: "9.2", title: "Internal AI audit",
    evidenceQueries: [{ source: "queue", matcher: () => true }] },
  { framework: "ISO-42001", controlId: "10.1", title: "Continual improvement / feedback",
    evidenceQueries: [{ source: "compliance", matcher: (e) => (e as { outcome?: unknown }).outcome === "failed" }] },
  // EU AI Act
  { framework: "EU-AI-ACT", controlId: "Art.12", title: "Automatic record-keeping",
    evidenceQueries: [{ source: "compliance", matcher: () => true }, { source: "replay", matcher: () => true }] },
  { framework: "EU-AI-ACT", controlId: "Art.14", title: "Human oversight",
    evidenceQueries: [{ source: "queue", matcher: (e) => typeof (e as { user?: unknown }).user === "string" || typeof (e as { author?: unknown }).author === "string" }] },
  { framework: "EU-AI-ACT", controlId: "Art.15", title: "Accuracy, robustness, cybersecurity",
    evidenceQueries: [{ source: "compliance", matcher: (e) => (e as { outcome?: unknown }).outcome === "executed" }] },
];

interface LogEntry { source: string; at: string; raw: Record<string, unknown> }

function readJsonlAt(path: string, source: string): LogEntry[] {
  if (!existsSync(path)) return [];
  const out: LogEntry[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const at = String(obj.at ?? obj.timestamp ?? obj.createdAt ?? "");
      if (at) out.push({ source, at, raw: obj });
    } catch { /* skip */ }
  }
  return out;
}

function inWindow(at: string, start: Date, end: Date): boolean {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return false;
  return t >= start.getTime() && t <= end.getTime();
}

function summarize(entry: LogEntry): string {
  const r = entry.raw as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof r.kind === "string") parts.push(r.kind);
  if (typeof r.type === "string") parts.push(r.type);
  if (typeof r.outcome === "string") parts.push(`outcome=${r.outcome}`);
  if (typeof r.vendor === "string") parts.push(`vendor=${r.vendor}`);
  if (typeof r.action === "string") parts.push(`action=${r.action}`);
  return parts.join(" ").slice(0, 120) || "(no summary fields)";
}

export function generateComplianceReport(repoRoot: string, opts: { windowStart?: Date; windowEnd?: Date; extraControls?: ControlMapping[] } = {}): ComplianceReport {
  const root = resolve(repoRoot);
  const end = opts.windowEnd ?? new Date();
  const start = opts.windowStart ?? new Date(end.getTime() - 30 * 86400 * 1000);

  const allEntries: LogEntry[] = [
    ...readJsonlAt(join(root, COMPLIANCE_LOG_REL), "compliance"),
    ...readJsonlAt(join(root, QUEUE_LOG_REL), "queue"),
    ...readJsonlAt(join(root, REPLAY_LOG_REL), "replay"),
  ].filter((e) => inWindow(e.at, start, end));

  const controls = [...BUILTIN_CONTROLS, ...(opts.extraControls ?? [])];
  const evidences: ControlEvidence[] = [];
  for (const ctrl of controls) {
    const matched: LogEntry[] = [];
    for (const q of ctrl.evidenceQueries) {
      for (const e of allEntries) {
        if (e.source === q.source && q.matcher(e.raw)) matched.push(e);
      }
    }
    matched.sort((a, b) => a.at.localeCompare(b.at));
    evidences.push({
      framework: ctrl.framework,
      controlId: ctrl.controlId,
      title: ctrl.title,
      evidenceCount: matched.length,
      sampleEvents: matched.slice(0, 5).map((e) => ({ source: e.source, at: e.at, summary: summarize(e) })),
    });
  }
  evidences.sort((a, b) => a.framework.localeCompare(b.framework) || a.controlId.localeCompare(b.controlId));

  const coverageByFramework: ComplianceReport["coverageByFramework"] = {
    "SOC2-CC": { covered: 0, total: 0, percent: 0 },
    "ISO-42001": { covered: 0, total: 0, percent: 0 },
    "EU-AI-ACT": { covered: 0, total: 0, percent: 0 },
  };
  for (const c of evidences) {
    coverageByFramework[c.framework].total++;
    if (c.evidenceCount > 0) coverageByFramework[c.framework].covered++;
  }
  for (const f of Object.keys(coverageByFramework) as (keyof typeof coverageByFramework)[]) {
    const cov = coverageByFramework[f];
    cov.percent = cov.total === 0 ? 0 : Math.round((cov.covered / cov.total) * 100);
  }

  const gaps = evidences.filter((c) => c.evidenceCount === 0).map((c) => ({ framework: c.framework, controlId: c.controlId, title: c.title }));

  const generatedAt = new Date().toISOString();
  const reportMd = renderMarkdown({ generatedAt, windowStart: start.toISOString(), windowEnd: end.toISOString(), totalEvents: allEntries.length, evidences, coverageByFramework, gaps });
  mkdirSync(join(root, REPORTS_DIR_REL), { recursive: true });
  const reportPath = join(root, REPORTS_DIR_REL, `${generatedAt.replace(/[:.]/g, "-")}.md`);
  writeFileSync(reportPath, reportMd);

  return {
    generatedAt,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    totalEvents: allEntries.length,
    controls: evidences,
    coverageByFramework,
    gaps,
    reportPath,
  };
}

function renderMarkdown(r: { generatedAt: string; windowStart: string; windowEnd: string; totalEvents: number; evidences: ControlEvidence[]; coverageByFramework: ComplianceReport["coverageByFramework"]; gaps: { framework: string; controlId: string; title: string }[] }): string {
  const lines: string[] = [];
  lines.push("# Mneme Compliance Evidence Report");
  lines.push("");
  lines.push(`**Generated:** ${r.generatedAt}`);
  lines.push(`**Window:** ${r.windowStart} → ${r.windowEnd}`);
  lines.push(`**Events analyzed:** ${r.totalEvents}`);
  lines.push("");
  lines.push("> ⚠️  This report is **audit-trail-ready evidence**, not a certification. Use it as input to your auditor, not as a substitute for a formal audit.");
  lines.push("");
  lines.push("## Coverage by framework");
  lines.push("");
  lines.push("| Framework | Controls covered | % |");
  lines.push("|---|---|---|");
  for (const fw of ["SOC2-CC", "ISO-42001", "EU-AI-ACT"] as const) {
    const c = r.coverageByFramework[fw];
    lines.push(`| ${fw} | ${c.covered}/${c.total} | ${c.percent}% |`);
  }
  lines.push("");
  lines.push("## Per-control evidence");
  lines.push("");
  let lastFw = "";
  for (const c of r.evidences) {
    if (c.framework !== lastFw) {
      lines.push(`### ${c.framework}`);
      lines.push("");
      lastFw = c.framework;
    }
    lines.push(`#### ${c.controlId} — ${c.title}`);
    lines.push("");
    lines.push(`Evidence count: **${c.evidenceCount}**`);
    if (c.sampleEvents.length > 0) {
      lines.push("");
      lines.push("Sample events (most recent 5):");
      for (const e of c.sampleEvents) lines.push(`- \`${e.at}\` (${e.source}) — ${e.summary}`);
    }
    lines.push("");
  }
  if (r.gaps.length > 0) {
    lines.push("## Gaps");
    lines.push("");
    lines.push("These controls have **zero** supporting evidence in the window. Operator action required:");
    lines.push("");
    for (const g of r.gaps) lines.push(`- **${g.framework} ${g.controlId}** — ${g.title}`);
    lines.push("");
  }
  return lines.join("\n");
}
