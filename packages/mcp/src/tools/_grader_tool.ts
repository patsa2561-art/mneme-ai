/**
 * mneme.grade.answer — the universal grader tool.
 *
 * The AI student calls this AFTER drafting an answer to a user query.
 * The grader runs all 5 Super Sonic algorithms against the draft and
 * returns PASS / WARN / FAIL with concrete rewrite hints.
 *
 * Loop: AI drafts → calls this → on FAIL, AI rewrites → calls this
 * again with retryCount++. Until PASS or maxRetries.
 */

import { gradeDraft } from "./_grader_engine.js";
import { homeworkForCategory } from "./_homework.js";
import type { MnemeTool, ToolCategory } from "./_types.js";

export const graderTool: MnemeTool = {
  name: "mneme.grade.answer",
  category: "meta",
  description:
    "Grade an AI draft against the homework rubric set by the originating Mneme tool. " +
    "Returns PASS / WARN / FAIL + rewrite hints + per-algorithm verdicts. " +
    "AI student MUST call this after drafting a user-facing answer; on FAIL, AI MUST rewrite using the " +
    "rewriteHints and call grade.answer again with retryCount++. Stop when PASS or maxRetries reached. " +
    "This is the teacher-student loop — Mneme grades the AI's homework before the user ever sees it.",
  triggers: [
    "grade my draft answer",
    "is this answer good enough?",
    "check rubric on draft",
  ],
  inputSchema: {
    type: "object",
    properties: {
      originalQuery: {
        type: "string",
        description: "The user's original question/request",
      },
      aiDraft: {
        type: "string",
        description: "The AI's draft answer to grade",
      },
      sourceCategory: {
        type: "string",
        description:
          "Which Mneme category produced the data the draft was built from " +
          "(memory | people | audit | forensics | insights | quality | quant | lab | meta). " +
          "Used to pick the right rubric.",
      },
      retryCount: {
        type: "number",
        description: "Which attempt this is (0 for first draft, 1 for first rewrite, …).",
      },
    },
    required: ["originalQuery", "aiDraft", "sourceCategory"],
  },
  handler: async (rt, args) => {
    const originalQuery = String(args["originalQuery"] ?? "");
    const aiDraft = String(args["aiDraft"] ?? "");
    const sourceCategory = String(args["sourceCategory"] ?? "memory") as ToolCategory;
    const retryCount = typeof args["retryCount"] === "number" ? (args["retryCount"] as number) : 0;
    const homework = homeworkForCategory(sourceCategory);
    const result = await gradeDraft({
      cwd: rt.meta.rootPath,
      originalQuery,
      aiDraft,
      homework,
      retryCount,
    });
    return {
      data: result,
      wisdom:
        result.verdict === "PASS"
          ? `Draft scores ${result.score}/100 — ready to deliver.`
          : result.verdict === "WARN"
          ? `Draft scores ${result.score}/100 — close, but flagged by ${result.algorithmResults.filter((a) => a.verdict === "WARN").length} algorithm(s). Consider one polish pass.`
          : `Draft scores ${result.score}/100 — FAIL. Rewrite using the rewriteHints, then call mneme.grade.answer again with retryCount=${retryCount + 1}.`,
      followUp: result.verdict === "PASS" ? [] : ["mneme.grade.answer"],
      confidence: { level: "high" },
      secondBrain: {
        presentation:
          result.verdict === "PASS"
            ? "Deliver the draft to the user. Do NOT call other tools unless the user asks a follow-up."
            : "Apply each rewriteHint to the draft. Then call mneme.grade.answer again with the new draft and retryCount incremented. STOP when verdict is PASS or giveUp is true.",
      },
    };
  },
};
