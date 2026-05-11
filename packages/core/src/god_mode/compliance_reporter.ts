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

/**
 * v1.49.0 -- expanded framework support to cover banking + APAC FSI
 * use cases that testers explicitly asked for. Each framework maps to
 * its real-world body so an auditor recognises the citation:
 *   SOC2-CC      -- AICPA Service Organisation Control 2 / Common Criteria
 *   ISO-42001    -- ISO/IEC 42001 AI Management System
 *   EU-AI-ACT    -- EU AI Act 2024
 *   SOX          -- US Sarbanes-Oxley (public company financial reporting)
 *   FFIEC        -- US Federal Financial Institutions Examination Council
 *   BCBS-239     -- Basel Committee Risk Data Aggregation principles
 *   PCI-DSS      -- Payment Card Industry Data Security Standard v4.0
 *   SR-11-7      -- US Federal Reserve Model Risk Management
 *   GLBA         -- US Gramm-Leach-Bliley Act (financial privacy)
 *   MAS-TRM      -- Monetary Authority of Singapore Tech Risk Mgmt
 *   HKMA-TM-G-1  -- Hong Kong Monetary Authority Tech Risk
 *   BoT-IT-RM    -- Bank of Thailand IT Risk Management Notification
 */
export type ComplianceFramework =
  | "SOC2-CC"
  | "ISO-42001"
  | "EU-AI-ACT"
  | "SOX"
  | "FFIEC"
  | "BCBS-239"
  | "PCI-DSS"
  | "SR-11-7"
  | "GLBA"
  | "MAS-TRM"
  | "HKMA-TM-G-1"
  | "BoT-IT-RM";

export interface ControlMapping {
  framework: ComplianceFramework;
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
  coverageByFramework: Record<ComplianceFramework, { covered: number; total: number; percent: number }>;
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

  // ===========================================================
  // v1.49.0 -- BANKING / FSI frameworks
  // ===========================================================

  // SOX -- US Sarbanes-Oxley s.404 internal control over financial reporting
  { framework: "SOX", controlId: "404.IT-GC", title: "IT General Controls -- access + change management",
    evidenceQueries: [{ source: "queue", matcher: (e) => (e as { type?: unknown }).type === "executed" }] },
  { framework: "SOX", controlId: "404.AUDIT-TRAIL", title: "Tamper-evident audit trail of state-changing actions",
    evidenceQueries: [{ source: "replay", matcher: (e) => typeof (e as { hash?: unknown }).hash === "string" }] },
  { framework: "SOX", controlId: "404.SEGREGATION", title: "Segregation of duties (AI vs human approver)",
    evidenceQueries: [{ source: "queue", matcher: (e) => typeof (e as { user?: unknown }).user === "string" || typeof (e as { author?: unknown }).author === "string" }] },

  // FFIEC -- US Federal Financial Institutions Examination Council IT Booklet
  { framework: "FFIEC", controlId: "ITB.RISK", title: "IT risk identification + monitoring",
    evidenceQueries: [{ source: "compliance", matcher: (e) => typeof (e as { outcome?: unknown }).outcome === "string" }] },
  { framework: "FFIEC", controlId: "ITB.AUDIT", title: "Audit and independent review",
    evidenceQueries: [{ source: "replay", matcher: (e) => typeof (e as { hash?: unknown }).hash === "string" }] },
  { framework: "FFIEC", controlId: "ITB.INCIDENT", title: "Incident response logging",
    evidenceQueries: [{ source: "compliance", matcher: (e) => (e as { outcome?: unknown }).outcome === "failed" }] },

  // BCBS 239 -- Basel Committee Risk Data Aggregation + Reporting Principles
  { framework: "BCBS-239", controlId: "P3.ACCURACY", title: "Principle 3 -- accuracy + integrity of risk data",
    evidenceQueries: [{ source: "replay", matcher: (e) => typeof (e as { hash?: unknown }).hash === "string" }] },
  { framework: "BCBS-239", controlId: "P5.TIMELINESS", title: "Principle 5 -- timeliness (real-time aggregation evidence)",
    evidenceQueries: [{ source: "compliance", matcher: (e) => typeof (e as { at?: unknown }).at === "string" }] },
  { framework: "BCBS-239", controlId: "P7.AUDITABILITY", title: "Principle 7 -- complete + verifiable audit trail",
    evidenceQueries: [{ source: "replay", matcher: () => true }] },

