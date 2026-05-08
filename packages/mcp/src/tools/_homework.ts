/**
 * Rubric library — what each tool's draft answer must satisfy before
 * being delivered to the user.
 *
 * One rubric per category (9 categories) acts as the DEFAULT — every
 * tool inherits its category's rubric automatically. Tools that need
 * a stricter or looser rubric can override in their handler by
 * setting `secondBrain.homework` directly.
 *
 * The Super Sonic Engine: every Mneme tool response now carries a
 * homework rubric the AI must satisfy. AI drafts → calls
 * mneme.grade.answer → on FAIL, rewrites → loop until PASS. This
 * pattern is unique to Mneme; no other MCP server enforces it.
 */

import type { Homework, ToolCategory } from "./_types.js";

/** The 5-axis core requirements every Mneme answer must satisfy.
 *  Categories layer their own additional requirements on top. */
const BASE_REQUIREMENTS = [
  {
    id: "no-hallucinated-citations",
    description: "Every commit hash mentioned must exist in the repo (verified via git rev-parse).",
    weight: 1.0,
  },
  {
    id: "no-empty-wisdom",
    description: "The wisdom field must be a non-empty, non-trivial sentence — not just 'see data'.",
    weight: 0.8,
  },
  {
    id: "confidence-stated",
    description: "The answer must state its confidence (high/medium/low) when claims involve heuristics.",
    weight: 0.6,
  },
];

/** Category-specific requirement layers. */
const CATEGORY_REQUIREMENTS: Record<ToolCategory, Array<{ id: string; description: string; weight: number }>> = {
  memory: [
    { id: "citation-density", description: "≥3 commit citations for any 'why' question, ≥1 for any factual claim.", weight: 1.0 },
    { id: "no-claim-without-citation", description: "Every factual claim about the repo must trace to a specific commit.", weight: 1.0 },
    { id: "summary-bounded", description: "Summary ≤ 200 words; longer needs collapsible details.", weight: 0.5 },
  ],
  people: [
    { id: "no-defamation", description: "Friction/atrophy/nemesis findings framed neutrally — observable behavior, never personal judgment.", weight: 1.0 },
    { id: "atrophy-bounded", description: "Atrophy scores include the 'days since last touch' so reader can verify.", weight: 0.7 },
    { id: "name-the-author", description: "Always identify the specific author (email or name) when applicable.", weight: 0.8 },
  ],
  audit: [
    { id: "all-axes-graded", description: "Trust certificate must score every applicable axis (behavioral / API / tests / perf / narrative).", weight: 1.0 },
    { id: "verdict-matches-axes", description: "Overall PASS/WARN/FAIL must be consistent with the per-axis findings.", weight: 1.0 },
    { id: "remediation-actionable", description: "Every FAIL axis must include a concrete fix recommendation.", weight: 0.9 },
  ],
  forensics: [
    { id: "cwe-cited", description: "Every vuln finding cites its CWE class (e.g. CWE-89, CWE-79).", weight: 1.0 },
    { id: "evidence-quoted", description: "Show the actual line of code that triggered the rule.", weight: 0.9 },
    { id: "false-positive-disclaimer", description: "Always remind the reader that findings are CANDIDATES — verify before action.", weight: 0.7 },
  ],
  insights: [
    { id: "narrative-cohesion", description: "Story / chronicle / time-machine answers must follow chronological + causal order.", weight: 0.8 },
    { id: "ground-in-history", description: "Insights must cite ≥2 commits or PRs as evidence — no speculation without anchor.", weight: 0.9 },
    { id: "actionable", description: "End with a concrete next-step the user can take.", weight: 0.7 },
  ],
  quality: [
    { id: "metric-explained", description: "Every metric stated (atrophy / heartbeat / karma / DNA) must be one-sentence explained inline.", weight: 0.8 },
    { id: "outliers-flagged", description: "Top-3 outliers (most-unusual axes / files / authors) must be highlighted explicitly.", weight: 0.7 },
  ],
  quant: [
    { id: "math-transparent", description: "When a quant metric is reported, briefly state the formula / methodology.", weight: 0.7 },
    { id: "limits-named", description: "Acknowledge the corpus + assumptions the quant ran against.", weight: 0.6 },
  ],
  lab: [
    { id: "plan-auditable", description: "Composed plans show every step + the atom each step calls.", weight: 0.9 },
    { id: "side-effects-named", description: "Plans that hit network / filesystem / git / subprocess declare it upfront.", weight: 1.0 },
  ],
  meta: [
    { id: "scoped", description: "Meta tools (capabilities, doctor, wisdom) keep output scoped to their purpose — no scope creep.", weight: 0.5 },
  ],
};

