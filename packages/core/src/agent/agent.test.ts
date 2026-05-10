import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ollamaBackend, anthropicBackend, openaiBackend,
  parseAgentReply, runAgent, pickBestBackend,
  adapterCursorComposer, adapterClaudeCodeAgent,
} from "./index.js";

describe("parseAgentReply", () => {
  it("extracts a single tool call", () => {
    const r = parseAgentReply(`I'll call a tool now.\n{"tool":"foo","args":{"x":1}}`);
    expect(r.toolCalls.length).toBe(1);
    expect(r.toolCalls[0]!.toolName).toBe("foo");
    expect(r.toolCalls[0]!.args).toEqual({ x: 1 });
    expect(r.thought).toContain("call a tool");
  });

  it("extracts multiple tool calls", () => {
    const r = parseAgentReply(`{"tool":"a","args":{}}\n{"tool":"b","args":{"k":"v"}}`);
    expect(r.toolCalls.length).toBe(2);
  });

  it("treats {final:...} as the final answer", () => {
    const r = parseAgentReply(`Reasoning here.\n{"final":"Done with X."}`);
    expect(r.finalAnswer).toBe("Done with X.");
  });

  it("non-JSON line is treated as final answer", () => {
    const r = parseAgentReply("This is just thought, no tool calls.");
    expect(r.toolCalls.length).toBe(0);
    expect(r.finalAnswer).toContain("This is just thought");
  });

  it("ignores partial-JSON lines that don't end in '}'", () => {
    const r = parseAgentReply(`Some thought\n{"partial": "missing brace"`);
    expect(r.toolCalls.length).toBe(0);
  });
});

describe("backends without env / Ollama", () => {
  it("anthropicBackend.available()=false without ANTHROPIC_API_KEY", async () => {
    const had = process.env["ANTHROPIC_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];
    const b = anthropicBackend();
    expect(await b.available()).toBe(false);
    if (had) process.env["ANTHROPIC_API_KEY"] = had;
  });

  it("openaiBackend.available()=false without OPENAI_API_KEY", async () => {
    const had = process.env["OPENAI_API_KEY"];
    delete process.env["OPENAI_API_KEY"];
    const b = openaiBackend();
    expect(await b.available()).toBe(false);
    if (had) process.env["OPENAI_API_KEY"] = had;
  });

  it("ollamaBackend.available() depends on local Ollama (returns boolean)", async () => {
    const b = ollamaBackend();
    const ok = await b.available();
    expect(typeof ok).toBe("boolean");
  });

  it("ollamaBackend.step on unreachable URL returns ok=false (no throw)", async () => {
    const b = ollamaBackend({ url: "http://127.0.0.1:1" /* unreachable */ });
    const turn = await b.step({ systemPrompt: "x", userPrompt: "y", tools: [] });
    expect(turn.ok).toBe(false);
    expect(turn.error).toBeDefined();
  });
});

describe("runAgent fallback when no backend available", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-agent-"));
    mkdirSync(join(repo, ".mneme"), { recursive: true });
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("returns status=backend-failed when no backend reachable", async () => {
    delete process.env["ANTHROPIC_API_KEY"];
    delete process.env["OPENAI_API_KEY"];
    const ollamaUp = await ollamaBackend().available();
    if (ollamaUp) return; // can't test "no backend" when Ollama is up locally
    const r = await runAgent({
      repoRoot: repo, task: "test",
      tools: [], toolExecutor: async () => null,
      maxSteps: 1,
    });
    expect(r.status).toBe("backend-failed");
    expect(r.finalAnswer).toContain("no backend");
  });
});

describe("pickBestBackend", () => {
  it("returns null if nothing available", async () => {
    delete process.env["ANTHROPIC_API_KEY"];
    delete process.env["OPENAI_API_KEY"];
    const ollamaUp = await ollamaBackend().available();
    if (ollamaUp) return; // skip when Ollama is locally up
    const b = await pickBestBackend();
    expect(b).toBeNull();
  });
});

describe("agentic client adapters (path 11 stubs)", () => {
  it("cursor-composer adapter is unavailable (no public API yet)", async () => {
    const a = adapterCursorComposer();
    expect(a.id).toBe("cursor-composer");
    expect(await a.available()).toBe(false);
  });
  it("claude-code-agent adapter is unavailable", async () => {
    const a = adapterClaudeCodeAgent();
    expect(await a.available()).toBe(false);
    const r = await a.dispatch({ title: "x", description: "y" });
    expect(r.ok).toBe(false);
  });
});
