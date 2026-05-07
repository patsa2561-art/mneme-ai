import { describe, it, expect, vi } from "vitest";
import {
  ABSTRACT_SYSTEM_PROMPT,
  buildAbstractUserPrompt,
  generateAbstract,
  generateAbstractsBatch,
} from "./abstract.js";
import { estimateTokens } from "./types.js";
import type { HtcEnricher } from "./types.js";

function mockEnricher(text: string, name = "mock:test"): HtcEnricher {
  return {
    name,
    enrich: vi.fn().mockResolvedValue({ text }),
  };
}

describe("buildAbstractUserPrompt", () => {
  it("includes subject + body + first 3 files", () => {
    const prompt = buildAbstractUserPrompt({
      hash: "a".repeat(40),
      subject: "fix: race in event listener",
      body: "Android only — touch event fired before render flush.",
      files: ["app/AR.tsx", "app/utils/events.ts", "app/test.ts", "app/extra.ts"],
    });
    expect(prompt).toContain("fix: race in event listener");
    expect(prompt).toContain("Android only");
    expect(prompt).toContain("app/AR.tsx, app/utils/events.ts, app/test.ts");
    // Only first 3 files — extra.ts must be excluded.
    expect(prompt).not.toContain("app/extra.ts");
  });

  it("falls back to '(empty)' / '(none)' when fields missing", () => {
    const prompt = buildAbstractUserPrompt({ hash: "x", subject: "" });
    expect(prompt).toContain("Commit subject: (empty)");
    expect(prompt).toContain("Body: (none)");
    expect(prompt).toContain("Files (sample): (none)");
  });

  it("includes the rigid format examples (consistency anchor)", () => {
    const prompt = buildAbstractUserPrompt({ hash: "x", subject: "anything" });
    expect(prompt).toContain("WHAT changed + WHY");
    expect(prompt).toContain("auth: replaced session cookies with JWT");
  });
});

describe("generateAbstract", () => {
  it("calls enricher with system + user prompts and returns AbstractResult", async () => {
    const enricher = mockEnricher(
      "auth: replaced session cookies with JWT for stateless CDN deploys",
      "ollama:qwen2.5:3b",
    );
    const r = await generateAbstract({
      commit: {
        hash: "a".repeat(40),
        subject: "auth: switch to JWT",
        body: "Sessions don't replicate across CDN.",
        files: ["src/auth.ts"],
      },
      enricher,
    });
    expect(r.hash).toBe("a".repeat(40));
    expect(r.abstract).toContain("JWT");
    expect(r.generator).toBe("ollama:qwen2.5:3b");
    expect(r.tokenCount).toBeGreaterThan(0);
    expect(r.generationMs).toBeGreaterThanOrEqual(0);
    expect(r.generatedAt).toBeDefined();
    expect(enricher.enrich).toHaveBeenCalledTimes(1);
    const call = (enricher.enrich as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.system).toBe(ABSTRACT_SYSTEM_PROMPT);
    expect(call.user).toContain("auth: switch to JWT");
    expect(call.maxTokens).toBe(80);
  });

  it("token count math = ceil(words * 1.3)", () => {
    // 10 words → ceil(10 * 1.3) = 13
    expect(estimateTokens("one two three four five six seven eight nine ten")).toBe(13);
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("   ")).toBe(0);
  });

  it("strips wrapping straight + curly quotes from model output", async () => {
    const enricher = mockEnricher('"refactor: split payment.ts into 3 modules"');
    const r = await generateAbstract({
      commit: { hash: "h", subject: "refactor" },
      enricher,
    });
    expect(r.abstract.startsWith('"')).toBe(false);
    expect(r.abstract.endsWith('"')).toBe(false);
    expect(r.abstract).toBe("refactor: split payment.ts into 3 modules");

    const enricher2 = mockEnricher("“feat: X”");
    const r2 = await generateAbstract({
      commit: { hash: "h", subject: "feat" },
      enricher: enricher2,
    });
    expect(r2.abstract).toBe("feat: X");
  });

  it("trims whitespace around the model's text", async () => {
    const enricher = mockEnricher("   feat: trim me   \n\n");
    const r = await generateAbstract({
      commit: { hash: "h", subject: "x" },
      enricher,
    });
    expect(r.abstract).toBe("feat: trim me");
  });
});

describe("generateAbstractsBatch", () => {
  it("processes every commit and returns one result each", async () => {
    const enricher = mockEnricher("abstract text");
    const commits = Array.from({ length: 5 }, (_, i) => ({
      hash: String(i).padStart(40, "0"),
      subject: `subject ${i}`,
    }));
    const out = await generateAbstractsBatch(commits, enricher, { concurrency: 2 });
    expect(out).toHaveLength(5);
    expect(enricher.enrich).toHaveBeenCalledTimes(5);
  });

  it("emits onProgress for every completion", async () => {
    const enricher = mockEnricher("ok");
    const onProgress = vi.fn();
    const commits = [
      { hash: "a".repeat(40), subject: "1" },
      { hash: "b".repeat(40), subject: "2" },
      { hash: "c".repeat(40), subject: "3" },
    ];
    await generateAbstractsBatch(commits, enricher, { concurrency: 2, onProgress });
    expect(onProgress).toHaveBeenCalledTimes(3);
    // Last call should have done === total.
    const last = onProgress.mock.calls[onProgress.mock.calls.length - 1]!;
    expect(last[0]).toBe(3);
    expect(last[1]).toBe(3);
  });

  it("records errors via onError without aborting the batch", async () => {
    const enricher: HtcEnricher = {
      name: "mock:flaky",
      enrich: vi.fn().mockImplementation((input: { user: string }) => {
        if (input.user.includes("FAIL")) {
          return Promise.reject(new Error("rate-limit hit"));
        }
        return Promise.resolve({ text: "ok" });
      }),
    };
    const onError = vi.fn();
    const commits = [
      { hash: "a".repeat(40), subject: "good 1" },
      { hash: "b".repeat(40), subject: "FAIL me" },
      { hash: "c".repeat(40), subject: "good 2" },
    ];
    const out = await generateAbstractsBatch(commits, enricher, {
      concurrency: 1,
      onError,
    });
    expect(out).toHaveLength(2); // failures excluded
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toBe("b".repeat(40));
    expect(onError.mock.calls[0]![1]).toContain("rate-limit");
  });

  it("respects concurrency cap (≤ N in flight)", async () => {
    let inFlight = 0;
    let peak = 0;
    const enricher: HtcEnricher = {
      name: "mock:concurrent",
      enrich: vi.fn().mockImplementation(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return { text: "ok" };
      }),
    };
    const commits = Array.from({ length: 10 }, (_, i) => ({
      hash: String(i).padStart(40, "0"),
      subject: `s${i}`,
    }));
    await generateAbstractsBatch(commits, enricher, { concurrency: 3 });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(0);
  });

  it("defaults concurrency to 3 when not specified", async () => {
    const enricher = mockEnricher("ok");
    const out = await generateAbstractsBatch(
      [{ hash: "a".repeat(40), subject: "x" }],
      enricher,
    );
    expect(out).toHaveLength(1);
  });
});
