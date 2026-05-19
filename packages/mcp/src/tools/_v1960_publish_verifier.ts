/**
 * v2.19.60 PUBLISH VERIFIER MCP — npm registry lockstep verification.
 *
 *   mneme.publish.probe                — does a specific pkg+version exist?
 *   mneme.publish.probe_all            — probe all 5 Mneme packages at version
 *   mneme.publish.diagnose_installable — installability + fallback suggestion
 *
 * The bug class this kills: v2.19.58 published 4/5 packages but forgot
 * @mneme-ai/embeddings → mneme-ai@2.19.58 referenced a version that
 * didn't exist on npm → 100% ETARGET for users.
 *
 * AI agents can poll these tools post-publish + alert users to wait/use
 * fallback version. Shepherd (v2.19.57) consumes diagnose_installable
 * BEFORE attempting upgrade.
 *
 * 10th world-first: no AI tool ships callable npm-registry lockstep
 * verification as MCP primitive.
 */

import type { MnemeTool } from "./_types.js";

export const publishProbeTool: MnemeTool = {
  name: "mneme.publish.probe",
  category: "audit",
  description: "🔬 PUBLISH VERIFIER — probe whether a specific pkg+version exists on the npm registry. Uses `npm view <pkg>@<version> version` (cheapest registry query). Returns structured result with errorCode (E404 / ETARGET / etc) on miss. Never throws.",
  whenToUse: "After publishing a single package. Diagnosing ETARGET install errors. Verifying registry CDN propagation.",
  triggers: ["publish probe", "registry probe", "is published"],
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "npm package name (e.g. '@mneme-ai/embeddings' or 'mneme-ai')." },
      version: { type: "string", description: "Exact version string (e.g. '2.19.60')." },
      timeoutMs: { type: "number", description: "Probe timeout. Default 15000ms." },
    },
    required: ["name", "version"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is @mneme-ai/embeddings@2.19.60 on npm?", args: { name: "@mneme-ai/embeddings", version: "2.19.60" }, expectedOutput: "{ present: true, verifiedVersion: '2.19.60', ms: 234 }" }],
  pitfalls: ["npm registry CDN takes 5-30s to propagate after publish — call this in a retry loop with backoff if you JUST published."],
  composeWith: ["mneme.publish.probe_all", "mneme.publish.diagnose_installable"],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.publishVerifier.probeRegistry(
      String(args["name"]),
      String(args["version"]),
      typeof args["timeoutMs"] === "number" ? { timeoutMs: args["timeoutMs"] as number } : {},
    );
    return {
      data: r,
      wisdom: r.present
        ? `🔬 ✓ ${r.pkg}@${r.version} present on npm (${r.ms}ms)`
        : `🔬 ✗ ${r.pkg}@${r.version} MISSING from npm (${r.errorCode ?? "unknown"})`,
      confidence: { level: "high" },
    };
  },
};

export const publishProbeAllTool: MnemeTool = {
  name: "mneme.publish.probe_all",
  category: "audit",
  description: "🔬 PUBLISH VERIFIER — probe ALL 5 Mneme packages at the given version. Returns {presentCount, missingCount, missingPackages, recommendation}. The bug-class killer: catches partial-publish (the v2.19.58 root cause) before users hit ETARGET.",
  whenToUse: "Post-publish smoke test. CI gate after `npm publish` run. AI agents verifying lockstep before recommending install.",
  triggers: ["probe all packages", "publish lockstep verify", "all packages on npm"],
  inputSchema: {
    type: "object",
    properties: {
      version: { type: "string", description: "Version to verify all 5 packages at." },
      timeoutMs: { type: "number" },
    },
    required: ["version"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is v2.19.60 fully published?", args: { version: "2.19.60" }, expectedOutput: "{ allPresent: true, presentCount: 5, missingCount: 0, missingPackages: [], recommendation: '...' }" }],
  pitfalls: ["Probes all 5 sequentially — typical wall-time 3-5s. For multiple version checks, parallelize at the caller level."],
  composeWith: ["mneme.publish.probe", "mneme.publish.diagnose_installable"],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.publishVerifier.probeAllForVersion(
      String(args["version"]),
      typeof args["timeoutMs"] === "number" ? { timeoutMs: args["timeoutMs"] as number } : {},
    );
    return {
      data: r,
      wisdom: r.allPresent
        ? `🔬 ✓ ALL ${r.presentCount}/${r.probes.length} packages present at v${r.version}`
        : `🔬 ✗ ${r.missingCount}/${r.probes.length} packages MISSING at v${r.version}: ${r.missingPackages.join(", ")}`,
      confidence: { level: "high" },
    };
  },
};

export const publishDiagnoseInstallableTool: MnemeTool = {
  name: "mneme.publish.diagnose_installable",
  category: "audit",
  description: "🔬 PUBLISH VERIFIER — end-to-end installability check + fallback suggestion. Probes all 5 packages; if any missing, walks backwards through prior patches to find a fully-installable version. Returns {installable, reason, fallbackVersion?, probes}.",
  whenToUse: "Before recommending `npm install -g mneme-ai@<version>` to a user. Shepherd uses this to choose a safe target version. AI agent diagnosing ETARGET issues.",
  triggers: ["diagnose installable", "is installable", "find safe version"],
  inputSchema: {
    type: "object",
    properties: {
      version: { type: "string", description: "Target version to verify." },
      timeoutMs: { type: "number" },
    },
    required: ["version"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Can I install mneme-ai@2.19.58 safely?", args: { version: "2.19.58" }, expectedOutput: "{ installable: true, reason: 'all packages present at v2.19.58', probes: [...] } OR { installable: false, fallbackVersion: '2.19.57', ... }" }],
  pitfalls: ["Fallback search walks back up to 5 patches. If neither current nor 5 prior patches are installable, returns installable=false without fallbackVersion."],
  composeWith: ["mneme.publish.probe_all", "mneme.shepherd.start"],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.publishVerifier.diagnoseInstallable(
      String(args["version"]),
      typeof args["timeoutMs"] === "number" ? { timeoutMs: args["timeoutMs"] as number } : {},
    );
    return {
      data: r,
      wisdom: r.installable
        ? `🔬 ✓ v${r.version} fully installable`
        : `🔬 ✗ v${r.version} NOT installable: ${r.reason}${r.fallbackVersion ? ` — fallback: v${r.fallbackVersion}` : ""}`,
      confidence: { level: "high" },
    };
  },
};

export const V1960_PUBLISH_VERIFIER_TOOLS: MnemeTool[] = [
  publishProbeTool,
  publishProbeAllTool,
  publishDiagnoseInstallableTool,
];
