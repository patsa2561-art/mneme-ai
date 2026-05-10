/**
 * Mneme Agent -- the autonomous "background AI" that lets Mneme TAKE
 * ACTION without waiting for an external client.
 *
 *   Backend: Ollama (local, free, default; uses your GPU/CPU)
 *            OR Claude API / OpenAI API (optional, paid, opt-in)
 *
 * The agent receives a prompt + a list of MCP-style tool schemas it
 * can call. It returns either a text reply OR a sequence of tool
 * invocations the daemon executes. Loop continues until the agent
 * decides "done" or hits a step budget.
 *
 * Use cases:
 *   - Daemon detects update available -> agent decides "yes, upgrade"
 *     -> calls mneme.system.upgrade -> reports back via notifier
 *   - Antivirus uncertified -> agent runs benchmark -> reports
 *   - Lockfile drift -> agent runs heal-lockfile -> reports
 */

export type AgentBackendId = "ollama-local" | "anthropic-api" | "openai-api";

export interface AgentToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AgentToolCall {
  toolName: string;
  args: Record<string, unknown>;
}

export interface AgentTurn {
  /** Reasoning step the agent emitted (free-form text). */
  thought: string;
  /** Zero or more tool calls the agent wants the host to execute. */
  toolCalls: AgentToolCall[];
  /** When set, the agent considers itself done and reports this final answer. */
  finalAnswer?: string;
  /** Did the backend run successfully? */
  ok: boolean;
  /** ms for the inference call. */
  ms: number;
  /** Error if !ok. */
  error?: string;
}

export interface AgentBackend {
  id: AgentBackendId;
  label: string;
  /** True iff backend is reachable + configured (env keys, daemon running, etc.). */
  available(): Promise<boolean>;
  /** One inference turn: prompt + tools -> AgentTurn. */
  step(input: { systemPrompt: string; userPrompt: string; tools: AgentToolSchema[] }): Promise<AgentTurn>;
}

export interface AgentRunResult {
  backend: AgentBackendId;
  turns: AgentTurn[];
  finalAnswer: string;
  toolCallsExecuted: number;
  totalMs: number;
  status: "complete" | "step-budget-exceeded" | "backend-failed";
}