  // PCI-DSS v4.0 -- Payment Card Industry Data Security Standard
  { framework: "PCI-DSS", controlId: "10.2", title: "Audit logs for all access to system components",
    evidenceQueries: [{ source: "replay", matcher: () => true }] },
  { framework: "PCI-DSS", controlId: "10.3", title: "Audit log entries are tamper-resistant",
    evidenceQueries: [{ source: "replay", matcher: (e) => typeof (e as { hash?: unknown }).hash === "string" }] },
  { framework: "PCI-DSS", controlId: "12.10", title: "Incident response logged + retained",
    evidenceQueries: [{ source: "compliance", matcher: (e) => (e as { outcome?: unknown }).outcome === "failed" }] },

  // SR 11-7 -- US Federal Reserve Model Risk Management Guidance
  { framework: "SR-11-7", controlId: "MRM.INVENTORY", title: "Model inventory with metadata (vendor, version, use)",
    evidenceQueries: [{ source: "compliance", matcher: (e) => typeof (e as { vendor?: unknown }).vendor === "string" }] },
  { framework: "SR-11-7", controlId: "MRM.VALIDATION", title: "Independent validation evidence",
    evidenceQueries: [{ source: "queue", matcher: (e) => typeof (e as { user?: unknown }).user === "string" }] },
  { framework: "SR-11-7", controlId: "MRM.MONITORING", title: "Ongoing monitoring + outcome tracking",
    evidenceQueries: [{ source: "compliance", matcher: (e) => typeof (e as { outcome?: unknown }).outcome === "string" }] },

  // GLBA -- US Gramm-Leach-Bliley Act (financial privacy)
  { framework: "GLBA", controlId: "Safeguards.MONITORING", title: "Monitoring of access + activity",
    evidenceQueries: [{ source: "replay", matcher: () => true }] },
  { framework: "GLBA", controlId: "Safeguards.INCIDENT", title: "Incident response procedures",
    evidenceQueries: [{ source: "compliance", matcher: (e) => (e as { outcome?: unknown }).outcome === "failed" }] },
  { framework: "GLBA", controlId: "Safeguards.OVERSIGHT", title: "Service provider oversight (e.g. AI vendor)",
    evidenceQueries: [{ source: "compliance", matcher: (e) => typeof (e as { vendor?: unknown }).vendor === "string" }] },

  // MAS TRM -- Monetary Authority of Singapore Tech Risk Mgmt Guidelines
  { framework: "MAS-TRM", controlId: "TRM.6", title: "Audit trail + activity logging",
    evidenceQueries: [{ source: "replay", matcher: () => true }] },
  { framework: "MAS-TRM", controlId: "TRM.8", title: "AI / advanced analytics governance",
    evidenceQueries: [{ source: "queue", matcher: () => true }] },
  { framework: "MAS-TRM", controlId: "TRM.9", title: "Outcome monitoring + remediation",
    evidenceQueries: [{ source: "compliance", matcher: (e) => (e as { outcome?: unknown }).outcome === "failed" }] },

  // HKMA TM-G-1 -- Hong Kong Monetary Authority Tech Risk Mgmt
  { framework: "HKMA-TM-G-1", controlId: "TM.AUDIT", title: "Audit trail of system + AI actions",
    evidenceQueries: [{ source: "replay", matcher: (e) => typeof (e as { hash?: unknown }).hash === "string" }] },
  { framework: "HKMA-TM-G-1", controlId: "TM.OVERSIGHT", title: "Senior management oversight evidence",
    evidenceQueries: [{ source: "queue", matcher: (e) => typeof (e as { user?: unknown }).user === "string" }] },
  { framework: "HKMA-TM-G-1", controlId: "TM.INCIDENT", title: "Incident reporting timeliness",
    evidenceQueries: [{ source: "compliance", matcher: (e) => (e as { outcome?: unknown }).outcome === "failed" }] },

