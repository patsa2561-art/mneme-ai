/**
 * v2.19.15 TRUTH FORENSIC PIPELINE — 5 MCP tools.
 *
 *   mneme.truth.forensic        — full pipeline: claim → sniff → ground-truth → verdict + cert
 *   mneme.truth.sniff           — only sniff assertions (no ground-truth check)
 *   mneme.truth.verify_cert     — HMAC-verify a forensic certificate
 *   mneme.truth.classify        — quick: how many assertions + which classes
 *   mneme.truth.explain         — re-render the plain-English explanation
 *
 * The disruption: every other AI safety tool asks 'is this supported?'.
 * Mneme asks 'what would refute this, and have I checked + failed to find it?'.
 * For AI-tool-self-description claims (the W2 class), Mneme can answer
 * vendor-free: it has its own MCP catalog as ground truth.
 */

import type { MnemeTool } from "./_types.js";

async function buildLiveCatalog(): Promise<string[]> {
  const { buildAllTools } = await import("./_registry.js");
  return buildAllTools().map((t) => t.name);
}

export const truthForensicTool: MnemeTool = {
  name: "mneme.truth.forensic",
  category: "audit",
  description:
    "🔬 FORENSIC — gate a claim through the truth forensic pipeline. Built-in sniffers cover AI-tool-self-description (mneme.X.Y exists, 'N mneme.X.* tools', version, file paths). REJECTED on any refutation; ACCEPTED only when every sniff grounds.",
  whenToUse: "Before relaying ANY AI-stated claim about Mneme's surface (catalog, version, files). Replaces the v2.19.8 regex-based W2 fix with a real falsification gate.",
  triggers: ["truth forensic", "verify claim", "kill the lie"],
  inputSchema: {
    type: "object",
    properties: {
      claim: { type: "string" },
      installedVersion: { type: "string", description: "Optional override for the installed version (e.g., from package.json)." },
      externalRefutationsFound: { type: "number", description: "Number of caller-supplied refutations found (forces REJECTED if > 0). Composes with v2.19.13 NEGATIVE-EVIDENCE." },
    },
    required: ["claim"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Verify 'Mneme registers 4 mneme.nexus.* MCP tools'",
    args: { claim: "Mneme registers 4 mneme.nexus.* MCP tools" },
    expectedOutput: "{ verdict: 'ACCEPTED' | 'REJECTED' | 'UNKNOWN', assertions: [...], refutedAssertions: [...], certificate: {...}, explanation: '...' }",
  }],
  pitfalls: ["UNKNOWN ≠ ACCEPTED — Mneme refuses to auto-accept untested claims. Add a specific tool name / count / version / file path to make the claim testable."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const catalog = await buildLiveCatalog();
    const installedVersion = (args["installedVersion"] as string | undefined)
      ?? (() => { try { return String(require("../../package.json").version); } catch { return undefined; } })();
    const { existsSync } = await import("node:fs");
    const { resolve: pathResolve } = await import("node:path");
    const repoRoot = process.cwd();
    const r = core.truthForensic.forensicVerify({
      claim: String(args["claim"]),
      groundTruth: {
        mcpCatalog: catalog,
        ...(installedVersion ? { installedVersion } : {}),
        fileExists: (p: string) => existsSync(pathResolve(repoRoot, p)),
      },
      externalRefutationsFound: args["externalRefutationsFound"] as number | undefined,
    });
    return { data: r, wisdom: core.truthForensic.formatForensicLine(r), confidence: { level: "high" } };
  },
};

