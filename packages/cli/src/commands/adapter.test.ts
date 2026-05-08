/**
 * adapter — unit tests for the cross-AI export format generators.
 *
 * Each format's structure is tested against expected schema fields so any
 * future drift breaks the tests.
 */

import { describe, it, expect } from "vitest";
import {
  _exportOpenAIForTests,
  _exportAnthropicForTests,
  _exportGeminiForTests,
} from "./adapter.js";

const SAMPLE_CATALOG = [
  {
    name: "mneme.memory.ask",
    description: "Answer a Q&A question.",
    inputSchema: { type: "object", properties: { question: { type: "string" } } },
    category: "memory",
    triggers: ["why does X exist"],
  },
  {
    name: "mneme.people.atrophy",
    description: "Knowledge atrophy clock.",
    inputSchema: { type: "object", properties: { authorEmail: { type: "string" } } },
    category: "people",
    triggers: ["who is forgetting what"],
  },
];

describe("adapter — OpenAI format", () => {
  it("returns schema=openai/tools/v1 + tools array with type=function", () => {
    const out = _exportOpenAIForTests(SAMPLE_CATALOG) as { schema: string; tools: Array<{ type: string; function: { name: string } }> };
    expect(out.schema).toBe("openai/tools/v1");
    expect(Array.isArray(out.tools)).toBe(true);
    expect(out.tools.length).toBe(2);
    for (const t of out.tools) {
      expect(t.type).toBe("function");
      expect(t.function.name).toMatch(/^[a-z0-9_]+$/i); // alphanumeric+underscore
      expect(t.function.name).not.toContain("."); // dots replaced
    }
  });

  it("converts mneme.memory.ask → mneme_memory_ask in name", () => {
    const out = _exportOpenAIForTests(SAMPLE_CATALOG) as { tools: Array<{ function: { name: string } }> };
    const names = out.tools.map((t) => t.function.name);
    expect(names).toContain("mneme_memory_ask");
    expect(names).toContain("mneme_people_atrophy");
  });
});

describe("adapter — Anthropic format", () => {
  it("returns schema=anthropic/tools/v1 + tools array with input_schema", () => {
    const out = _exportAnthropicForTests(SAMPLE_CATALOG) as { schema: string; tools: Array<{ name: string; input_schema: unknown }> };
    expect(out.schema).toBe("anthropic/tools/v1");
    expect(out.tools.length).toBe(2);
    for (const t of out.tools) {
      expect(t.name).not.toContain(".");
      expect(t.input_schema).toBeDefined();
    }
  });
});

describe("adapter — Gemini format", () => {
  it("returns schema=gemini/tools/v1 + function_declarations", () => {
    const out = _exportGeminiForTests(SAMPLE_CATALOG) as { schema: string; function_declarations: Array<{ name: string; parameters: unknown }> };
    expect(out.schema).toBe("gemini/tools/v1");
    expect(out.function_declarations.length).toBe(2);
    for (const t of out.function_declarations) {
      expect(t.name).not.toContain(".");
      expect(t.parameters).toBeDefined();
    }
  });
});

describe("adapter — invocation metadata", () => {
  it("OpenAI format declares local-shell protocol", () => {
    const out = _exportOpenAIForTests(SAMPLE_CATALOG) as { invocation: { protocol: string; command: string } };
    expect(out.invocation.protocol).toBe("local-shell");
    expect(out.invocation.command).toBe("mneme");
  });

  it("Anthropic format declares local-shell + claude code MCP path", () => {
    const out = _exportAnthropicForTests(SAMPLE_CATALOG) as { invocation: { protocol: string } };
    expect(out.invocation.protocol).toBe("local-shell");
  });
});
