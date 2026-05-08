/**
 * Quality — code quality, repo health, palimpsest causal chains, twin-rewrite.
 */

import { passthroughHandler } from "./_runtime.js";
import type { MnemeTool } from "./_types.js";

const passthrough = (
  name: string,
  description: string,
  triggers: string[],
  cli: string,
  argMap: (a: Record<string, unknown>) => string[] = () => [],
  inputSchema: MnemeTool["inputSchema"] = { type: "object", properties: {} },
  followUp: string[] = [],
  wisdom: (d: unknown) => string = () => "Result returned — summarize key fields for the user.",
): MnemeTool => ({
  name,
  category: "quality",
  description,
  triggers,
  inputSchema,
  handler: passthroughHandler(cli, argMap, { wisdom, followUp, confidence: "medium" }),
});

export const qualityTools: MnemeTool[] = [
  passthrough(
    "mneme.quality.karma",
    "TODO/FIXME debt as an accumulating ledger — who owns the oldest unkept promises. Use WHEN user asks: 'TODO debt by author', 'who has the most karma debt?', 'unkept promise ledger'.",
    ["TODO debt by author", "who has stale promises"],
    "karma",
    (a) => {
      const out: string[] = [];
      if (a["topN"]) out.push("--top", String(a["topN"]));
      if (a["authorEmail"]) out.push("--author", String(a["authorEmail"]));
      return out;
    },
    { type: "object", properties: { topN: { type: "number" }, authorEmail: { type: "string" } } },
    ["mneme.people.promise"],
    (d) => `Karma ledger: ${(d as { records?: unknown[] })?.records?.length ?? 0} TODO entries scored by age + author.`,
  ),
  passthrough(
    "mneme.quality.repo_mri",
    "20-axis health diagnostic — the codebase MRI. Highlights outliers vs medians for similar-size OSS repos. Use WHEN user asks: 'how healthy is this repo?', 'MRI scan', 'where are we abnormal?'.",
    ["how healthy is this repo?", "MRI scan"],
    "repo-mri",
    () => [],
    { type: "object", properties: {} },
    ["mneme.quality.heartbeat", "mneme.people.nervous_system"],
    () => "Repo MRI complete. The headline 'three most-unusual axes' is in data.outliers.",
  ),
  passthrough(
    "mneme.quality.heartbeat",
    "Today's pulse vs the rolling 7-day baseline. Anomalies above 2σ flagged. Use WHEN user asks: 'pulse check', 'anomalies today', 'health drift'.",
    ["pulse check today", "health drift"],
    "heartbeat",
    () => [],
    { type: "object", properties: {} },
    ["mneme.quality.repo_mri"],
    (d) => `Heartbeat verdict: ${(d as { verdict?: string })?.verdict ?? "?"}. Anomalies in data.anomalies.`,
  ),
  passthrough(
    "mneme.quality.cognitive_twin",
    "Author voice fingerprint + optional commit-subject rewriter in their style. Use WHEN user asks: 'rewrite this in Alice's voice', 'author voice profile'.",
    ["rewrite in author voice", "author fingerprint"],
    "cognitive-twin",
    (a) => {
      const out = [String(a["authorEmail"] ?? "")];
      if (a["rewrite"]) out.push("--rewrite", String(a["rewrite"]));
      return out;
    },
    {
      type: "object",
      properties: {
        authorEmail: { type: "string" },
        rewrite: { type: "string", description: "Generic subject to rewrite in author's voice" },
      },
      required: ["authorEmail"],
    },
  ),
  passthrough(
    "mneme.quality.counterfactual",
    "Shadow projection: 'What if this person hadn't been here?' — purely speculative, ethics-framed. Use WHEN user asks: 'impact analysis if X left'.",
    ["what if this person had not been here", "impact of leaving"],
    "counterfactual",
    (a) => [String(a["authorEmail"])],
    { type: "object", properties: { authorEmail: { type: "string" } }, required: ["authorEmail"] },
    [],
    () => "Counterfactual is SPECULATIVE — frame as 'what if', never as fact.",
  ),
  passthrough(
    "mneme.quality.palimpsest",
    "Render the causal chain of a single line of code — every prior author + reason. Use WHEN user asks: 'palimpsest of src/x.ts:42', 'causal chain of this line'.",
    ["palimpsest of file:line", "causal chain of line"],
    "palimpsest",
    (a) => {
      const out = [String(a["target"])];
      if (a["counterfactual"]) out.push("--counterfactual");
      return out;
    },
    {
      type: "object",
      properties: { target: { type: "string", description: "file:line" }, counterfactual: { type: "boolean" } },
      required: ["target"],
    },
    ["mneme.people.lineage"],
  ),
  passthrough(
    "mneme.quality.dna",
    "Extract a contributor's portable fingerprint (style, hours, file affinity). Use WHEN user asks: 'engineering DNA of Alice', 'fingerprint of this contributor'.",
    ["engineering DNA", "contributor fingerprint"],
    "dna",
    (a) => (a["authorEmail"] ? [String(a["authorEmail"])] : []),
    { type: "object", properties: { authorEmail: { type: "string" } } },
    ["mneme.quality.cognitive_twin"],
  ),
  passthrough(
    "mneme.quality.dna_fold",
    "Stylometric folding — group authors by writing style only (no commit metadata). Use WHEN user asks: 'cluster by writing style', 'DNA-fold groups'.",
    ["cluster by writing style", "DNA-fold groups"],
    "dna-fold",
    () => [],
    { type: "object", properties: {} },
    ["mneme.people.telepathy"],
  ),
  passthrough(
    "mneme.quality.rewind",
    "Replay history up to that ref — frozen view of the past at any commit. Use WHEN user asks: 'what did the repo look like at v0.5?', 'rewind to ref'.",
    ["rewind to ref", "view repo at past commit"],
    "rewind",
    (a) => [String(a["ref"])],
    { type: "object", properties: { ref: { type: "string" } }, required: ["ref"] },
  ),
  passthrough(
    "mneme.quality.teach",
    "Explain a folder/file in plain language (layer classification + LLM summary). Use WHEN user asks: 'explain src/auth/', 'teach me this folder'.",
    ["explain this folder", "teach me about X"],
    "teach",
    (a) => [String(a["target"])],
    { type: "object", properties: { target: { type: "string" } }, required: ["target"] },
    ["mneme.memory.ask"],
  ),
  passthrough(
    "mneme.quality.heal",
    "Synthesize WHY notes for commits with poor messages — turns bad history into searchable memory. Use WHEN user asks: 'fix commit messages', 'heal bad history'.",
    ["fix commit messages", "heal bad history"],
    "heal",
    () => [],
    { type: "object", properties: {} },
  ),
  passthrough(
    "mneme.quality.entities",
    "Parse + embed every function/class/type/exported variable in tracked TS/JS files. Use WHEN user asks: 'index entities', 'embed all functions'.",
    ["index symbols", "embed all functions"],
    "entities",
    () => [],
    { type: "object", properties: {} },
    ["mneme.memory.list_entities", "mneme.memory.find_similar"],
  ),
  passthrough(
    "mneme.quality.clones",
    "Find semantic clones — functions doing the same thing under different names. Use WHEN user asks: 'find duplicate code', 'semantic clones'.",
    ["find duplicate code", "semantic clones"],
    "clones",
    () => [],
    { type: "object", properties: {} },
    ["mneme.memory.find_similar"],
  ),
  passthrough(
    "mneme.quality.guardian",
    "Trigger a single Guardian sweep — diagnose weaknesses + auto-fix safe items. Use WHEN user asks: 'guardian sweep', 'auto-heal repo'.",
    ["guardian sweep", "auto-heal safe issues"],
    "guardian",
    () => [],
    { type: "object", properties: {} },
  ),
];
