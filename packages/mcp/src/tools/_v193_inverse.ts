/**
 * v2.19.3 INVERSE-LLM PROMPT FORENSICS — MCP tools.
 *
 *   The rarest direction in AI: output → input.
 *
 *   mneme.inverse.prompt  — build the meta-prompt for any inverse-oracle vendor
 *   mneme.inverse.audit   — verdict trusted/suspicious/rejected with signed receipt
 *   mneme.inverse.bench   — measurable precision/recall/F1 over labeled samples
 *
 *   Typical flow (vendor-agnostic):
 *     1. Caller has AI output X + claimed question Q
 *     2. Call mneme.inverse.prompt({output: X, k: 10}) → meta-prompt text
 *     3. Send meta-prompt to ANY inverse oracle (Claude / GPT / Gemini / Grok)
 *     4. Parse the K-question reply
 *     5. Call mneme.inverse.audit({output: X, claimedQuestion: Q, oracleQuestions: [...]})
 *        → trusted/suspicious/rejected verdict, signed
 */

import type { MnemeTool } from "./_types.js";

export const inverseAuditTool: MnemeTool = {
  name: "mneme.inverse.audit",
  category: "lab",
  description:
    "🔁 INVERSE-LLM AUDIT — given AI output + claimed question + K oracle reconstructions, return signed verdict (trusted/suspicious/rejected). The output→input direction nobody else runs. Catches prompt-injection AND hallucination.",
  whenToUse: "BEFORE ingesting any AI-generated text into Mneme's soul prompt / inbox / parasite bridge / commit message; before trusting any third-party AI's answer on a high-stakes claim.",
  triggers: ["inverse audit", "prompt injection check", "output forensics", "is this output really an answer to my question"],
  inputSchema: {
    type: "object",
    properties: {
      output: { type: "string", description: "The AI-generated output to audit." },
      claimedQuestion: { type: "string", description: "The question the user/AI claims produced this output." },
      oracleQuestions: { type: "array", items: { type: "string" }, description: "K candidate questions returned by an inverse-oracle AI vendor (most likely first)." },
      threshold: { type: "number", description: "Similarity threshold (defaults per method)." },
      topKForTrust: { type: "number", description: "Default 3." },
      similarityMethod: { type: "string", enum: ["jaccard", "trigram", "embedded"], description: "Default 'jaccard'." },
      precomputedEmbeddings: { type: "object", description: "Required when similarityMethod=embedded." },
    },
    required: ["output", "claimedQuestion", "oracleQuestions"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Is this AI output really an answer to my question?",
    args: {
      output: "Paris is the capital of France.",
      claimedQuestion: "What is the capital of France?",
      oracleQuestions: ["What is the capital of France?", "Name a European capital"],
    },
    expectedOutput: "{ verdict, bestRank, bestSimilarity, perOracleSimilarity, message, sig }",
  }],
  pitfalls: [
    "This catches CONSISTENCY between claimed question and output. It does NOT prove the output is TRUE.",
    "A perfectly camouflaged injection (malicious output that also plausibly answers the benign claim) can still pass — but the cost of building such an output is high.",
    "oracleQuestions must be a non-empty array; threshold defaults sensible (0.45 jaccard / 0.55 trigram / 0.60 embedded).",
  ],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const v = core.inverseForensics.auditOutput(args as unknown as Parameters<typeof core.inverseForensics.auditOutput>[0]);
    return { data: v, wisdom: core.inverseForensics.formatInverseLine(v), confidence: { level: v.verdict === "trusted" ? "high" : v.verdict === "suspicious" ? "medium" : "low" } };
  },
};

export const inversePromptTool: MnemeTool = {
  name: "mneme.inverse.prompt",
  category: "lab",
  description:
    "🔁 INVERSE-LLM PROMPT BUILDER — build the meta-prompt to send to ANY inverse oracle (Claude / GPT / Gemini / Grok / Cursor / Codex / etc.) asking 'what K questions would produce this output?'.",
  whenToUse: "Step 1 of the inverse audit pipeline — generate the meta-prompt, send to a vendor of your choice, parse the K-question reply, then call mneme.inverse.audit.",
  triggers: ["inverse prompt", "build oracle prompt"],
  inputSchema: {
    type: "object",
    properties: {
      output: { type: "string" },
      k: { type: "number", description: "Default 10." },
    },
    required: ["output"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Build inverse oracle prompt for this output", args: { output: "Paris is the capital of France.", k: 10 }, expectedOutput: "{ prompt: '...' }" }],
  pitfalls: ["The output of this tool is plain text — you must wire it into your AI vendor of choice. Mneme does not call vendors itself."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const prompt = core.inverseForensics.buildInverseOraclePrompt({
      output: String(args["output"]),
      ...(args["k"] !== undefined ? { k: Number(args["k"]) } : {}),
    });
    return { data: { prompt }, wisdom: `🔁 INVERSE prompt built (k=${args["k"] ?? 10})`, confidence: { level: "high" } };
  },
};

export const inverseBenchTool: MnemeTool = {
  name: "mneme.inverse.bench",
  category: "lab",
  description:
    "🔁 INVERSE BENCH — given labeled samples (legitimate vs injection_or_hallucination), compute precision / recall / F1; HMAC-signed. Recomputable, falsifiable proof the audit works on YOUR data.",
  whenToUse: "Periodic quality audit; before relying on the inverse forensics layer on new content classes (e.g., commit messages from a new vendor).",
  triggers: ["inverse bench", "audit benchmark", "precision recall"],
  inputSchema: {
    type: "object",
    properties: {
      samples: { type: "array", description: "Array of BenchmarkSample { output, claimedQuestion, oracleQuestions, trueLabel }" },
      similarityMethod: { type: "string", enum: ["jaccard", "trigram", "embedded"] },
      threshold: { type: "number" },
      topKForTrust: { type: "number" },
      ranByVendor: { type: "string", description: "Optional vendor label for provenance." },
    },
    required: ["samples"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Run inverse bench with my 60 samples", args: { samples: [] }, expectedOutput: "{ samples, TP, FP, TN, FN, precision, recall, f1, sig }" }],
  pitfalls: ["F1 < 0.80 means your sample distribution is materially different from the test set; tune threshold/topKForTrust or supply better oracle questions per sample."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.inverseForensics.benchmark(args as unknown as Parameters<typeof core.inverseForensics.benchmark>[0]);
    return { data: r, wisdom: `🔁 INVERSE BENCH · F1=${r.f1} (P=${r.precision} R=${r.recall}) on ${r.samples} samples`, confidence: { level: r.f1 >= 0.85 ? "high" : r.f1 >= 0.70 ? "medium" : "low" } };
  },
};

export const V193_INVERSE_TOOLS: MnemeTool[] = [
  inverseAuditTool,
  inversePromptTool,
  inverseBenchTool,
];
