/**
 * Path 3 -- Cloud API agent backends. OPTIONAL fallback when local
 * Ollama isn't enough (or for users who prefer paid quality).
 *
 *   anthropicBackend(): needs ANTHROPIC_API_KEY
 *   openaiBackend():    needs OPENAI_API_KEY
 *
 * Both are SAFE to import even without keys -- they report
 * available()=false when the env var is missing. The free Ollama
 * path is the default; these are explicit opt-ins.
 */

import type { AgentBackend, AgentTurn } from "./types.js";
import { parseAgentReply } from "./ollama.js";

export function anthropicBackend(opts: { model?: string } = {}): AgentBackend {
  const model = opts.model ?? process.env["MNEME_ANTHROPIC_MODEL"] ?? "claude-sonnet-4-6";
  return {
    id: "anthropic-api",
    label: `Anthropic API (${model})`,
    async available(): Promise<boolean> {
      return Boolean(process.env["ANTHROPIC_API_KEY"]);
    },
    async step(input): Promise<AgentTurn> {
      const t0 = Date.now();
      const key = process.env["ANTHROPIC_API_KEY"];
      if (!key) return { thought: "", toolCalls: [], ok: false, ms: Date.now() - t0, error: "ANTHROPIC_API_KEY not set" };
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 60000);
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: 1024,
            system: input.systemPrompt + (input.tools.length > 0
              ? `\n\nAvailable tools (call by emitting one JSON object per line: {"tool":"<name>","args":{...}}):\n${input.tools.map((t) => `- ${t.name}: ${t.description}`).join("\n")}`
              : ""),
            messages: [{ role: "user", content: input.userPrompt }],
          }),
          signal: ctl.signal,
        });
        clearTimeout(timer);
        if (!r.ok) {
          return { thought: "", toolCalls: [], ok: false, ms: Date.now() - t0, error: `HTTP ${r.status}` };
        }
        const data = await r.json() as { content?: Array<{ type: string; text?: string }> };
        const content = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
        const { thought, toolCalls, finalAnswer } = parseAgentReply(content);
        return { thought, toolCalls, finalAnswer, ok: true, ms: Date.now() - t0 };
      } catch (e) {
        return { thought: "", toolCalls: [], ok: false, ms: Date.now() - t0, error: (e as Error).message };
      }
    },
  };
}

export function openaiBackend(opts: { model?: string } = {}): AgentBackend {
  const model = opts.model ?? process.env["MNEME_OPENAI_MODEL"] ?? "gpt-4o-mini";
  return {
    id: "openai-api",
    label: `OpenAI API (${model})`,
    async available(): Promise<boolean> {
      return Boolean(process.env["OPENAI_API_KEY"]);
    },
    async step(input): Promise<AgentTurn> {
      const t0 = Date.now();
      const key = process.env["OPENAI_API_KEY"];
      if (!key) return { thought: "", toolCalls: [], ok: false, ms: Date.now() - t0, error: "OPENAI_API_KEY not set" };
      try {
        const messages = [
          { role: "system", content: input.systemPrompt + (input.tools.length > 0
              ? `\n\nAvailable tools (call by emitting one JSON object per line: {"tool":"<name>","args":{...}}):\n${input.tools.map((t) => `- ${t.name}: ${t.description}`).join("\n")}`
              : "") },
          { role: "user", content: input.userPrompt },
        ];
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 60000);
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json", "authorization": `Bearer ${key}` },
          body: JSON.stringify({ model, messages, temperature: 0.2 }),
          signal: ctl.signal,
        });
        clearTimeout(timer);
        if (!r.ok) {
          return { thought: "", toolCalls: [], ok: false, ms: Date.now() - t0, error: `HTTP ${r.status}` };
        }
        const data = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
        const content = data.choices?.[0]?.message?.content ?? "";
        const { thought, toolCalls, finalAnswer } = parseAgentReply(content);
        return { thought, toolCalls, finalAnswer, ok: true, ms: Date.now() - t0 };
      } catch (e) {
        return { thought: "", toolCalls: [], ok: false, ms: Date.now() - t0, error: (e as Error).message };
      }
    },
  };
}
