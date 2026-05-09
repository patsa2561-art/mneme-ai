/**
 * MCP tool type system — the contract every Mneme tool implements.
 *
 * Design principle: every response carries WISDOM, not just data. AI clients
 * shouldn't need to interpret raw JSON — Mneme pre-digests each finding into
 * a 1-3 sentence narrative the AI can quote (or paraphrase) directly to the
 * user. Citations live in `data`, the human meaning lives in `wisdom`.
 */

import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { git, store, EmbeddingProvider } from "@mneme-ai/core";
import { security } from "@mneme-ai/core";

/** Categories for the syllabus tool — AI student reads this index first
 *  and learns what kind of question goes to which group of tools. */
export type ToolCategory =
  | "memory"     // Q&A, search, citations — "why does X exist?"
  | "people"     // contributors, atrophy, telepathy, influence
  | "audit"      // AI session audit — trust certificate for AI commits
  | "forensics"  // security, vuln-hunt, attribution, anomaly
  | "insights"   // ghost, regret, premortem, oracle, time-machine
  | "quality"    // karma, repo-mri, heartbeat, twin, palimpsest
  | "quant"      // drawdown, alpha, moneyball, greeks (Wall-Street-inspired)
  | "lab"        // periodic-table, library, compose, run, calibrate
  | "meta";      // wisdom, manifesto, capabilities, advanced

/** Wrapped response — every tool returns this shape so AI gets data + wisdom
 *  + cross-references + Second-Brain teaching in one consistent envelope.
 *
 *  Architectural intent: the AI tool is the BASE REACTOR. Mneme is the
 *  NUCLEAR CORE. Every tool call doesn't just return data — it teaches the
 *  AI how to interpret + present + COMPOSE the result with other atoms,
 *  triggering a chain reaction of wisdom across the AI's session.
 */
export interface ToolResponse<TData = unknown> {
  /** Structured data the AI parses + uses */
  data: TData;
  /** 1-3 sentences in plain English explaining what the data means.
   *  AI quotes or paraphrases this when answering the user. */
  wisdom: string;
  /** Tool names the AI might call next for deeper context.
   *  Example: after `mneme.people.atrophy` → suggest `mneme.people.passport` */
  followUp?: string[];
  /** Confidence + caveats — when to trust this, when to flag heuristic limits */
  confidence?: {
    level: "high" | "medium" | "low";
    notes?: string;
  };
  /** Second Brain layer — teaches the AI HOW to use this result.
   *  This is what triggers the chain reaction of wisdom. */
  secondBrain?: SecondBrain;
}

/** Second Brain — meta-instructions embedded in every tool response.
 *  Sets off the chain reaction: AI sees compose hints, fires more tool
 *  calls, those compositions become molecules, frequent molecules promote
 *  to compounds. The system gets smarter with every interaction. */
export interface SecondBrain {
  /** How the AI should PRESENT this result to the user.
   *  Example: "Render top-5 fading areas as a horizontal bar chart with
   *  scores 0-100. Color scores < 30 in red. Don't show raw JSON." */
  presentation?: string;
  /** Suggested molecules — atom combinations that yield deeper insight.
   *  AI student can fire these in parallel for richer answers. */
  compose?: ComposeSuggestion[];
  /** Lifecycle metadata — for tracking new combinations and auto-promoting
   *  frequent ones into named compounds. */
  lifecycle?: ToolLifecycle;
  /** Homework — the rubric the AI's draft answer must satisfy before
   *  delivery to the user. Triggers the teacher-student grading loop:
   *  AI drafts → calls mneme.grade.answer → on FAIL, AI rewrites → repeat
   *  until PASS or maxRetries. The Super Sonic Engine that makes Mneme
   *  the only MCP server in the world that grades the AI's work. */
  homework?: Homework;
  /** v1.23.5 — auto-actions Mneme has decided the AI agent should
   *  EXECUTE, not ask the user about. Pattern: announce-before -> call
   *  the named tool with given args -> announce-after. The user sees
   *  two short sentences; never a yes/no question.
   *
   *  Mneme is the TEACHER; the AI is the student. When Mneme decides
   *  the right next step is "upgrade now", it doesn't say "want to
   *  upgrade?" -- it says "upgrading now" + does it.
   *
   *  AGENT_INSTRUCTIONS.md teaches the AI to scan secondBrain.autoActions
   *  on every tool response and execute them in order without asking. */
  autoActions?: AutoAction[];
}

