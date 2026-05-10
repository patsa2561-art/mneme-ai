/**
 * Path 2 + D -- Local Ollama backend.
 *
 * Detects http://localhost:11434 (default) or MNEME_OLLAMA_URL.
 * Uses Ollama's /api/chat endpoint which supports the standard
 * OpenAI-compatible "tools" message shape. Free + local + uses your
 * existing GPU (e.g., RTX 5080 + 96GB RAM).
 *
 * Default model: "llama3.2:3b" (small, fast, ~2GB VRAM). Override via
 * MNEME_OLLAMA_MODEL.
 */

import type { AgentBackend, AgentTurn, AgentToolCall } from "./types.js";

const DEFAULT_URL = "http://localhost:11434";
const DEFAULT_MODEL = "llama3.2:3b";

export interface OllamaOptions {
  url?: string;
  model?: string;
  /** Temperature. Default 0.2 (low randomness for tool-calling). */
  temperature?: number;
  /** Stream? Default false (we want a single result for tool-call extraction). */
  stream?: boolean;
}

export function ollamaBackend(opts: OllamaOptions = {}): AgentBackend {
  const url = (opts.url ?? process.env["MNEME_OLLAMA_URL"] ?? DEFAULT_URL).replace(/\/$/, "");
  const model = opts.model ?? process.env["MNEME_OLLAMA_MODEL"] ?? DEFAULT_MODEL;
  return {
    id: "ollama-local",
    label: `Ollama local (${model} @ ${url})`,
    async available(): Promise<boolean> {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 2000);
        const r = await fetch(`${url}/api/tags`, { signal: ctl.signal });
        clearTimeout(timer);
        if (!r.ok) return false;
        const data = await r.json() as { models?: Array<{ name: string }> };
        const names = (data.models ?? []).map((m) => m.name);
        // Available iff Ollama is up AND the configured model is pulled
        // (or any model is pulled and we can fall through to the default).
        if (names.length === 0) return false;
        // If the configured model is missing, we'll surface that in step().
        return true;
      } catch { return false; }
    },
    async step(input): Promise<AgentTurn> {
      const t0 = Date.now();
      try {
        const messages = [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: input.userPrompt },
        ];
        // Embed tools description into the system prompt as a JSON-RPC-ish
        // hint, since not every Ollama model honors the OpenAI-tool shape.
        if (input.tools.length > 0) {
          const toolsHint = `\n\nAvailable tools (call by emitting a JSON object on its own line, format: {"tool":"<name>","args":{...}}):\n${input.tools.map((t) => `- ${t.name}: ${t.description}`).join("\n")}`;
          messages[0]!.content = (messages[0]!.content ?? "") + toolsHint;
        }
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 60000);
        const r = await fetch(`${url}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            stream: false,
            options: { temperature: opts.temperature ?? 0.2 },
          }),
          signal: ctl.signal,
        });
        clearTimeout(timer);
        if (!r.ok) {
          return { thought: "", toolCalls: [], ok: false, ms: Date.now() - t0, error: `HTTP ${r.status}` };
        }
        const data = await r.json() as { message?: { content?: string } };
        const content = data.message?.content ?? "";
        const { thought, toolCalls, finalAnswer } = parseAgentReply(content);
        return {
          thought, toolCalls,
          finalAnswer: finalAnswer ?? (toolCalls.length === 0 ? content.trim() : undefined),
          ok: true, ms: Date.now() - t0,
        };
      } catch (e) {
        return { thought: "", toolCalls: [], ok: false, ms: Date.now() - t0, error: (e as Error).message };
      }
    },
  };
}

/** Parse the model's free-form reply: extract JSON-RPC-shaped tool calls
 *  and treat the rest as `thought` / `finalAnswer`. */
export function parseAgentReply(text: string): { thought: string; toolCalls: AgentToolCall[]; finalAnswer?: string } {
  const calls: AgentToolCall[] = [];
  const remainingLines: string[] = [];
  for (const ln of text.split("\n")) {
    const trimmed = ln.trim();
    // Only attempt JSON parse when the line BOTH starts with `{` AND
    // ends with `}` -- prevents partial-JSON / explanatory text from
    // being accidentally consumed.
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const obj = JSON.parse(trimmed) as { tool?: string; args?: Record<string, unknown>; final?: string };
        if (typeof obj.tool === "string" && obj.tool.length > 0) {
          calls.push({ toolName: obj.tool, args: obj.args ?? {} });
          continue;
        }
        if (typeof obj.final === "string") {
          return { thought: remainingLines.join("\n").trim(), toolCalls: calls, finalAnswer: obj.final };
        }
      } catch { /* not a JSON line; keep as text */ }
    }
    remainingLines.push(ln);
  }
  return {
    thought: remainingLines.join("\n").trim(),
    toolCalls: calls,
    finalAnswer: calls.length === 0 ? remainingLines.join("\n").trim() : undefined,
  };
}
