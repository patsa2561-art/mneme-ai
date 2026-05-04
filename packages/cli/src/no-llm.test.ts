import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isNoLlm, refuseLlm } from "./no-llm.js";

describe("isNoLlm — precedence: cli > config > env", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.MNEME_NO_LLM;
    delete process.env.MNEME_NO_LLM;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.MNEME_NO_LLM;
    else process.env.MNEME_NO_LLM = originalEnv;
  });

  it("returns false when nothing is set", () => {
    expect(isNoLlm(undefined, {})).toBe(false);
  });

  it("CLI flag true wins over config and env", () => {
    expect(isNoLlm(true, { deterministic: false })).toBe(true);
  });

  it("config.deterministic activates the gate", () => {
    expect(isNoLlm(undefined, { deterministic: true })).toBe(true);
  });

  it('MNEME_NO_LLM=1 activates the gate', () => {
    process.env.MNEME_NO_LLM = "1";
    expect(isNoLlm(undefined, {})).toBe(true);
  });

  it('MNEME_NO_LLM=true (case-insensitive) activates the gate', () => {
    process.env.MNEME_NO_LLM = "TRUE";
    expect(isNoLlm(undefined, {})).toBe(true);
  });

  it("MNEME_NO_LLM=0 does NOT activate the gate", () => {
    process.env.MNEME_NO_LLM = "0";
    expect(isNoLlm(undefined, {})).toBe(false);
  });

  it("any layer can independently enable it", () => {
    expect(isNoLlm(true, {})).toBe(true);
    expect(isNoLlm(undefined, { deterministic: true })).toBe(true);
    process.env.MNEME_NO_LLM = "1";
    expect(isNoLlm(undefined, {})).toBe(true);
  });
});

describe("refuseLlm — standardized exit code and message", () => {
  it("returns exit code 2 (distinct from 1, the generic-failure code)", () => {
    const messages: string[] = [];
    const ui = {
      error: (m: string) => messages.push(m),
      dim: (m: string) => messages.push(m),
    };
    const code = refuseLlm("heal", "mneme ask <question>", ui);
    expect(code).toBe(2);
  });

  it("includes the command name and a usable suggestion in output", () => {
    const messages: string[] = [];
    const ui = {
      error: (m: string) => messages.push(m),
      dim: (m: string) => messages.push(m),
    };
    refuseLlm("genius", "mneme adapt && mneme ask", ui);
    const all = messages.join("\n");
    expect(all).toContain("genius");
    expect(all).toContain("mneme adapt && mneme ask");
    expect(all.toLowerCase()).toContain("deterministic");
  });
});
