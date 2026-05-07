/**
 * Sidebar tree provider — three lazily-populated sections:
 *   🛡 Audit            — last verdict (or "build a baseline first")
 *   ⏳ At-risk files    — top 5 critical files from atrophy
 *   👤 My passport      — current author + headline knowledge stats
 *
 * Pure data → tree-item formatting lives in `buildItems`, which is
 * exported for unit tests. Vscode-specific types are kept inside the
 * actual provider class so we can compile/test the data layer in node.
 */

import type { AuditCertificate, AtrophyReport } from "@mneme-ai/core/public";

export interface PassportLike {
  /** Author name (display). */
  name: string;
  /** Author email. */
  email: string;
  /** 0..∞ — sum of every file knowledge_score the author still owns. */
  knowledgeMass?: number;
  /** Sample of expertise files, knowledge desc. */
  topFiles?: Array<{ filePath: string; knowledge?: number }>;
}

export interface SidebarReportData {
  hasDb: boolean;
  hasBaseline: boolean;
  certificate: AuditCertificate | null;
  atrophy: AtrophyReport | null;
  passport: PassportLike | null;
}

export type ItemKind =
  | "section"
  | "audit-status"
  | "audit-empty"
  | "atrophy-empty"
  | "atrophy-file"
  | "passport-empty"
  | "passport-summary"
  | "passport-file"
  | "no-db"
  | "info";

export interface TreeItemModel {
  /** Visible label. */
  label: string;
  /** Subtle right-aligned text — second-line in plain English. */
  description?: string;
  /** Hover/markdown tooltip. */
  tooltip?: string;
  /** Identifies what kind of node this is — drives icon + click behaviour. */
  kind: ItemKind;
  /** True when the user can click to drill in. */
  collapsibleState: "none" | "collapsed" | "expanded";
  /** Children (may be empty). */
  children?: TreeItemModel[];
  /** When set, clicking this item opens a file via `vscode.open`. */
  fileToOpen?: string;
  /** When set, clicking this item runs a command. */
  commandId?: string;
}

/**
 * Pure formatter — takes a SidebarReportData and produces a tree
 * model. Caller maps it into `vscode.TreeItem` shapes.
 */
export function buildItems(data: SidebarReportData): TreeItemModel[] {
  if (!data.hasDb) {
    return [
      {
        kind: "no-db",
        label: "No Mneme index here yet",
        description: "Run `mneme index` first",
        collapsibleState: "none",
        tooltip:
          "Mneme needs a SQLite cache at .mneme/mneme.db before it can answer questions. Run `mneme index` from your repo root to build one.",
      },
    ];
  }

  return [
    auditSection(data),
    atRiskSection(data),
    passportSection(data),
  ];
}

function auditSection(data: SidebarReportData): TreeItemModel {
  const children: TreeItemModel[] = [];
  if (!data.hasBaseline) {
    children.push({
      kind: "audit-empty",
      label: "No baseline yet",
      description: "run `mneme audit --baseline` before your AI works",
      collapsibleState: "none",
      tooltip:
        "Capture a snapshot BEFORE letting an AI tool change the repo. Mneme uses it to verify post-session reality.",
    });
  } else if (data.certificate) {
    const cert = data.certificate;
    const verdict = cert.overallVerdict;
    const label =
      verdict === "pass"
        ? "Last audit: pass — AI claims line up with reality"
        : verdict === "warn"
          ? "Last audit: warn — review one or more axes"
          : "Last audit: fail — AI narrative contradicted the diff";
    children.push({
      kind: "audit-status",
      label,
      description: cert.capturedAt?.slice(0, 10) ?? "",
      collapsibleState: "none",
      commandId: "mneme.audit",
      tooltip:
        "5 axes graded: behavioural parity, API contract drift, tests, perf, AI narrative.",
    });
  } else {
    children.push({
      kind: "audit-empty",
      label: "Baseline ready — no certificate yet",
      description: "run `mneme audit --certify` after AI changes",
      collapsibleState: "none",
      commandId: "mneme.audit",
    });
  }

  return {
    kind: "section",
    label: "🛡 Audit",
    collapsibleState: "expanded",
    children,
  };
}

function atRiskSection(data: SidebarReportData): TreeItemModel {
  const children: TreeItemModel[] = [];
  const files = (data.atrophy?.atRiskFiles ?? []).slice(0, 5);
  if (files.length === 0) {
    children.push({
      kind: "atrophy-empty",
      label: "Nothing at risk — all files have a live expert",
      collapsibleState: "none",
    });
  } else {
    for (const f of files) {
      const top = f.allKnowers?.[0];
      const pct = Math.round((f.freshestKnowledge ?? 0) * 100);
      const tierWord = f.tier === "at-risk" ? "ghost-risk" : f.tier;
      const description =
        top != null
          ? `top knower ${pct}% fresh — ${top.name}`
          : `top knower ${pct}% fresh`;
      children.push({
        kind: "atrophy-file",
        label: f.filePath,
        description,
        tooltip: `${tierWord} · ${f.totalTouches} total touches`,
        collapsibleState: "none",
        fileToOpen: f.filePath,
      });
    }
  }
  return {
    kind: "section",
    label: "⏳ At-risk files",
    collapsibleState: "expanded",
    children,
  };
}

function passportSection(data: SidebarReportData): TreeItemModel {
  const children: TreeItemModel[] = [];
  const p = data.passport;
  if (!p) {
    children.push({
      kind: "passport-empty",
      label: "No author detected",
      description: "set `git config user.email` to load your passport",
      collapsibleState: "none",
    });
  } else {
    const massRaw = p.knowledgeMass;
    const massStr =
      typeof massRaw === "number" && Number.isFinite(massRaw)
        ? massRaw.toFixed(1)
        : "—";
    children.push({
      kind: "passport-summary",
      label: `${p.name || p.email} — knowledge mass ${massStr}`,
      description: "click to open passport detail",
      collapsibleState: "none",
      commandId: "mneme.nervousSystem",
      tooltip:
        "Knowledge mass = sum of every file score this author still owns. Higher = broader living memory.",
    });
    for (const f of (p.topFiles ?? []).slice(0, 3)) {
      const pct =
        typeof f.knowledge === "number" ? Math.round(f.knowledge * 100) : null;
      children.push({
        kind: "passport-file",
        label: f.filePath,
        description: pct != null ? `${pct}% fresh` : undefined,
        collapsibleState: "none",
        fileToOpen: f.filePath,
      });
    }
  }
  return {
    kind: "section",
    label: "👤 My passport",
    collapsibleState: "expanded",
    children,
  };
}
