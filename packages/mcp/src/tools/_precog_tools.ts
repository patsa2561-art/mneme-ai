/**
 * v1.70.0 -- MCP wrappers for PRECOG FIREWALL.
 *
 * The headline tool: mneme.precog.intercept -- run an AI claim through
 * the firewall + return the verified (hedged or certified) version.
 * Downstream apps can wrap their AI output via this single call to
 * become "structurally incapable of hallucinating".
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

export const precogInterceptTool: MnemeTool = {
  name: "mneme.precog.intercept",
  category: "meta",
  description: "PRECOG FIREWALL -- the paradigm shift. Intercepts AI claim BEFORE it reaches the user; runs 4 verifier layers (package / SHA-version-email / temporal / Bayesian prior); auto-hedges every un-verifiable span with a named cause; issues HMAC trust certificate on CERTIFIED. Verdict: CERTIFIED / HEDGED / REJECTED.",
  whenToUse: "Wrap EVERY AI-generated factual claim before delivery to the user. The structurally-no-hallucination layer.",
  triggers: ["intercept claim", "verify and hedge", "firewall", "pre-cog", "ป้องกัน AI โกหก"],
  inputSchema: {
    type: "object",
    properties: {
      claim: { type: "string" },
      rejectPosterior: { type: "number", description: "Reject when Bayesian posterior >= this (default 0.6)." },
      rejectHedgeCount: { type: "number", description: "Reject when hedge count >= this (default 4)." },
    },
    required: ["claim"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Verify 'wraith-utils-2099 is for caching'", args: { claim: "wraith-utils-2099 is for caching" }, expectedOutput: "Verdict + hedged text + per-verifier breakdown + certificate (if CERTIFIED)." }],
  pitfalls: ["This is the layer that prevents downstream apps from displaying un-verified claims. Use upstream of any user-facing AI output."],
  composeWith: ["mneme.apoptosis.detect", "mneme.hyperscan.prose", "mneme.hyperscan.citation"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.precog.intercept(repoRootOf(rt), String(args["claim"] ?? ""), {
      rejectPosterior: args["rejectPosterior"] as number | undefined,
      rejectHedgeCount: args["rejectHedgeCount"] as number | undefined,
    });
    return {
      data: r,
      wisdom: r.headline,
      confidence: { level: r.verdict === "CERTIFIED" ? "high" : r.verdict === "HEDGED" ? "medium" : "low" },
      secondBrain: {
        presentation: `Render r.verified as the deliverable. List r.hedges as "Why we hedged X" footnotes. If r.certificate exists, surface its id as a verifiability handle.`,
      },
    };
  },
};

export const precogBenchTool: MnemeTool = {
  name: "mneme.precog.bench",
  category: "meta",
  description: "Run PRECOG bench on a synthetic 13-claim corpus (9 fabrications + 4 truths). Reports catch rate + preservation rate + verdict distribution.",
  whenToUse: "Verify firewall efficacy after any precog-related change.",
  triggers: ["precog bench", "firewall bench"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Run precog bench", args: {}, expectedOutput: "Catch rate + preservation + verdicts." }],
  pitfalls: ["Bench leaves audit trace; use tmp repo for pristine numbers."],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const r = core.precog.runPrecogBench(repoRootOf(rt));
    const txt = core.precog.renderBench(r);
    return {
      data: r,
      wisdom: r.headline,
      confidence: { level: "high" },
      secondBrain: { presentation: txt },
    };
  },
};

export const precogCertVerifyTool: MnemeTool = {
  name: "mneme.precog.cert.verify",
  category: "meta",
  description: "Verify a PRECOG trust certificate (HMAC + expiry + verdict). Returns VALID / INVALID_HMAC / EXPIRED / NOT_CERTIFIED.",
  whenToUse: "Downstream app receives a Mneme certificate and wants to verify before displaying.",
  triggers: ["verify certificate", "check trust cert"],
  inputSchema: {
    type: "object",
    properties: { cert: { type: "object" } },
    required: ["cert"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Verify cert", args: { cert: {} }, expectedOutput: "Verdict." }],
  pitfalls: ["Cert HMAC binds to the issuing repo's secret; cross-repo verification needs the secret shared."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const cert = args["cert"] as import("@mneme-ai/core").precog.trustCertificate.TrustCertificate;
    const verdict = core.precog.verifyCertificate(repoRootOf(rt), cert);
    return {
      data: { verdict },
      wisdom: `Certificate ${cert.id ?? "(no-id)"}: ${verdict}`,
      confidence: { level: "high" },
    };
  },
};

export const PRECOG_TOOLS: MnemeTool[] = [
  precogInterceptTool,
  precogBenchTool,
  precogCertVerifyTool,
];