/** v1.23.5 — a Mneme-issued instruction the AI agent runs without asking.
 *  Always announce-before + announce-after; never a question to the user. */
export interface AutoAction {
  /** MCP tool name to call. Must exist in the registry. */
  tool: string;
  /** Arguments object passed verbatim to the tool. */
  args: Record<string, unknown>;
  /** What the AI tells the user BEFORE calling the tool.
   *  Plain English, ≤ 20 words, no question marks. */
  announceBefore: string;
  /** What the AI tells the user AFTER the call returns. May reference
   *  the result. ≤ 30 words. */
  announceAfter: string;
  /** When `true`, this action requires explicit user confirmation
   *  (rare; only for destructive ops like `mneme lineage purge`).
   *  Default: false (auto-execute). */
  requiresUserConfirm?: boolean;
  /** Stable id used for de-duplication across retries / repeat dispatches.
   *  Same id in the same session = AI executes once, not N times. */
  id?: string;
}

/** Homework — the rubric a tool's answer must satisfy.
 *  Embedded in secondBrain so the AI student knows the bar before it
 *  drafts the user-facing answer. */
export interface Homework {
  /** Plain-English rubric describing what a good answer looks like */
  rubric: string;
  /** Specific testable requirements — each scored 0-1, weighted */
  requirements: Requirement[];
  /** The MCP tool name to call for grading. Default: mneme.grade.answer */
  grader: string;
  /** Maximum rewrite attempts before the AI gives up + tells the user
   *  about the grader failures. Default 3. */
  maxRetries: number;
  /** Which novel grading algorithms to apply (top-class — no other MCP
   *  server runs these). */
  algorithms: GradingAlgorithm[];
}

export interface Requirement {
  /** Stable id, e.g. "citation-density" */
  id: string;
  /** Human-readable description of what this requirement enforces */
  description: string;
  /** Importance weight 0-1 — used in scoring */
  weight: number;
}

/** Five novel grading algorithms — none of these run in any other MCP
 *  server today. Together they form the Super Sonic Engine. */
export type GradingAlgorithm =
  /** Inject a subtle false claim into the original query and re-ask the AI's
   *  draft. If the draft repeats the false claim, FAIL ("AI accepted false
   *  premise"). */
  | "adversarial-probe"
  /** Mutate one node in the AI's claim graph (flip "added" → "removed").
   *  Re-grade. If verdict unchanged, the original claim was non-load-bearing.
   *  FAIL ("fluff detected"). */
  | "claim-graph-mutation"
  /** For every commit hash AI cited, compute cosine similarity between
   *  (the claim it supports) and (commit message + diff). If avg < 0.6,
   *  citations are decorative not semantic. FAIL ("citations not load-bearing"). */
  | "semantic-citation"
  /** Run AI's draft through 4 verifiers (Bayesian / Stylometric / Entropy /
   *  LLM-judge). Use Jensen-Shannon divergence to measure consensus. High
   *  divergence = WARN ("verifiers disagreed"). */
  | "multi-verifier-consensus"
  /** Take AI's PASSING draft. Mutate one key fact (flip recommended action
   *  / flip a number / negate a verdict). Re-grade. If still PASS, the
   *  rubric is too lenient — rubric mutation FAIL ("rubric brittle"). */
  | "mutation-counterfactual";

/** What the grader returns. AI student reads this and either delivers the
 *  draft (PASS) or rewrites and tries again (WARN/FAIL). */
