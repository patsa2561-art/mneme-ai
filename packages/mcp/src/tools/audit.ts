/**
 * AI Session Audit — the trust certificate for every AI-driven commit.
 *
 * Vendor-neutral. Works against any AI tool whose commits land in `git log`.
 * Each tool here is a different "mode" of the audit pipeline.
 */

import { runCliJson } from "./_runtime.js";
import type { MnemeTool } from "./_types.js";

export const auditTools: MnemeTool[] = [
  {
    name: "mneme.audit.baseline",
    category: "audit",
    description:
      "Snapshot the repo's behavior, types, perf, and sample-command outputs BEFORE letting an AI work on it. " +
      "Stores the snapshot in .mneme/audit-baseline.json for later certify-time comparison. " +
      "Use this WHEN: user is about to start an AI-driven coding session and wants a 'before' snapshot to grade against.",
    triggers: [
      "snapshot before AI works",
      "audit baseline",
      "เก็บ baseline ก่อน AI ทำงาน",
    ],
    inputSchema: { type: "object", properties: {} },
    handler: async (rt) => {
      const data = await runCliJson(rt.meta.rootPath, "audit", ["--baseline"]);
      return {
        data,
        wisdom: "Baseline captured. Ask user to let their AI work, then run mneme.audit.certify when done to compare.",
        followUp: ["mneme.audit.trace", "mneme.audit.certify"],
        confidence: { level: "high" },
      };
    },
  },
  {
    name: "mneme.audit.trace",
    category: "audit",
    description:
      "After AI worked: capture the diff + detect WHICH AI tool produced the commit (Claude Code · Cursor · Codex · Devin · ...). " +
      "Use this WHEN user asks: 'what did the AI just change?', 'which AI tool wrote this commit?', 'show me the AI session trace'.",
    triggers: [
      "what did the AI change?",
      "which AI tool wrote this?",
      "audit trace",
    ],
    inputSchema: { type: "object", properties: {} },
    handler: async (rt) => {
      const data = await runCliJson(rt.meta.rootPath, "audit", ["--trace"]);
      return {
        data,
        wisdom: "Trace captured. Use mneme.audit.verify next to check whether the AI's commit message matches the actual diff.",
        followUp: ["mneme.audit.verify", "mneme.audit.certify"],
        confidence: { level: "high" },
      };
    },
  },
  {
    name: "mneme.audit.verify",
    category: "audit",
    description:
      "Leviathan-style narrative-vs-reality check: does the AI's commit message ACTUALLY match the diff? " +
      "Catches AI gaslighting (e.g. 'no change to db.ts' but the diff has 3 lines in db.ts). " +
      "Use this WHEN user asks: 'is the AI lying about its changes?', 'verify the commit narrative', 'AI gaslight check'.",
    triggers: [
      "is the AI lying?",
      "verify commit narrative",
      "AI gaslight check",
    ],
    inputSchema: { type: "object", properties: {} },
    handler: async (rt) => {
      const data = await runCliJson(rt.meta.rootPath, "audit", ["--verify"]);
      return {
        data,
        wisdom: "Verification complete. If contradictions are found, escalate to mneme.audit.certify for the full trust certificate.",
        followUp: ["mneme.audit.certify"],
        confidence: { level: "high" },
      };
    },
  },
  {
    name: "mneme.audit.certify",
    category: "audit",
    description:
      "The flagship: 5-axis trust certificate for an AI commit (behavioral parity · API contract · test pass rate · perf · narrative match). " +
      "Plus forensic axes (TIME / FILES / STYLE / SIZE). Returns PASS / WARN / FAIL with structured findings. " +
      "Use this WHEN user asks: 'is this commit safe?', 'grade the AI's homework', 'CI gate the AI commit', " +
      "'final trust certificate', 'should I merge this?'.",
    whenToUse:
      "Final gate before merging an AI-written commit — get a 5-axis trust verdict with structured findings.",
    triggers: [
      "grade the AI commit",
      "is this commit safe to merge?",
      "trust certificate",
      "audit certify",
    ],
    inputSchema: {
      type: "object",
      properties: {
        explain: { type: "boolean", description: "Add plain-English narrative summary" },
        strict: { type: "boolean", description: "Treat skipped axes as fail (compliance mode)" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        verdict: { type: "string", enum: ["PASS", "WARN", "FAIL"] },
        score: { type: "number", description: "Composite score 0-100 across all axes." },
        axes: {
          type: "object",
          description: "Per-axis verdicts (behavioral, contract, tests, perf, narrative + forensic axes).",
        },
        findings: { type: "array", items: { type: "object" } },
      },
    },
    examples: [
      {
        userQuery: "Should I merge this AI-written commit?",
        args: { explain: true },
        expectedOutput:
          "Returns { verdict: 'PASS' | 'WARN' | 'FAIL', score: 0-100, axes: { behavioral, contract, tests, perf, narrative, time, files, style, size }, findings: [...] }. With explain=true, also includes a plain-English narrative.",
      },
      {
        userQuery: "Strict CI gate for our compliance pipeline",
        args: { strict: true },
        expectedOutput: "Same as above but ANY skipped axis (e.g., perf if no perf baseline) flips the verdict to FAIL.",
      },
    ],
    pitfalls: [
      "Requires a baseline snapshot — run mneme.audit.baseline BEFORE the AI starts working, or behavioral/perf axes will be SKIPPED.",
      "strict=true is recommended for CI; in interactive use, prefer explain=true and read the narrative.",
      "FAIL verdicts are not vetoes — they're hypotheses. The forensic axes (TIME/FILES/STYLE) can produce false positives on legitimate refactors.",
    ],
    composeWith: [
      "mneme.audit.baseline",
      "mneme.audit.trace",
      "mneme.audit.verify",
      "mneme.audit.report",
      "mneme.audit.conscience",
    ],
    handler: async (rt, args) => {
      const cliArgs = ["--certify"];
      if (args["explain"]) cliArgs.push("--explain");
      if (args["strict"]) cliArgs.push("--strict");
      const data = await runCliJson(rt.meta.rootPath, "audit", cliArgs);
      const verdict = (data as { verdict?: string })?.verdict ?? "unknown";
      const wisdom =
        verdict === "PASS"
          ? "AI commit PASSED all 5 axes — safe to merge."
          : verdict === "WARN"
          ? "AI commit has WARNINGS — review the flagged axes before merging."
          : verdict === "FAIL"
          ? "AI commit FAILED — do NOT merge until issues are resolved. See findings array for details."
          : "Audit completed; check the data field for the verdict.";
      return {
        data,
        wisdom,
        followUp: verdict !== "PASS" ? ["mneme.audit.report", "mneme.forensics.vulns"] : [],
        confidence: { level: "high" },
      };
    },
  },
  {
    name: "mneme.audit.report",
    category: "audit",
    description:
      "Generate a Markdown audit-trail report (SOX / SOC2 / EU AI Act 2026 compliant) of the most recent AI session. " +
      "Use this WHEN user asks: 'export audit report', 'compliance trail', 'markdown for the auditor'.",
    triggers: [
      "compliance audit report",
      "markdown audit trail",
      "export for SOC2",
    ],
    inputSchema: {
      type: "object",
      properties: {
        outPath: { type: "string", description: "Where to write the markdown" },
      },
    },
    handler: async (rt, args) => {
      const cliArgs = ["--report"];
      if (args["outPath"]) cliArgs.push("--out", String(args["outPath"]));
      const data = await runCliJson(rt.meta.rootPath, "audit", cliArgs);
      return {
        data,
        wisdom: `Markdown report generated. Compliance-ready for SOX / SOC2 / EU AI Act 2026.`,
        followUp: [],
        confidence: { level: "high" },
      };
    },
  },
  {
    name: "mneme.audit.deps",
    category: "audit",
    description:
      "Cross-check this repo's dependencies against OSV.dev — known CVEs and GHSA advisories per package. " +
      "Use this WHEN user asks: 'are our deps safe?', 'CVE scan', 'OSV check', 'security audit of dependencies', " +
      "'do we have vulnerable packages?'.",
    triggers: [
      "scan dependencies for CVEs",
      "OSV check",
      "are our deps safe?",
    ],
    inputSchema: { type: "object", properties: {} },
    handler: async (rt) => {
      const data = await runCliJson(rt.meta.rootPath, "deps", ["audit"]);
      const advisories = (data as { advisories?: unknown[] })?.advisories?.length ?? 0;
      const wisdom =
        advisories === 0
          ? "No known CVEs or GHSAs in current dependency tree."
          : `${advisories} advisor${advisories === 1 ? "y" : "ies"} found across the dependency tree. Check the data.advisories array for severity + fixed-in versions.`;
      return {
        data,
        wisdom,
        followUp: advisories > 0 ? ["mneme.forensics.vulns"] : [],
        confidence: { level: "high" },
      };
    },
  },
  {
    name: "mneme.audit.conscience",
    category: "audit",
    description:
      "Risk-score a PR against the repo's own history of regrets, hotfixes, and reverts. " +
      "Use this WHEN user asks: 'is this PR risky based on history?', 'conscience review of these files', " +
      "'historical risk score for the changes'.",
    triggers: [
      "PR risk based on history",
      "conscience review",
      "ตรวจ PR ตามประวัติ",
    ],
    inputSchema: {
      type: "object",
      properties: {
        files: { type: "array", items: { type: "string" }, description: "File paths to review" },
        dualJury: { type: "boolean", description: "Run with dual-jury (more conservative)" },
      },
    },
    handler: async (rt, args) => {
      const files = (args["files"] as string[]) ?? [];
      const cliArgs = files.length ? files : [];
      if (args["dualJury"]) cliArgs.push("--dual-jury");
      const data = await runCliJson(rt.meta.rootPath, "conscience", cliArgs);
      const risk = (data as { risk?: string })?.risk ?? "unknown";
      const wisdom = `Conscience risk verdict: ${risk}. Based on similar past changes in this repo.`;
      return {
        data,
        wisdom,
        followUp: risk === "HIGH" ? ["mneme.insights.premortem", "mneme.audit.certify"] : [],
        confidence: { level: "medium" },
      };
    },
  },
  {
    name: "mneme.audit.ledger",
    category: "audit",
    description:
      "Tamper-evident audit log of all AI-driven commits with HMAC + Ed25519 signatures. SOX / SOC2 ready. " +
      "Use this WHEN user asks: 'show audit log', 'tamper-evident trail', 'all AI sessions in this repo'.",
    triggers: [
      "audit log of AI sessions",
      "tamper-evident trail",
    ],
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "ISO date — only entries since" },
      },
    },
    handler: async (rt, args) => {
      const cliArgs = args["since"] ? ["--since", String(args["since"])] : [];
      const data = await runCliJson(rt.meta.rootPath, "ledger", cliArgs);
      return {
        data,
        wisdom: "Audit ledger entries returned. Each entry is HMAC-chained + Ed25519-signed for tamper-evidence.",
        followUp: ["mneme.audit.report"],
        confidence: { level: "high" },
      };
    },
  },
];
