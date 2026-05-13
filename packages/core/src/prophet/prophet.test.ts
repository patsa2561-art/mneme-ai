import { describe, it, expect } from "vitest";
import { prophesyAndPrewarm, formatProphetPulseLine } from "./index.js";

describe("v2.1 PROPHET · pre-fetch top-K", () => {
  it("predicts + prewarms tasks for matched classes", async () => {
    const r = await prophesyAndPrewarm({
      currentQuery: "is this rare?",
      lastAiReply: "Cannot confirm rarity without auction history.",
      hydrationMap: {
        "rarity-followup": [
          { id: "fetch-auctions", work: async () => "auction-data-result" },
        ],
      },
    });
    expect(r.prediction.predictions.length).toBeGreaterThan(0);
    expect(r.prewarmed.length).toBeGreaterThan(0);
    expect(r.prewarmed[0]!.ok).toBe(true);
    expect(r.cache.get("rarity-followup")).toEqual(["auction-data-result"]);
  });

  it("records failed prewarm tasks", async () => {
    const r = await prophesyAndPrewarm({
      currentQuery: "x",
      lastAiReply: "rarity collectible",
      hydrationMap: { "rarity-followup": [{ id: "bad", work: async () => { throw new Error("boom"); } }] },
    });
    expect(r.prewarmed[0]!.ok).toBe(false);
    expect(r.prewarmed[0]!.error).toContain("boom");
  });

  it("returns empty prewarmed when reply has no triggers", async () => {
    const r = await prophesyAndPrewarm({ currentQuery: "x", lastAiReply: "hi" });
    expect(r.prewarmed.length).toBe(0);
  });

  it("formatProphetPulseLine summarises", async () => {
    const r = await prophesyAndPrewarm({ currentQuery: "x", lastAiReply: "rare collectible" });
    expect(formatProphetPulseLine(r)).toContain("PROPHET");
  });
});
