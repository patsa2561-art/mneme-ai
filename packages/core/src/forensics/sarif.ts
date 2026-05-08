/**
 * SARIF v2.1.0 writer for vulnerability findings.
 *
 * SARIF (Static Analysis Results Interchange Format) is the OASIS standard
 * that GitHub Code Scanning, GitLab Vulnerability Reports, Microsoft Defender
 * for Cloud, and most modern security tooling consume. Emitting it lets the
 * customer pipe Mneme findings into the same dashboards their existing
 * scanners feed without writing a custom integration.
 *
 * Spec reference: https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
 */
import type { VulnHit, VulnHuntReport } from "./vulnhunt.js";

export interface SarifOptions {
  /** Tool version (e.g. "0.37.0"). */
  toolVersion?: string;
  /** Repo URI used for artifact resolution (e.g. "github.com/org/repo"). */
  repoUri?: string;
}

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription: { text: string };
  helpUri?: string;
  defaultConfiguration: { level: "none" | "note" | "warning" | "error" };
  properties: { tags: string[]; precision: "very-high" | "high" | "medium" | "low" };
}

const SEVERITY_TO_LEVEL: Record<VulnHit["severity"], "none" | "note" | "warning" | "error"> = {
  info: "note",
  low: "note",
  medium: "warning",
  high: "warning",
  critical: "error",
};

export function buildSarif(report: VulnHuntReport, opts: SarifOptions = {}): unknown {
  const seenRuleIds = new Set<string>();
  const rules: SarifRule[] = [];
  for (const hit of report.hits) {
    if (seenRuleIds.has(hit.rule)) continue;
    seenRuleIds.add(hit.rule);
    rules.push({
      id: hit.rule,
      name: kebabToPascal(hit.rule),
      shortDescription: { text: hit.summary },
      fullDescription: { text: hit.summary },
      helpUri: hit.reference.startsWith("CWE-")
        ? `https://cwe.mitre.org/data/definitions/${hit.reference.replace("CWE-", "")}.html`
        : undefined,
      defaultConfiguration: { level: SEVERITY_TO_LEVEL[hit.severity] },
      properties: {
        tags: ["security", hit.class],
        precision: hit.posterior >= 0.7 ? "high" : hit.posterior >= 0.5 ? "medium" : "low",
      },
    });
  }

  const results = report.hits.map((hit) => sarifResult(hit, opts));

  return {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "mneme-ai",
            version: opts.toolVersion ?? "0.0.0",
            informationUri: "https://github.com/patsa2561-art/mneme-ai",
            rules,
            properties: {
              stack: report.stack,
              minPosterior: report.minPosterior,
              dropped: report.dropped,
              silenced: report.silenced.length,
            },
          },
        },
        results,
      },
    ],
  };
}

function sarifResult(hit: VulnHit, opts: SarifOptions): unknown {
  return {
    ruleId: hit.rule,
    level: SEVERITY_TO_LEVEL[hit.severity],
    message: {
      text:
        `${hit.summary} (commit ${hit.commit.hash.slice(0, 7)}, posterior ${hit.posterior.toFixed(2)}; ` +
        `prior ${hit.prior.toFixed(2)} × evidence ${hit.evidenceScore.toFixed(2)} — ${hit.evidenceContext}).`,
    },
    locations: hit.filePath
      ? [
          {
            physicalLocation: {
              artifactLocation: {
                uri: hit.filePath,
                uriBaseId: "%SRCROOT%",
              },
              region: hit.line ? { startLine: hit.line } : undefined,
              contextRegion: { snippet: { text: hit.evidence } },
            },
          },
        ]
      : [],
    partialFingerprints: { primaryLocationLineHash: hit.id },
    properties: {
      commit: hit.commit.hash,
      commitUrl:
        opts.repoUri && opts.repoUri.startsWith("http")
          ? `${opts.repoUri.replace(/\/$/, "")}/commit/${hit.commit.hash}`
          : undefined,
      reference: hit.reference,
      posterior: hit.posterior,
      prior: hit.prior,
      evidenceScore: hit.evidenceScore,
      evidenceContext: hit.evidenceContext,
      evidenceReason: hit.evidenceReason,
    },
  };
}

function kebabToPascal(s: string): string {
  return s.split(/[-_]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
}
