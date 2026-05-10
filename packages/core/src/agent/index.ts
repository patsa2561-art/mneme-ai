/**
 * Mneme Agent -- public surface.
 *
 *   pickBestBackend(prefer?) -> AgentBackend | null
 *   runAgent({ repoRoot, task, tools, toolExecutor }) -> AgentRunResult
 *   ollamaBackend(), anthropicBackend(), openaiBackend()
 */

export type {
  AgentBackend, AgentBackendId, AgentTurn, AgentToolCall, AgentToolSchema, AgentRunResult,
} from "./types.js";
export { ollamaBackend, parseAgentReply } from "./ollama.js";
export { anthropicBackend, openaiBackend } from "./api_backends.js";
export { runAgent, pickBestBackend } from "./runtime.js";
export type { RunAgentOptions } from "./runtime.js";

/** Path 11 -- adapter interface for future agentic features in
 *  AI clients (Cursor Composer, Claude Code agentic mode, etc.).
 *  Not yet implemented for any specific client; the interface is
 *  here so plug-ins can register without core changes. */
export interface AgenticClientAdapter {
  /** "cursor-composer" | "claude-code-agent" | "windsurf-cascade" */
  id: string;
  label: string;
  available(): Promise<boolean>;
  /** Send a "background task" to the client's agent loop. */
  dispatch(task: { title: string; description: string }): Promise<{ ok: boolean; detail?: string; error?: string }>;
}

/** Stub adapters. Real implementations require client-specific
 *  protocols (e.g., a Cursor extension API that doesn't exist
 *  publicly yet). When those land, swap the stubs in. */
export function adapterCursorComposer(): AgenticClientAdapter {
  return {
    id: "cursor-composer",
    label: "Cursor Composer (background agent)",
    async available(): Promise<boolean> { return false; }, // no public API
    async dispatch() { return { ok: false, error: "no public API yet" }; },
  };
}
export function adapterClaudeCodeAgent(): AgenticClientAdapter {
  return {
    id: "claude-code-agent",
    label: "Claude Code agentic mode (background)",
    async available(): Promise<boolean> { return false; },
    async dispatch() { return { ok: false, error: "no public API yet" }; },
  };
}
