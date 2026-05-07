/**
 * Status bar item — single badge with the latest audit verdict.
 *
 * Click → triggers `mneme.audit` (the certify command). This is meant
 * to feel like the lint/test status bar items the user already trusts:
 * a tiny green tick when their AI session passes, a red X when it
 * doesn't.
 */

import type { AuditCertificate } from "@mneme-ai/core/public";
import { verdictText } from "../util/iconText.js";

export type StatusVerdict = "pass" | "warn" | "fail" | "idle";

export interface StatusBadge {
  /** Inline-icon-prefixed text, e.g. "$(check) Mneme · pass". */
  text: string;
  /** Markdown tooltip explaining the verdict. */
  tooltip: string;
  /** Theme color name for the badge background, or undefined for default. */
  backgroundColor?: string;
}

/**
 * Pure formatter — caller binds it to a vscode.StatusBarItem.
 */
export function formatVerdict(cert: AuditCertificate | null | undefined): StatusBadge {
  if (!cert) {
    return {
      text: verdictText("idle"),
      tooltip:
        "Mneme: no audit run yet — capture a baseline with `mneme audit --baseline`, then certify after AI changes.",
    };
  }

  const verdict: StatusVerdict =
    cert.overallVerdict === "pass" || cert.overallVerdict === "warn" || cert.overallVerdict === "fail"
      ? cert.overallVerdict
      : "idle";

  const bg =
    verdict === "fail"
      ? "statusBarItem.errorBackground"
      : verdict === "warn"
        ? "statusBarItem.warningBackground"
        : undefined;

  const tooltip =
    verdict === "pass"
      ? "Mneme audit: pass — AI claims line up with the diff. Click to re-run."
      : verdict === "warn"
        ? "Mneme audit: warn — review at least one axis. Click to re-run."
        : verdict === "fail"
          ? "Mneme audit: fail — AI narrative contradicted reality. Click to re-run."
          : "Mneme: no audit run yet. Click to run.";

  return {
    text: verdictText(verdict),
    tooltip,
    backgroundColor: bg,
  };
}