/** Category default rubrics — the writing the AI must produce per category. */
const CATEGORY_RUBRICS: Record<ToolCategory, string> = {
  memory:
    "Quote the wisdom field directly. Cite ≥3 commits with their short hashes inline. Don't invent commits. " +
    "If <3 citations available, tell the user the answer is best-effort.",
  people:
    "Frame neutrally — describe observable behavior, never personal character. Always name the specific author. " +
    "Include the heuristic caveat (e.g. 'atrophy is heuristic, not certified knowledge measurement').",
  audit:
    "Lead with the verdict (PASS/WARN/FAIL) in bold. List every axis with its score + one-line justification. " +
    "For every FAIL axis, give a specific fix the developer can apply right now.",
  forensics:
    "Open with severity + CWE class. Quote the offending line of code. Always disclose: this is a CANDIDATE, " +
    "verify before acting. Never claim certainty without confirming the rule prior matches the stack.",
  insights:
    "Tell a story — chronological, causal, anchored to specific commits. End with one concrete action the " +
    "user can take. Avoid speculation that isn't grounded in the diff or PR text.",
  quality:
    "State the metric, then translate it to plain English. Highlight the top-3 outliers explicitly. " +
    "Skip rendering rows that are within normal range unless asked.",
  quant:
    "When a number appears, name the formula or method in one phrase. Acknowledge the corpus the metric ran " +
    "against. Quant findings are signals, not verdicts.",
  lab:
    "If you're emitting a plan, show every step with the atom it calls. Declare side-effects upfront. " +
    "Default to dry-run unless the user explicitly opts into execution.",
  meta:
    "Stay scoped to the meta-question. The capabilities tool returns a syllabus; the doctor returns env state; " +
    "the wisdom tool returns a meditation. Don't mix scopes.",
};

/** All 5 novel grading algorithms applied by default — except for the
 *  meta category (where mutation tests would be silly). */
const DEFAULT_ALGORITHMS_BY_CATEGORY: Record<ToolCategory, Array<import("./_types.js").GradingAlgorithm>> = {
  memory:    ["semantic-citation", "adversarial-probe", "claim-graph-mutation"],
  people:    ["semantic-citation", "claim-graph-mutation"],
  audit:     ["multi-verifier-consensus", "mutation-counterfactual", "claim-graph-mutation"],
  forensics: ["adversarial-probe", "semantic-citation", "multi-verifier-consensus"],
  insights:  ["semantic-citation", "claim-graph-mutation", "adversarial-probe"],
  quality:   ["claim-graph-mutation", "semantic-citation"],
  quant:     ["mutation-counterfactual", "multi-verifier-consensus"],
  lab:       ["claim-graph-mutation"],
  meta:      [],
};

/** Build the homework block for a tool, given its category. */
export function homeworkForCategory(category: ToolCategory): Homework {
  return {
    rubric: CATEGORY_RUBRICS[category],
    requirements: [...BASE_REQUIREMENTS, ...CATEGORY_REQUIREMENTS[category]],
    grader: "mneme.grade.answer",
    maxRetries: 3,
    algorithms: DEFAULT_ALGORITHMS_BY_CATEGORY[category],
  };
}
