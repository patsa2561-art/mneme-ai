import { describe, it, expect } from "vitest";
import { extractClaim, priceCheck, fuseClaims, formatAlphaLine } from "./index.js";

describe("v2.16 · MNEME ALPHA (honest financial AI layer)", () => {
  describe("extractClaim", () => {
    it("extracts ticker via $TICKER pattern", () => {
      const c = extractClaim({ vendor: "claude", text: "I think $NOK is going up tomorrow." });
      expect(c.ticker).toBe("NOK");
      expect(c.direction).toBe("up");
    });

    it("extracts ticker via standalone uppercase", () => {
      const c = extractClaim({ vendor: "chatgpt", text: "AEHL is dropping fast today." });
      expect(c.ticker).toBe("AEHL");
      expect(c.direction).toBe("down");
      expect(c.horizon).toBe("today");
    });

    it("flags overconfident claims (>85%)", () => {
      const c = extractClaim({ vendor: "claude", text: "I am 99% confident NVDA will pump tomorrow." });
      expect(c.statedConfidence).toBeCloseTo(0.99, 2);
      expect(c.overconfident).toBe(true);
    });

    it("does NOT flag honest hedged claims as overconfident", () => {
      const c = extractClaim({ vendor: "claude", text: "NOK might rise this week, ~60% confidence." });
      expect(c.overconfident).toBe(false);
    });

    it("extracts target price", () => {
      const c = extractClaim({ vendor: "claude", text: "AAPL target $250 by end of Q2." });
      expect(c.targetPrice).toBe(250);
    });

    it("extracts quoted current price", () => {
      const c = extractClaim({ vendor: "claude", text: "TSLA trading at 234.50 right now." });
      expect(c.quotedPrice).toBe(234.5);
    });

    it("HMAC sig is 64 hex", () => {
      const c = extractClaim({ vendor: "claude", text: "x" });
      expect(c.sig).toMatch(/^[0-9a-f]{64}$/);
    });

    it("handles AI lying about being certain", () => {
      const c = extractClaim({ vendor: "claude", text: "AAPL will definitely go up tomorrow, guaranteed." });
      expect(c.statedConfidence).toBe(1.0);
      expect(c.overconfident).toBe(true);
    });
  });

  describe("priceCheck", () => {
    it("aligns when quoted matches observed within tolerance", async () => {
      const c = extractClaim({ vendor: "claude", text: "$NOK trading at 4.50 right now." });
      const r = await priceCheck({ claim: c, fetchPrice: async () => 4.52 });
      expect(r.verdict).toBe("aligned");
      expect(r.matched).toBe(true);
    });

    it("flags divergent when quoted is wrong", async () => {
      const c = extractClaim({ vendor: "claude", text: "$NOK trading at 4.50 right now." });
      const r = await priceCheck({ claim: c, fetchPrice: async () => 6.00 });
      expect(r.verdict).toBe("divergent");
      expect(r.matched).toBe(false);
      expect(r.divergencePct).toBeGreaterThan(20);
    });

    it("returns no_quote when AI didn't quote a price", async () => {
      const c = extractClaim({ vendor: "claude", text: "$NOK is bullish." });
      const r = await priceCheck({ claim: c, fetchPrice: async () => 4.50 });
      expect(r.verdict).toBe("no_quote");
    });

    it("returns unverifiable when fetcher returns null", async () => {
      const c = extractClaim({ vendor: "claude", text: "$NOK trading at 4.50." });
      const r = await priceCheck({ claim: c, fetchPrice: async () => null });
      expect(r.verdict).toBe("unverifiable");
    });
  });

  describe("fuseClaims", () => {
    it("majority direction wins", () => {
      const claims = [
        extractClaim({ vendor: "claude", text: "$NOK up this week" }),
        extractClaim({ vendor: "chatgpt", text: "$NOK up today" }),
        extractClaim({ vendor: "gemini", text: "$NOK down" }),
      ];
      const f = fuseClaims(claims);
      expect(f.consensusDirection).toBe("up");
      expect(f.consensusStrength).toBeCloseTo(2 / 3, 1);
    });

    it("counts overconfident claims", () => {
      const claims = [
        extractClaim({ vendor: "a", text: "$NOK 99% sure up" }),
        extractClaim({ vendor: "b", text: "$NOK 100% guaranteed up" }),
        extractClaim({ vendor: "c", text: "$NOK ~60% confidence up" }),
      ];
      const f = fuseClaims(claims);
      expect(f.overconfidentCount).toBe(2);
    });

    it("includes the advisory string (anti-hype reminder)", () => {
      const f = fuseClaims([extractClaim({ vendor: "x", text: "$NOK up" })]);
      expect(f.advisory).toMatch(/ADVISORY ONLY|NOT financial advice/);
    });
  });

  it("formatAlphaLine summarises", () => {
    const c = extractClaim({ vendor: "claude", text: "$NOK 99% sure up tomorrow" });
    const line = formatAlphaLine(c);
    expect(line).toContain("ALPHA");
    expect(line).toContain("NOK");
    expect(line).toContain("OVERCONFIDENT");
  });
});
