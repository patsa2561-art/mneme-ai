/**
 * Forensics — applied forensic science for code: Bayesian author attribution,
 * stack-aware vuln hunt, insider-threat anomaly, ENFSI verbal scale.
 */

import { runCliJson } from "./_runtime.js";
import type { MnemeTool } from "./_types.js";

export const forensicsTools: MnemeTool[] = [
  {
    name: "mneme.forensics.vulns",
    category: "forensics",
    description:
      "Scan git history for security holes (51 patterns across SQL injection, XSS, hardcoded secrets, XXE, SSRF, " +
      "auth bypass, CSRF, etc.). Each finding is Bayesian-filtered: posterior = stack-prior × AST-evidence, so non-applicable " +
      "rules are dropped before they leave the scanner. " +
      "Use this WHEN user asks: 'find security issues', 'vuln scan', 'CWE check', 'what security holes are hiding?'.",
    triggers: [
      "find security issues",
      "vulnerability scan",
      "หา bug ความปลอดภัย",
      "scan for SQL injection",
    ],
    inputSchema: {
      type: "object",
      properties: {
        top: { type: "number", description: "Top N findings (default 50)" },
        minPosterior: { type: "number", description: "Minimum posterior threshold (default 0.3)" },
      },
    },
    handler: async (rt, args) => {
      const cliArgs: string[] = [];
      if (args["top"]) cliArgs.push("--top", String(args["top"]));
      if (args["minPosterior"]) cliArgs.push("--min-posterior", String(args["minPosterior"]));
      const data = await runCliJson(rt.meta.rootPath, "forensics vulns", cliArgs);
      const findings = (data as { findings?: unknown[] })?.findings?.length ?? 0;
      const wisdom =
        findings === 0
          ? "No vulnerabilities surfaced above the posterior threshold. Clean."
          : `${findings} candidate vulnerabilit${findings === 1 ? "y" : "ies"} surfaced. Each is a CANDIDATE for human review — verify before action.`;
      return {
        data,
        wisdom,
        followUp: findings > 0 ? ["mneme.forensics.show", "mneme.forensics.suppress"] : [],
        confidence: { level: "medium", notes: "Findings are heuristic — Bayesian-filtered but always verify before treating as confirmed." },
      };
    },
  },
  {
    name: "mneme.forensics.anomaly",
    category: "forensics",
    description:
      "Insider-threat / credential-compromise detector: flag commits whose timing, file footprint, or style deviates " +
      "from the author's baseline. Use this WHEN user asks: 'any suspicious commits?', 'insider threat scan', " +
      "'is this account compromised?', 'unusual commits'.",
    triggers: [
      "any suspicious commits?",
      "insider threat scan",
      "compromised account check",
    ],
    inputSchema: { type: "object", properties: {} },
    handler: async (rt) => {
      const data = await runCliJson(rt.meta.rootPath, "forensics anomaly");
      const flagged = (data as { anomalies?: unknown[] })?.anomalies?.length ?? 0;
      const wisdom =
        flagged === 0
          ? "No anomalies detected — all commits match author baselines."
          : `${flagged} suspicious commit${flagged === 1 ? "" : "s"} flagged. Each deviates from the author's normal pattern (timing, files, or style).`;
      return {
        data,
        wisdom,
        followUp: flagged > 0 ? ["mneme.forensics.match", "mneme.forensics.attribute"] : [],
        confidence: { level: "medium", notes: "Anomaly ≠ proof of malice. Treat as 'investigate', not 'accuse'." },
      };
    },
  },
  {
    name: "mneme.forensics.match",
    category: "forensics",
    description:
      "Likelihood-ratio test: 'Did Alice REALLY write this commit?'. Returns ENFSI verbal-scale verdict + LR. " +
      "Use this WHEN user asks: 'is this commit really by X?', 'verify authorship', 'did Alice write a3f9b21?'.",
    triggers: [
      "did Alice write this commit?",
      "verify commit authorship",
      "ตรวจสอบ author จริงๆ",
    ],
    inputSchema: {
      type: "object",
      properties: {
        commit: { type: "string", description: "Commit hash or HEAD-relative ref" },
        author: { type: "string", description: "Suspected author email" },
      },
      required: ["commit", "author"],
    },
    handler: async (rt, args) => {
      const data = await runCliJson(rt.meta.rootPath, "forensics match", [String(args["commit"]), String(args["author"])]);
      const verdict = (data as { verdict?: string })?.verdict ?? "?";
      const wisdom = `ENFSI verdict: ${verdict}. Likelihood ratio shown in data.lr. Higher LR = stronger evidence FOR the claimed author.`;
      return {
        data,
        wisdom,
        followUp: ["mneme.forensics.attribute"],
        confidence: { level: "medium", notes: "Stylometric matching, not cryptographic proof." },
      };
    },
  },
  {
    name: "mneme.forensics.attribute",
    category: "forensics",
    description:
      "Rank ALL candidate authors for a commit by stylometric likelihood. " +
      "Use this WHEN user asks: 'who most likely wrote this?', 'attribute this commit', 'authorship ranking'.",
    triggers: [
      "who most likely wrote this commit?",
      "attribute this commit",
    ],
    inputSchema: {
      type: "object",
      properties: {
        commit: { type: "string", description: "Commit hash or HEAD-relative ref (default HEAD)" },
      },
    },
    handler: async (rt, args) => {
      const cliArgs = args["commit"] ? [String(args["commit"])] : [];
      const data = await runCliJson(rt.meta.rootPath, "forensics attribute", cliArgs);
      const top = (data as { ranking?: Array<{ author: string; lr: number }> })?.ranking?.[0];
      const wisdom = top
        ? `Most likely author: ${top.author} (likelihood ratio ${top.lr.toFixed(2)}). Full ranking in data.ranking.`
        : "No candidates ranked.";
      return {
        data,
        wisdom,
        followUp: top ? ["mneme.forensics.match"] : [],
        confidence: { level: "medium" },
      };
    },
  },
  {
    name: "mneme.forensics.show",
    category: "forensics",
    description:
      "Open a single forensics finding by ID — full context, the line of code, recommended fix. " +
      "Use this WHEN user wants to dig into a specific finding from `mneme.forensics.vulns`.",
    triggers: [
      "show finding 988c6155",
      "details of this vuln",
    ],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Finding ID from vulns scan" },
      },
      required: ["id"],
    },
    handler: async (rt, args) => {
      const data = await runCliJson(rt.meta.rootPath, "show", [String(args["id"])]);
      return {
        data,
        wisdom: "Finding context loaded. The data includes file/line, code excerpt, CWE, and any recommended fix.",
        followUp: ["mneme.forensics.suppress"],
        confidence: { level: "high" },
      };
    },
  },
  {
    name: "mneme.forensics.suppress",
    category: "forensics",
    description:
      "Mark a finding as a false positive — won't appear in future scans. Saved to .mneme/suppressions.json. " +
      "Use this WHEN user has reviewed a finding and confirmed it's not a real issue.",
    triggers: [
      "suppress this finding",
      "mark as false positive",
    ],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Finding ID" },
        reason: { type: "string", description: "Why this is a false positive" },
      },
      required: ["id"],
    },
    handler: async (rt, args) => {
      const cliArgs = [String(args["id"])];
      if (args["reason"]) cliArgs.push("--reason", String(args["reason"]));
      const data = await runCliJson(rt.meta.rootPath, "suppress", cliArgs);
      return {
        data,
        wisdom: `Finding suppressed. Future scans will skip it.`,
        followUp: [],
        confidence: { level: "high" },
      };
    },
  },
];