export interface GraderResult {
  /** Final verdict */
  verdict: "PASS" | "WARN" | "FAIL";
  /** Composite score 0-100 */
  score: number;
  /** Human-readable feedback for the AI to act on */
  feedback: string[];
  /** IDs of requirements that passed */
  passedRequirements: string[];
  /** IDs of requirements that failed (with one-line reason each) */
  failedRequirements: Array<{ id: string; reason: string }>;
  /** Concrete instructions for the AI's rewrite */
  rewriteHints: string[];
  /** Per-algorithm verdicts (for transparency / debugging) */
  algorithmResults: Array<{ algorithm: GradingAlgorithm; verdict: "PASS" | "WARN" | "FAIL"; detail: string }>;
  /** Retry counter (the AI sets this when calling the grader) */
  retryCount: number;
  /** If true, AI should stop retrying and surface the issue to the user */
  giveUp: boolean;
}

/** A suggested composition — "if you ran THIS atom, the natural next step
 *  is to fire THESE atoms together to form THIS molecule." */
export interface ComposeSuggestion {
  /** Name for the resulting molecule, e.g. "succession_plan" */
  molecule: string;
  /** The atoms (other Mneme tool names) that form this molecule together */
  atoms: string[];
  /** When the AI should suggest / auto-fire this composition */
  when: string;
  /** Optional: a sample answer template the AI can adapt */
  example?: string;
}

/** Lifecycle data for tracking new combinations + promoting them. */
export interface ToolLifecycle {
  /** True if this combination is novel for the current repo's library */
  isNewCombination?: boolean;
  /** If non-null, the AI should ASK the user whether to save this
   *  combination as a named compound under this alias */
  suggestSaveAs?: string;
  /** How many times the user has run this exact combination —
   *  used by auto-promotion logic (≥3 = promote to compound) */
  invocationCount?: number;
}

/** Runtime context passed to every handler — single source of truth.
 *  Built once per MCP server lifetime, reused across all calls. */
export interface ToolRuntime {
  cwd: string;
  meta: Awaited<ReturnType<typeof git.getRepoMeta>>;
  store: store.MnemeStore;
  embedder: EmbeddingProvider;
}

/** A Mneme tool definition — one per CLI command we expose via MCP.
 *
 *  v1.18 introduces the **Tool Contract Schema** — every tool can carry a
 *  6-field contract that gives AI agents zero-doubt grounding:
 *      WHEN, INPUT (inputSchema), OUTPUT (outputSchema), EXAMPLE, PITFALLS, COMPOSE_WITH
 *  Plus a `jargon` map that translates domain terms inline. The new
 *  `mneme.tool.lint` tool flags any tool that's missing fields, and
 *  `mneme.tool.contract` returns the full contract on demand.
 *
 *  All new fields are OPTIONAL so existing tools continue to work unchanged.
 *  New tools (and refactors of weak existing ones — quant.*, etc.) should
 *  fill them in. The build-time linter sets the bar.
 *
 *  description: write it like a good lesson title — *include WHEN to use + examples*.
 *  AI tool selection is mostly description-matching; vague descriptions = wrong picks. */
export interface MnemeTool<TArgs = Record<string, unknown>, TData = unknown> {
  /** MCP tool name — must match `^mneme\.[a-z_]+\.[a-z_]+$` for grouping */
  name: string;
  /** Category for the capabilities syllabus */
  category: ToolCategory;
  /** Rich description: 2-4 sentences. Include WHEN to use + 2-3 example user
   *  phrases this should match. The AI picks tools by matching user intent
   *  to descriptions, so be specific. */
  description: string;
  /** Example user queries that should trigger this tool. Used for
   *  syllabus generation + description-quality review. */
  triggers: string[];
  /** JSON Schema for input parameters */
  inputSchema: Tool["inputSchema"];
  /** Async handler — receives runtime + parsed args */
  handler: (runtime: ToolRuntime, args: TArgs) => Promise<ToolResponse<TData>>;

  // ─── Tool Contract Schema (v1.18.0) — optional, surfaced by lint + contract ───

