import { describe, it, expect } from "vitest";
import { selectTool, formatConfirmationPrompt, formatSelectorPulseLine, STARTER_CATALOG } from "./index.js";

describe("v2.1 TOOL SELECTOR · the AI-picks-right-tool fix", () => {
  it("COMMIT on strong Thai trigger match", () => {
    const r = selectTool({ userIntent: "ส่งสมองไปมือถือ", catalog: STARTER_CATALOG });
    expect(r.verdict).toBe("COMMIT");
    expect(r.top!.tool.name).toBe("mneme.clone.to");
    expect(r.top!.confidence).toBeGreaterThanOrEqual(0.75);
  });

  it("COMMIT on English trigger match", () => {
    const r = selectTool({ userIntent: "clone brain to gemini", catalog: STARTER_CATALOG });
    expect(r.verdict).toBe("COMMIT");
    expect(r.top!.tool.name).toBe("mneme.clone.to");
  });

  it("CONFIRM on partial match", () => {
    // No clear trigger but a soft signal
    const r = selectTool({ userIntent: "send", catalog: STARTER_CATALOG });
    expect(["CONFIRM", "MENU"]).toContain(r.verdict);
  });

  it("MENU when intent doesn't match anything", () => {
    const r = selectTool({ userIntent: "draw me a unicorn", catalog: STARTER_CATALOG });
    expect(r.verdict).toBe("MENU");
  });

  it("routes 'upgrade Mneme' to system.upgrade", () => {
    const r = selectTool({ userIntent: "upgrade Mneme", catalog: STARTER_CATALOG });
    expect(r.top!.tool.name).toBe("mneme.system.upgrade");
  });

  it("routes 'verify this is rare' to flash.run (not clone.to)", () => {
    const r = selectTool({ userIntent: "is this card really rare", catalog: STARTER_CATALOG });
    expect(r.top!.tool.name).toBe("mneme.flash.run");
  });

  it("routes 'who wrote auth' to memory.ask", () => {
    const r = selectTool({ userIntent: "who wrote the auth module?", catalog: STARTER_CATALOG });
    expect(r.top!.tool.name).toBe("mneme.memory.ask");
  });

  it("recencyBoost lifts a tool from the recent list", () => {
    const r = selectTool({
      userIntent: "is this rare? also verify",
      catalog: STARTER_CATALOG,
      ctx: { recentTools: ["mneme.flash.run"] },
    });
    expect(r.top!.tool.name).toBe("mneme.flash.run");
  });

  it("formatConfirmationPrompt produces a helpful menu when MENU", () => {
    const r = selectTool({ userIntent: "asdfqwer", catalog: STARTER_CATALOG });
    const msg = formatConfirmationPrompt(r);
    expect(msg).toContain("Pick one:");
  });

  it("formatSelectorPulseLine produces a one-liner", () => {
    const r = selectTool({ userIntent: "ส่งสมองไปมือถือ", catalog: STARTER_CATALOG });
    expect(formatSelectorPulseLine(r)).toContain("TOOL-SELECTOR");
  });

  it("EMPTY verdict on empty catalog", () => {
    const r = selectTool({ userIntent: "anything", catalog: [] });
    expect(r.verdict).toBe("EMPTY");
    expect(r.top).toBeNull();
  });
});
