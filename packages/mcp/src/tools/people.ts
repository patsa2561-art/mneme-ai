/**
 * People analytics — what GitHub cannot see.
 *
 * Pragmatic wiring: most tools route to the CLI command via passthrough so
 * the MCP layer doesn't need to mirror every internal API signature. The
 * wisdom layer is what makes the AI's response richer than raw JSON.
 */

import { passthroughHandler } from "./_runtime.js";
import type { MnemeTool } from "./_types.js";

const peep = (
  name: string,
  description: string,
  triggers: string[],
  cli: string,
  argMap: (a: Record<string, unknown>) => string[] = () => [],
  inputSchema: MnemeTool["inputSchema"] = { type: "object", properties: {} },
  followUp: string[] = [],
  wisdom: (d: unknown) => string = () => "Result returned — summarize key fields for the user.",
  notes?: string,
): MnemeTool => ({
  name,
  category: "people",
  description,
  triggers,
  inputSchema,
  handler: passthroughHandler(cli, argMap, {
    wisdom,
    followUp,
    confidence: notes ? "medium" : "high",
  }),
});

export const peopleTools: MnemeTool[] = [
  peep(
    "mneme.people.atrophy",
    "Knowledge-atrophy clock per (author × area), based on Ebbinghaus forgetting curve over commit recency. " +
      "Returns a freshness score 0-100 + 'days until forgotten' estimate. " +
      "Use this WHEN user asks: 'who's forgetting what?', 'is Alice still on top of auth?', " +
      "'knowledge half-life', 'expertise decay'. Without --author returns top fading-knowledge per person.",
    ["ใครยังจำเรื่อง payments ได้บ้าง", "is Alice still on top of auth?", "knowledge that's fading"],
    "atrophy",
    (a) => (a["authorEmail"] ? [String(a["authorEmail"])] : []),
    {
      type: "object",
      properties: {
        authorEmail: { type: "string", description: "Optional: focus on a single author's knowledge map" },
        topN: { type: "number", description: "Top N areas (default 10)" },
      },
    },
    ["mneme.people.passport", "mneme.people.bus_factor", "mneme.people.telepathy"],
    (d) => {
      const records = (d as { records?: unknown[] })?.records?.length ?? 0;
      return records === 0
        ? "No atrophy data — repo may be tiny or unindexed."
        : `Knowledge atrophy report: ${records} (author × area) entries scored. Lower scores = fading knowledge.`;
    },
  ),
  peep(
    "mneme.people.telepathy",
    "Find author pairs who NEVER co-author commits but write similar code shapes — invisible teams. " +
      "Use WHEN user asks: 'invisible teams', 'who collaborates without knowing it?', 'parallel evolution'.",
    ["invisible teams", "who's solving the same problems?", "ทีมล่องหน"],
    "telepathy",
    (a) => (a["topN"] ? ["--top", String(a["topN"])] : []),
    { type: "object", properties: { topN: { type: "number" } } },
    ["mneme.people.passport", "mneme.people.influence"],
    (d) => {
      const pairs = (d as { pairs?: unknown[] })?.pairs?.length ?? 0;
      return pairs === 0
        ? "No telepathy pairs detected — repo may be too small or single-author."
        : `${pairs} telepathic pair${pairs === 1 ? "" : "s"}. Each pair writes similar code without ever co-authoring.`;
    },
  ),
  peep(
    "mneme.people.nemesis",
    "Author pairs who consistently rewrite or revert each other's work — engineering friction. " +
      "Use WHEN user asks: 'where is friction?', 'pairs that need conflict mediation'.",
    ["where is engineering friction?", "who rewrites whose code?"],
    "nemesis",
    (a) => (a["topN"] ? ["--top", String(a["topN"])] : []),
    { type: "object", properties: { topN: { type: "number" } } },
    ["mneme.people.lineage", "mneme.insights.regret"],
    () => "Friction pairs returned. Treat as 'investigate', not 'judge' — friction is observable, root cause isn't.",
  ),
  peep(
    "mneme.people.influence",
    "Cultural alphas — PageRank of code-pattern adoption. Identifies authors whose patterns OTHERS copy. " +
      "Volume-independent: a junior with 3 widely-copied patterns scores higher than a senior who churns 1000 LOC. " +
      "Use WHEN user asks: 'who shapes the codebase culture?', 'trend-setters', 'cultural leaders'.",
    ["who sets coding patterns", "ใครเขียน pattern ที่คนอื่นลอก", "trend-setters"],
    "influence",
    (a) => (a["topN"] ? ["--top", String(a["topN"])] : []),
    { type: "object", properties: { topN: { type: "number" } } },
    ["mneme.people.passport", "mneme.people.lineage"],
    () => "Influence ranking returned. Note: PageRank measures adoption, not quality — alphas may set BAD patterns too.",
  ),
  peep(
    "mneme.people.lineage",
    "Trace SEMANTIC ownership of a target file/symbol — whose interpretation of whose intent is in this code now? " +
      "Returns ownership shares + role inference (originator / finisher / refactorer / janitor). " +
      "Use WHEN user asks: 'who owns this code conceptually?', 'whose vision is in src/auth.ts?'.",
    ["semantic ownership of src/auth.ts", "whose vision is in this code?"],
    "lineage",
    (a) => [String(a["target"] ?? "")],
    { type: "object", properties: { target: { type: "string", description: "File path, file:line, or symbol name" } }, required: ["target"] },
    ["mneme.people.passport", "mneme.people.atrophy"],
  ),
  peep(
    "mneme.people.passport",
    "Per-engineer dossier composing DNA + expertise + telepathic teammates + influence + atrophy. " +
      "Use WHEN user asks: 'tell me about Alice', 'profile for alice@', 'one-pager for this engineer'.",
    ["tell me about alice@bank.com", "profile of this engineer"],
    "passport",
    (a) => (a["authorEmail"] ? [String(a["authorEmail"])] : []),
    { type: "object", properties: { authorEmail: { type: "string" } }, required: ["authorEmail"] },
    ["mneme.people.atrophy", "mneme.people.influence", "mneme.people.lineage"],
    () => "Passport dossier returned. Cross-reference with atrophy + lineage for full context.",
  ),
  peep(
    "mneme.people.who_knows",
    "Find people most likely to know about a topic, ranked by recent + sustained engagement. " +
      "Use WHEN user asks: 'who knows about X?', 'expert on payments?', 'point of contact for Y'.",
    ["who knows about rate limiting", "expert on payments", "ใครรู้เรื่อง auth"],
    "who-knows",
    (a) => [String(a["topic"] ?? "")],
    { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] },
    ["mneme.people.passport", "mneme.people.atrophy"],
  ),
  peep(
    "mneme.people.bus_factor",
    "Identify single-point-of-knowledge holders — files where one author owns ≥75%. " +
      "Use WHEN user asks: 'where's the bus factor?', 'knowledge at risk if X leaves?'.",
    ["bus factor", "knowledge at risk if alice leaves"],
    "bus-factor",
    (a) => (a["topN"] ? ["--top", String(a["topN"])] : []),
    { type: "object", properties: { topN: { type: "number" } } },
    ["mneme.people.passport", "mneme.people.atrophy", "mneme.people.telepathy"],
  ),
  peep(
    "mneme.people.nervous_system",
    "Flagship combined report: passports + telepathy + atrophy + influence + neuroanatomy. " +
      "Use WHEN user asks: 'team health snapshot', 'big-picture team view', 'export everything for the board'.",
    ["team health report", "nervous-system snapshot"],
    "nervous-system",
    (a) => (a["topN"] ? ["--top", String(a["topN"])] : []),
    { type: "object", properties: { topN: { type: "number" } } },
    ["mneme.people.passport", "mneme.people.atrophy", "mneme.people.influence"],
    () => "Full nervous-system report returned. Headline metrics in data.hero.metrics.",
  ),
  peep(
    "mneme.people.promise",
    "Promise-debt ledger — every 'I'll fix this later' / TODO / FIXME from commits + PRs, with author + age. " +
      "Use WHEN user asks: 'unkept promises', 'TODO debt', 'who has the most stale promises?'.",
    ["TODO debt by author", "stale promises"],
    "promise",
    (a) => {
      const out: string[] = [];
      if (a["status"]) out.push("--status", String(a["status"]));
      return out;
    },
    {
      type: "object",
      properties: {
        status: { type: "string", description: "open | stale | kept" },
      },
    },
    ["mneme.quality.karma", "mneme.insights.ghost"],
    () => "Promise extraction is heuristic — false positives possible from TODO-style design markers.",
  ),
];