  /** Crisp 1-sentence "WHEN should I call this tool?" — surfaced separately
   *  from the description so cold-start agents can scan a list of WHENs. */
  whenToUse?: string;
  /** JSON Schema for the response.data field. Lets agents reason about the
   *  shape of what they'll receive BEFORE making a call. Per MCP spec
   *  2025-06-18 (now relayed through MCP SDK if the client supports it). */
  outputSchema?: Tool["inputSchema"];
  /** 1-3 worked examples — what a real agent invocation looks like end-to-end.
   *  Each example is self-contained (input → expected output sketch). */
  examples?: ToolExample[];
  /** Failure modes / known caveats. Tells the agent when NOT to trust the
   *  output, and how to recover. Each pitfall is one short sentence. */
  pitfalls?: string[];
  /** Other Mneme tools that pair well with this one. Different from
   *  `followUp` (which lives in the response and is dynamic) — this is the
   *  static "natural neighbor" list surfaced in the contract. */
  composeWith?: string[];
  /** Domain-jargon dictionary: term → plain-English explanation.
   *  Critical for quant.* / forensics.* / dna.* tools where the description
   *  uses words like "Greeks", "Kelly", "ENFSI" that a cold-start AI agent
   *  may not understand. The lint tool scans descriptions for known jargon
   *  and FAILS if an unexplained term appears. */
  jargon?: Record<string, string>;
}

/** A worked example for a tool — surfaced in the contract so AI agents
 *  can pattern-match real invocations rather than guess from the schema. */
export interface ToolExample {
  /** What the user asked, in plain English. */
  userQuery: string;
  /** Concrete arguments the agent would pass. */
  args?: Record<string, unknown>;
  /** Sketch of the response shape — not the full response, just enough
   *  to teach the agent what to expect. */
  expectedOutput?: string;
}

/** Convert a wrapped tool response into MCP's expected CallToolResult.
 *  We serialise the entire envelope (data + wisdom + followUp + confidence)
 *  so the AI sees the full picture in one shot.
 *
 *  v1.11.1 — by default, every wisdom + secondBrain.presentation field
 *  is run through the prompt-injection scrubber. Untrusted content
 *  (commit messages, PR text, issue text from federation) cannot smuggle
 *  control tokens like `<system>`, `[INST]`, or "ignore prior instructions"
 *  into the AI's context. Set MNEME_NO_AUTO_SECURITY=1 to disable. */
export function toCallResult(r: ToolResponse): CallToolResult {
  // v1.11.1 — auto-scrub the human-language fields. We intentionally do
  // NOT scrub `data` (which is structured JSON the AI client should treat
  // as data, not as instruction).
  const skipScrub = process.env["MNEME_NO_AUTO_SECURITY"] === "1";
  let wisdom = r.wisdom;
  let secondBrain = (r as unknown as { secondBrain?: { presentation?: string } }).secondBrain;
  if (!skipScrub) {
    try {
      if (typeof wisdom === "string") wisdom = security.scrubber.scrubForPrompt(wisdom).scrubbed;
      if (secondBrain && typeof secondBrain.presentation === "string") {
        secondBrain = { ...secondBrain, presentation: security.scrubber.scrubForPrompt(secondBrain.presentation).scrubbed };
      }
    } catch {
      // best-effort — never block a tool result on scrubber failure
    }
  }
  // v1.19.5: when a tool declares outputSchema, the MCP SDK enforces that
  // the response carries `structuredContent` matching that schema. We map
  // `data` to structuredContent (it IS the structured payload). The text
  // content stays as the full envelope so older clients still see wisdom.
  const envelope = {
    data: r.data,
    wisdom,
    followUp: r.followUp ?? [],
    confidence: r.confidence ?? { level: "medium" },
    ...(secondBrain ? { secondBrain } : {}),
  };
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(envelope, null, 2),
      },
    ],
    // structuredContent is what MCP-spec-2025-06-18 clients validate
    // against outputSchema. Always emit it (no harm to tools without
    // an outputSchema — clients ignore the field in that case).
    // Spec requires a JSON OBJECT — wrap arrays/primitives so non-object
    // `data` values (rare but legal) don't break the spec.
    structuredContent:
      r.data && typeof r.data === "object" && !Array.isArray(r.data)
        ? (r.data as Record<string, unknown>)
        : { value: r.data },
  };
}

/** Convert a thrown error into MCP's expected error result */
export function toErrorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}
