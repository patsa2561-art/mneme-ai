import { describe, it, expect } from "vitest";
import { decidePromote, verifyPromoteDecision, formatPromoteLine } from "./index.js";

describe("v2.19.2 · EMBEDDER AUTO-PROMOTE", () => {
  it("promotes hash → ollama when doctor recommends ollama and it's reachable", () => {
    const d = decidePromote({
      current: "hash",
      doctor: { pick: "ollama", reason: "ollama reachable + bge-m3 pulled", qualityStars: 4, reachable: true },
    });
    expect(d.shouldPromote).toBe(true);
    expect(d.from).toBe("hash");
    expect(d.to).toBe("ollama");
    expect(d.qualityGain).toBe(2);
    expect(d.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyPromoteDecision(d)).toBe(true);
  });

  it("refuses promotion when doctor pick is unreachable", () => {
    const d = decidePromote({
      current: "hash",
      doctor: { pick: "ollama", reason: "ollama config seen but daemon not responding", qualityStars: 4, reachable: false },
    });
    expect(d.shouldPromote).toBe(false);
    expect(d.reasons.some((r) => r.includes("not reachable"))).toBe(true);
  });

  it("refuses to downgrade (won't move openai → hash even if doctor says hash)", () => {
    const d = decidePromote({
      current: "openai",
      doctor: { pick: "hash", reason: "openai key removed", qualityStars: 2 },
    });
    expect(d.shouldPromote).toBe(false);
    expect(d.reasons.some((r) => r.includes("downgrade"))).toBe(true);
  });

  it("no-op when current already matches doctor pick", () => {
    const d = decidePromote({
      current: "ollama",
      doctor: { pick: "ollama", reason: "already good", qualityStars: 4 },
    });
    expect(d.shouldPromote).toBe(false);
    expect(d.reasons.some((r) => r.includes("already matches"))).toBe(true);
  });

  it("user's actual scenario (hash + ollama reachable) → promote", () => {
    const d = decidePromote({
      current: "hash",
      doctor: { pick: "ollama", reason: "Ollama is running and nomic-embed-text is pulled — local, free, high quality.", qualityStars: 4, reachable: true },
    });
    expect(d.shouldPromote).toBe(true);
    expect(d.to).toBe("ollama");
  });

  it("rejects tampered decision", () => {
    const d = decidePromote({ current: "hash", doctor: { pick: "ollama", reason: "x", qualityStars: 4, reachable: true } });
    expect(verifyPromoteDecision(d)).toBe(true);
    const tampered = { ...d, to: "openai" as const, qualityGain: 99 };
    expect(verifyPromoteDecision(tampered)).toBe(false);
  });

  it("formatPromoteLine summarises", () => {
    const d = decidePromote({ current: "hash", doctor: { pick: "ollama", reason: "x", qualityStars: 4, reachable: true } });
    expect(formatPromoteLine(d)).toContain("PROMOTED");
    const noop = decidePromote({ current: "ollama", doctor: { pick: "ollama", reason: "x", qualityStars: 4 } });
    expect(formatPromoteLine(noop)).toContain("keep");
  });
});
