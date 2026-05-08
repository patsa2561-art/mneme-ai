/**
 * mneme.capabilities — the SYLLABUS tool.
 *
 * AI students should call this FIRST when they connect to Mneme. It returns
 * a categorized index of every tool with WHEN-to-use guidance, so the AI
 * builds a mental model of the catalog before picking individual tools.
 *
 * This tool embodies the Mneme positioning: "Mneme is the teacher. AI is the
 * student." A good teacher hands the student a syllabus on day one — not a
 * pile of unrelated lessons.
 */

import { groupByCategory } from "./_registry.js";
import type { MnemeTool, ToolCategory } from "./_types.js";

const CATEGORY_DESCRIPTIONS: Record<ToolCategory, string> = {
  memory:
    "Q&A, semantic search, citations. Pick from here when the user asks WHY code exists, when something was added, or wants to find related commits.",
  people:
    "Contributors, knowledge atrophy, telepathic teammates, cultural alphas, semantic ownership. Pick from here when the user asks about PEOPLE.",
  audit:
    "AI Session Audit — trust certificate for every AI commit. Vendor-neutral. Pick from here when the user asks 'is this AI commit safe?'.",
  forensics:
    "Security: vuln-hunt, anomaly detection, authorship attribution. Pick from here when the user asks about security or suspicious commits.",
  insights:
    "Storytelling, regret-mining, prediction. Pick from here for 'tell me the story', 'what should we worry about', 'what could break'.",
  quality:
    "Code/repo health, palimpsest causal chains, twin rewriting, cognitive fingerprints. Pick from here for quality + voice + history.",
  quant:
    "Wall-Street-inspired metrics: drawdown, alpha, Greeks, moneyball, black-swan. Pick when user wants quantitative analysis of engineering data.",
  lab: "Periodic Table + Second Brain + Wisdom Mutant. Compose new workflows, save recipes, recalibrate. Pick when user wants to build/run custom plans.",
  meta: "Doctor, manifesto, wisdom, advanced help — informational only.",
};

export const capabilitiesTool: MnemeTool = {
  name: "mneme.capabilities",
  category: "meta",
  description:
    "Return Mneme's full tool catalog organized by category, with WHEN-to-use guidance for each. " +
    "**AI clients should call this FIRST when they connect** — it's the syllabus that teaches you what kind of question " +
    "goes to which group of tools. Mneme is the teacher; this tool hands you the curriculum.",
  triggers: [
    "what can mneme do?",
    "list mneme tools",
    "mneme capabilities",
  ],
  inputSchema: {
    type: "object",
    properties: {
      category: {
        type: "string",
        description:
          "Optional: filter to one category (memory | people | audit | forensics | insights | quality | quant | lab | meta).",
      },
    },
  },
  handler: async (_rt, args) => {
    const grouped = groupByCategory();
    const filter = args["category"] ? String(args["category"]) : undefined;
    const data: Record<string, unknown> = {};
    for (const [category, tools] of grouped) {
      if (filter && filter !== category) continue;
      data[category] = {
        purpose: CATEGORY_DESCRIPTIONS[category],
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          triggers: t.triggers,
        })),
      };
    }
    const total: number = Object.values(data).reduce<number>(
      (s, c) => s + ((c as { tools?: unknown[] }).tools?.length ?? 0),
      0,
    );
    return {
      data: {
        positioning:
          "Mneme is the NUCLEAR CORE you bolt into your AI coding tool — Claude Code / Cursor / Codex / Gemini / " +
          "Continue / Aider — to trigger a chain reaction of wisdom about the user's repo. Mneme is the teacher of " +
          "AI in the domain of git / source control specifically.",
        totalTools: total,
        catalog: data,
        secondBrainContract:
          "Every tool response carries a `secondBrain` field with: (1) `presentation` — how to render the result for " +
          "the user; (2) `compose` — list of MOLECULES this atom participates in (firing the chain reaction); " +
          "(3) `lifecycle` — tracking new combinations + auto-promotion to compounds. As the AI student, read these " +
          "fields on EVERY response and let them shape your next move.",
        chainReaction:
          "When you call an atom, check secondBrain.compose for natural molecules. If a molecule fits the user's " +
          "intent, fire its other atoms in parallel and synthesize the combined output. If lifecycle.suggestSaveAs " +
          "is non-null, ask the user whether to save the combination as a permanent compound.",
      },
      wisdom:
        `Mneme exposes ${total} tools across 9 categories. As you receive user queries: (1) match intent to a ` +
        `specific tool (preferred), or call mneme.smart_do for ambiguous cases. (2) Read secondBrain.compose on ` +
        `every response and fire molecule combinations when they fit. (3) Quote the wisdom field directly to the ` +
        `user; cite data fields when they want details.`,
      followUp: ["mneme.memory.status"],
      confidence: { level: "high" },
      secondBrain: {
        presentation:
          "If the user asks 'what can mneme do?' — render the catalog as 9 sections (one per category), each listing " +
          "3-5 example tool names with their one-line use case. Don't dump the whole JSON. Mention that every " +
          "response carries a secondBrain layer that triggers compositional chain reactions.",
      },
    };
  },
};