export const truthSniffTool: MnemeTool = {
  name: "mneme.truth.sniff",
  category: "audit",
  description:
    "🔬 FORENSIC — sniff verifiable assertions from a claim WITHOUT checking ground truth. Useful for previewing 'is this claim testable at all?'.",
  whenToUse: "Before forensic verify: see what the pipeline will try to check.",
  triggers: ["truth sniff", "claim sniff"],
  inputSchema: { type: "object", properties: { claim: { type: "string" } }, required: ["claim"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What assertions can be sniffed from this claim?", args: { claim: "ships 4 mneme.nexus.* tools at v2.19.15" }, expectedOutput: "{ assertions: [{ kind, asserted, value }] }" }],
  pitfalls: ["A claim with 0 sniffable assertions will return UNKNOWN from mneme.truth.forensic — rephrase to include checkable specifics."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const a = core.truthForensic.sniffAllAssertions(String(args["claim"]));
    return { data: { assertions: a, count: a.length }, wisdom: `🔬 sniffed ${a.length} assertion(s)`, confidence: { level: "high" } };
  },
};

export const truthVerifyCertTool: MnemeTool = {
  name: "mneme.truth.verify_cert",
  category: "audit",
  description:
    "🔬 FORENSIC — HMAC-verify a forensic certificate. Catches forged certs (claims that didn't actually pass the gate).",
  whenToUse: "Before trusting a certificate received from another Mneme instance or vendor relay.",
  triggers: ["truth verify cert", "verify forensic certificate"],
  inputSchema: { type: "object", properties: { certificate: { type: "object" } }, required: ["certificate"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is this forensic cert real?", args: { certificate: {} }, expectedOutput: "{ ok, reason? }" }],
  pitfalls: ["Verifies signature only — doesn't re-run the original sniff/check."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.truthForensic.verifyForensicCertificate(
      args["certificate"] as Parameters<typeof core.truthForensic.verifyForensicCertificate>[0],
    );
    return { data: r, wisdom: r.ok ? "✅ cert VALID" : `❌ ${r.reason}`, confidence: { level: "high" } };
  },
};

export const truthClassifyTool: MnemeTool = {
  name: "mneme.truth.classify",
  category: "audit",
  description:
    "🔬 FORENSIC — quick classification: how many assertions + which sniffer classes match a claim.",
  whenToUse: "Triage: 'is this even a testable claim?'",
  triggers: ["truth classify", "classify claim"],
  inputSchema: { type: "object", properties: { claim: { type: "string" } }, required: ["claim"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Classify this claim", args: { claim: "v2.19.15 ships 4 mneme.nexus.* tools" }, expectedOutput: "{ assertionsExpected, classes }" }],
  pitfalls: ["classes=[] means no built-in sniffer matches; the claim is unverifiable by the built-in pipeline alone."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.truthForensic.classifyClaim(String(args["claim"]));
    return { data: r, wisdom: `🔬 ${r.assertionsExpected} assertion(s), classes=${r.classes.join(",")}`, confidence: { level: "high" } };
  },
};

export const truthExplainTool: MnemeTool = {
  name: "mneme.truth.explain",
  category: "audit",
  description:
    "🔬 FORENSIC — full forensic verdict with plain-English explanation (safe to show non-engineers). Convenience wrapper over mneme.truth.forensic.",
  whenToUse: "When the AI needs to show the user WHY a claim was accepted/rejected, not just the verdict.",
  triggers: ["truth explain", "explain forensic"],
  inputSchema: { type: "object", properties: { claim: { type: "string" } }, required: ["claim"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Explain why this claim failed", args: { claim: "ships 99 mneme.nexus.* tools" }, expectedOutput: "{ verdict, explanation }" }],
  pitfalls: ["The explanation is plain English — designed for non-engineers."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const catalog = await buildLiveCatalog();
    const installedVersion = (() => { try { return String(require("../../package.json").version); } catch { return undefined; } })();
    const { existsSync } = await import("node:fs");
    const { resolve: pathResolve } = await import("node:path");
    const repoRoot = process.cwd();
    const r = core.truthForensic.forensicVerify({
      claim: String(args["claim"]),
      groundTruth: {
        mcpCatalog: catalog,
        ...(installedVersion ? { installedVersion } : {}),
        fileExists: (p: string) => existsSync(pathResolve(repoRoot, p)),
      },
    });
    return { data: { verdict: r.verdict, explanation: r.explanation, certificate: r.certificate }, wisdom: core.truthForensic.formatForensicLine(r), confidence: { level: "high" } };
  },
};

export const V1915_TRUTH_FORENSIC_TOOLS: MnemeTool[] = [
  truthForensicTool, truthSniffTool, truthVerifyCertTool, truthClassifyTool, truthExplainTool,
];
