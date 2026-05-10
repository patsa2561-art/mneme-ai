/**
 * Agent runtime -- the autonomous loop.
 *
 *   1. Pick best available backend (Ollama -> Anthropic -> OpenAI).
 *   2. Build prompt from current pulse + task description.
 *   3. Loop:
 *      - backend.step()
 *      - if finalAnswer -> return
 *      - if toolCalls -> execute via host's toolExecutor
 *      - feed results back into next prompt
 *      - max 5 turns (step budget)
 *   4. Persist transcript to .mneme/agent/runs/<runId>.json
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentBackend, AgentRunResult, AgentToolSchema, AgentTurn } from "./types.js";
import { ollamaBackend } from "./ollama.js";
import { anthropicBackend, openaiBackend } from "./api_backends.js";

export interface RunAgentOptions {
  repoRoot: string;
  /** What you want the agent to accomplish. */
  task: string;
  /** Tools the agent may call. */
  tools: AgentToolSchema[];
  /** Host-supplied executor that runs the named tool. */
  toolExecutor: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Optional system prompt override. */
  systemPrompt?: string;
  /** Backend preference; default: try ollama-local, then anthropic, then openai. */
  preferBackend?: "ollama-local" | "anthropic-api" | "openai-api";
  /** Step budget. Default 5. */
  maxSteps?: number;
}

const DEFAULT_SYSTEM = `
You are Mneme's autonomous background agent. You receive a TASK and a list
of TOOLS you can call. Your job: complete the task with as few tool calls
as possible. After each tool result, decide whether to call another tool
or finish.

To call a tool, emit one JSON object on its own line:
  {"tool": "<tool_name>", "args": {...}}

To finish, emit:
  {"final": "<one-paragraph plain-English summary of what you did>"}

Rules:
- Be conservative: don't run destructive operations unless the task
  explicitly asks for them.
- If a tool fails, surface the error in the final answer; don't loop.
- Keep responses short. The user will read your final answer in a toast
  notification (max 200 chars).
`.trim();

export async function pickBestBackend(prefer?: RunAgentOptions["preferBackend"]): Promise<AgentBackend | null> {
  const candidates: AgentBackend[] = [];
  if (prefer === "anthropic-api") candidates.push(anthropicBackend(), ollamaBackend(), openaiBackend());
  else if (prefer === "openai-api") candidates.push(openaiBackend(), ollamaBackend(), anthropicBackend());
  else candidates.push(ollamaBackend(), anthropicBackend(), openaiBackend());
  for (const b of candidates) {
    try { if (await b.available()) return b; } catch { /* skip */ }
  }
  return null;
}

export async function runAgent(opts: RunAgentOptions): Promise<AgentRunResult> {
  const t0 = Date.now();
  const runId = randomUUID();
  const maxSteps = opts.maxSteps ?? 5;
  const turns: AgentTurn[] = [];
  let toolCallsExecuted = 0;
  let finalAnswer = "";
  let status: AgentRunResult["status"] = "complete";

  const backend = await pickBestBackend(opts.preferBackend);
  if (!backend) {
    return {
      backend: "ollama-local",
      turns: [],
      finalAnswer: "(no backend available; install Ollama locally or set ANTHROPIC_API_KEY/OPENAI_API_KEY)",
      toolCallsExecuted: 0,
      totalMs: Date.now() - t0,
      status: "backend-failed",
    };
  }

  let userPrompt = opts.task;
  for (let step = 0; step < maxSteps; step++) {
    const turn = await backend.step({
      systemPrompt: opts.systemPrompt ?? DEFAULT_SYSTEM,
      userPrompt,
      tools: opts.tools,
    });
    turns.push(turn);
    if (!turn.ok) { status = "backend-failed"; finalAnswer = turn.error ?? "(backend error)"; break; }
    if (turn.finalAnswer && turn.toolCalls.length === 0) {
      finalAnswer = turn.finalAnswer.slice(0, 600);
      break;
    }
    if (turn.toolCalls.length > 0) {
      const results: Array<{ tool: string; ok: boolean; result?: unknown; error?: string }> = [];
      for (const call of turn.toolCalls) {
        try {
          const r = await opts.toolExecutor(call.toolName, call.args);
          results.push({ tool: call.toolName, ok: true, result: r });
          toolCallsExecuted++;
        } catch (e) {
          results.push({ tool: call.toolName, ok: false, error: (e as Error).message });
        }
      }
      // Feed results back as the next user prompt.
      userPrompt = `Previous tool results:\n${JSON.stringify(results, null, 2)}\n\nDecide next: another tool call, or final answer.`;
      continue;
    }
    // No tool calls + no final answer -> treat thought as final.
    finalAnswer = (turn.thought || turn.finalAnswer || "(empty agent reply)").slice(0, 600);
    break;
  }
  if (turns.length >= maxSteps && !finalAnswer) {
    status = "step-budget-exceeded";
    finalAnswer = `(agent exceeded ${maxSteps} steps without finishing)`;
  }
  // Persist transcript.
  try {
    const dir = join(opts.repoRoot, ".mneme/agent/runs");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${runId}.json`), JSON.stringify({
      runId, backend: backend.id, task: opts.task, turns,
      finalAnswer, toolCallsExecuted, status, ranAt: new Date().toISOString(),
      totalMs: Date.now() - t0,
    }, null, 2), "utf8");
  } catch { /* best-effort */ }

  return {
    backend: backend.id,
    turns, finalAnswer, toolCallsExecuted,
    totalMs: Date.now() - t0,
    status,
  };
}
