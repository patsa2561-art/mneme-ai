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
      skinny: {
        type: "boolean",
        description:
          "v2.19.41 — return a context-window-safe summary (~2KB instead of full ~214KB). 9 category headers + 1-line description + 3 example tool names per category + handle to fetch full catalog. Use this on first contact; fetch the full catalog only when you actually need it.",
      },
      full: {
        type: "boolean",
        description:
          "v2.26.0 — Explicitly request the FULL catalog (~80K tokens / ~337KB). N5 audit finding: full mode is a context-burn weapon. Default is now skinny; pass full=true ONLY when you really need every tool's description.",
      },
      offset: {
        type: "integer",
        description: "v2.26.0 — Pagination: skip the first N tools when fetching full mode. Defaults to 0.",
      },
      limit: {
        type: "integer",
        description: "v2.26.0 — Pagination: cap returned tools to N. Defaults to 50 in full mode (was unbounded).",
      },
    },
  },
  handler: async (_rt, args) => {
    const grouped = groupByCategory();
    const filter = args["category"] ? String(args["category"]) : undefined;
    // v2.26.0 — N5 fix. skinny is now the DEFAULT; callers must opt in to
    // full mode via `full:true` or explicit `skinny:false`. Pre-v2.26 the
    // default was a 337KB / ~80K-token response per call.
    const fullRequested = args["full"] === true || args["skinny"] === false;
    const skinny = !fullRequested;
    const data: Record<string, unknown> = {};
    // v1.36.0 -- HONEYPOT FILTER. Pre-fix: honeypot tools (admin.delete_all,
    // secrets.dump, system.exec, mneme.config.set as a probe) leaked into
    // the capabilities catalog -- legit AI agents saw them next to real
    // tools and almost called them, which would log the AI as an attacker.
    // Honeypots stay REGISTERED (so probing attackers still fire them),
    // but they are HIDDEN from the syllabus that legit AI clients read.
    const HONEYPOT_NAMES = new Set([
      "mneme.admin.delete_all",
      "mneme.secrets.dump",
      "mneme.system.exec",
      "mneme.config.set",
      "mneme.lineage.exfiltrate",
      "mneme.audit.purge",
    ]);
    let honeypotsHidden = 0;
    for (const [category, tools] of grouped) {
      if (filter && filter !== category) continue;
      const visible = tools.filter((t) => {
        if (HONEYPOT_NAMES.has(t.name)) { honeypotsHidden++; return false; }
        return true;
      });
      data[category] = {
        purpose: CATEGORY_DESCRIPTIONS[category],
        tools: visible.map((t) => ({
          name: t.name,
          description: t.description,
          triggers: t.triggers,
        })),
      };
    }
    void honeypotsHidden;     // available for future telemetry
    const total: number = Object.values(data).reduce<number>(
      (s, c) => s + ((c as { tools?: unknown[] }).tools?.length ?? 0),
      0,
    );

    // v2.19.41 — SKINNY MODE. The full catalog is ~214KB JSON; AI agents
    // burning that on every session start is wasteful. Skinny mode returns
    // a ~2KB summary: 9 category headers + 1-line purpose + 3 example tool
    // names per category. AI agent loads this in cold start; lazy-fetches
    // the full category list when it actually needs to pick a tool.
    if (skinny) {
      const skinnyData: Record<string, unknown> = {};
      for (const [cat, body] of Object.entries(data)) {
        const tools = (body as { tools?: Array<{ name: string }> }).tools ?? [];
        skinnyData[cat] = {
          purpose: (body as { purpose: string }).purpose,
          count: tools.length,
          examples: tools.slice(0, 3).map((t) => t.name),
        };
      }
      return {
        data: {
          mode: "skinny",
          totalTools: total,
          categories: skinnyData,
          fetchFullHint: "Call mneme.capabilities (omit `skinny`) or mneme.capabilities { category: 'memory' } to drill into one family.",
        },
        wisdom: `🧠 ${total} tools across ${Object.keys(skinnyData).length} categories (skinny mode — ~2KB). Pass skinny=false for the full catalog.`,
        confidence: { level: "high" },
      };
    }

    // v2.26.0 — N5 fix: pagination on full mode so a single call cannot
    // burn 80K tokens. Default limit=50 unless caller passes higher.
    const offset = typeof args["offset"] === "number" ? Math.max(0, args["offset"] as number) : 0;
    const limit = typeof args["limit"] === "number" ? Math.max(1, Math.min(500, args["limit"] as number)) : 50;
    const pagedData: Record<string, unknown> = {};
    let returnedCount = 0;
    let skippedCount = 0;
    for (const [cat, body] of Object.entries(data)) {
      const tools = (body as { tools?: Array<unknown> }).tools ?? [];
      const purpose = (body as { purpose: string }).purpose;
      const startIdx = Math.max(0, offset - skippedCount);
      const slice = tools.slice(startIdx, startIdx + Math.max(0, limit - returnedCount));
      pagedData[cat] = { purpose, count: tools.length, tools: slice };
      skippedCount += Math.min(tools.length, offset - skippedCount + slice.length);
      returnedCount += slice.length;
      if (returnedCount >= limit) break;
    }
    const truncated = returnedCount < total;

    return {
      data: {
        mode: "full",
        pagination: { offset, limit, returned: returnedCount, total, truncated, nextOffset: truncated ? offset + returnedCount : null },
        positioning:
          "Mneme is the persistent context provider for your AI coding tool — Claude Code / Cursor / Codex / Gemini / " +
          "Continue / Aider. Mneme indexes the repo's git history + author lineage + prior decisions, then surfaces " +
          "that context (with a grader pass) before the AI delivers an answer to the user. You stay the agent; Mneme " +
          "is the memory + verifier sitting alongside.",
        totalTools: total,
        catalog: pagedData,
        secondBrainContract:
          "Every tool response carries a `secondBrain` field with FOUR fields you must read on every call: " +
          "(1) `presentation` — how to render the result for the user; " +
          "(2) `compose` — list of MOLECULES this atom participates in (chain reaction trigger); " +
          "(3) `lifecycle` — tracks new combinations + auto-promotion to compounds; " +
          "(4) `homework` — the rubric your draft answer must satisfy BEFORE you deliver to the user.",
        graderLoop:
          "After you draft a user-facing answer, you MUST call `mneme.grade.answer` with " +
          "{ originalQuery, aiDraft, sourceCategory, retryCount }. The grader runs 5 novel algorithms " +
          "(adversarial-probe · claim-graph-mutation · semantic-citation · multi-verifier-consensus · " +
          "mutation-counterfactual) and returns PASS / WARN / FAIL with concrete rewrite hints. " +
          "On FAIL: rewrite using the rewriteHints, increment retryCount, call grade.answer again. " +
          "Loop until PASS or until giveUp=true. NO OTHER MCP server enforces this loop — it's what makes " +
          "your answer publishable.",
        chainReaction:
          "Before grading: when you call an atom, check secondBrain.compose for natural molecules. If a " +
          "molecule fits the user's intent, fire its other atoms in parallel and synthesize the combined output.",
      },
      wisdom:
        `Mneme exposes ${total} tools across 9 categories. The context-provider protocol: ` +
        `(1) match user intent to a specific tool, or call mneme.smart_do for ambiguous cases. ` +
        `(2) Read secondBrain.compose; fire molecule combinations when they fit. ` +
        `(3) Draft your answer. ` +
        `(4) Call mneme.grade.answer with the draft. On FAIL, rewrite per rewriteHints and retry. ` +
        `(5) Only deliver to the user once the grader returns PASS (or giveUp=true).`,
      followUp: ["mneme.memory.status", "mneme.grade.answer"],
      confidence: { level: "high" },
      secondBrain: {
        presentation:
          "Render as 9 sections (one per category), 3-5 example tools each. Mention the grader-loop contract: " +
          "every Mneme answer is graded by 5 novel algorithms before delivery. Mneme is the only MCP server in " +
          "the world that grades the AI's homework.",
      },
    };
  },
};