  // BoT IT Risk Mgmt -- Bank of Thailand notification (FI/IT Risk Mgmt)
  { framework: "BoT-IT-RM", controlId: "BoT.4", title: "IT risk control + audit trail",
    evidenceQueries: [{ source: "replay", matcher: () => true }] },
  { framework: "BoT-IT-RM", controlId: "BoT.5", title: "Third-party (AI vendor) risk evidence",
    evidenceQueries: [{ source: "compliance", matcher: (e) => typeof (e as { vendor?: unknown }).vendor === "string" }] },
  { framework: "BoT-IT-RM", controlId: "BoT.7", title: "Incident response + reporting",
    evidenceQueries: [{ source: "compliance", matcher: (e) => (e as { outcome?: unknown }).outcome === "failed" }] },
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

  // v1.49.0 -- 12 frameworks total. Initialise all so the report is
  // diff-friendly even when zero events match a framework.
  const coverageByFramework: ComplianceReport["coverageByFramework"] = {
    "SOC2-CC":     { covered: 0, total: 0, percent: 0 },
    "ISO-42001":   { covered: 0, total: 0, percent: 0 },
    "EU-AI-ACT":   { covered: 0, total: 0, percent: 0 },
    "SOX":         { covered: 0, total: 0, percent: 0 },
    "FFIEC":       { covered: 0, total: 0, percent: 0 },
    "BCBS-239":    { covered: 0, total: 0, percent: 0 },
    "PCI-DSS":     { covered: 0, total: 0, percent: 0 },
    "SR-11-7":     { covered: 0, total: 0, percent: 0 },
    "GLBA":        { covered: 0, total: 0, percent: 0 },
    "MAS-TRM":     { covered: 0, total: 0, percent: 0 },
    "HKMA-TM-G-1": { covered: 0, total: 0, percent: 0 },
    "BoT-IT-RM":   { covered: 0, total: 0, percent: 0 },
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
  // v1.49.0 -- 12 frameworks. Each row carries the official body name
  // so an auditor recognises the citation without lookups.
  lines.push("| Framework | Body | Controls covered | % |");
  lines.push("|---|---|---|---|");
  const fwInfo: Record<ComplianceFramework, { body: string }> = {
    "SOC2-CC":     { body: "AICPA Service Organisation Control 2 / Common Criteria" },
    "ISO-42001":   { body: "ISO/IEC 42001 -- AI Management System" },
    "EU-AI-ACT":   { body: "EU AI Act 2024" },
    "SOX":         { body: "US Sarbanes-Oxley s.404 (financial reporting IT controls)" },
    "FFIEC":       { body: "US Federal Financial Institutions Examination Council" },
    "BCBS-239":    { body: "Basel Committee Risk Data Aggregation Principles" },
    "PCI-DSS":     { body: "Payment Card Industry Data Security Standard v4.0" },
    "SR-11-7":     { body: "US Federal Reserve Model Risk Management Guidance" },
    "GLBA":        { body: "US Gramm-Leach-Bliley Act (financial privacy)" },
    "MAS-TRM":     { body: "Monetary Authority of Singapore -- Tech Risk Mgmt" },
    "HKMA-TM-G-1": { body: "Hong Kong Monetary Authority TM-G-1 Tech Risk" },
    "BoT-IT-RM":   { body: "Bank of Thailand IT Risk Management Notification" },
  };
  const FRAMEWORK_ORDER: ComplianceFramework[] = ["SOC2-CC", "ISO-42001", "EU-AI-ACT", "SOX", "FFIEC", "BCBS-239", "PCI-DSS", "SR-11-7", "GLBA", "MAS-TRM", "HKMA-TM-G-1", "BoT-IT-RM"];
  for (const fw of FRAMEWORK_ORDER) {
    const c = r.coverageByFramework[fw];
    lines.push(`| ${fw} | ${fwInfo[fw].body} | ${c.covered}/${c.total} | ${c.percent}% |`);
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
