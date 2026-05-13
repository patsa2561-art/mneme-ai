import { describe, it, expect } from "vitest";
import { openBallot, recordReply, closeConsensus, verifyBallot, verifyReply, formatConsensusPulseLine } from "./index.js";

describe("v2.8 SHADOW CONSENSUS", () => {
  const secret = "test-secret";

  it("openBallot mints a signed ballot", () => {
    const b = openBallot({ question: "is X true?", vendors: ["claude", "gpt", "gemini"], secret });
    expect(b.id).toMatch(/^[0-9a-f]{16}$/);
    expect(b.sig.length).toBe(64);
    expect(verifyBallot(b, secret)).toBe(true);
  });

  it("openBallot rejects empty inputs", () => {
    expect(() => openBallot({ question: "", vendors: ["claude"], secret })).toThrow();
    expect(() => openBallot({ question: "?", vendors: [], secret })).toThrow();
  });

  it("verifyBallot detects tampering", () => {
    const b = openBallot({ question: "q", vendors: ["claude", "gpt"], secret });
    const tampered = { ...b, question: "different" };
    expect(verifyBallot(tampered, secret)).toBe(false);
  });

  it("recordReply succeeds for invited vendor", () => {
    const b = openBallot({ question: "q", vendors: ["claude", "gpt"], secret });
    const r = recordReply({ ballot: b, vendor: "claude", verdict: "TRUE", confidence: 0.9, secret });
    expect(r.ok).toBe(true);
    if (r.ok) expect(verifyReply(r.reply, secret)).toBe(true);
  });

  it("recordReply rejects un-invited vendor", () => {
    const b = openBallot({ question: "q", vendors: ["claude"], secret });
    const r = recordReply({ ballot: b, vendor: "stranger", verdict: "TRUE", confidence: 1, secret });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("not invited");
  });

  it("recordReply rejects with wrong secret", () => {
    const b = openBallot({ question: "q", vendors: ["claude"], secret });
    const r = recordReply({ ballot: b, vendor: "claude", verdict: "TRUE", confidence: 1, secret: "wrong" });
    expect(r.ok).toBe(false);
  });

  it("closeConsensus fuses N replies via TRUTH KERNEL", async () => {
    const b = openBallot({ question: "is X true?", vendors: ["claude", "gpt", "gemini"], secret });
    const claudeR = recordReply({ ballot: b, vendor: "claude", verdict: "TRUE", confidence: 0.9, secret });
    const gptR = recordReply({ ballot: b, vendor: "gpt", verdict: "TRUE", confidence: 0.85, secret });
    expect(claudeR.ok && gptR.ok).toBe(true);
    const replies = [
      (claudeR as { ok: true; reply: typeof claudeR extends { ok: true; reply: infer R } ? R : never }).reply,
      (gptR as { ok: true; reply: typeof gptR extends { ok: true; reply: infer R } ? R : never }).reply,
    ];
    const c = await closeConsensus({ ballot: b, replies, secret });
    expect(c.truth.verdict).toBe("ACCEPTED");
    expect(c.quorate).toBe(true); // 2 of 3 ≥ floor(3/2)+1 = 2
    expect(c.coverage).toBeCloseTo(2 / 3, 2);
  });

  it("closeConsensus drops replies with tampered HMAC", async () => {
    const b = openBallot({ question: "q", vendors: ["claude", "gpt"], secret });
    const r1 = recordReply({ ballot: b, vendor: "claude", verdict: "TRUE", confidence: 0.9, secret });
    const replyOk = (r1 as { ok: true; reply: { ballotId: string; vendor: string; verdict: "TRUE"; confidence: number; receivedAt: string; sig: string } }).reply;
    const tampered = { ...replyOk, verdict: "FALSE" as const };
    const c = await closeConsensus({ ballot: b, replies: [replyOk, tampered], secret });
    expect(c.replies.length).toBe(1); // tampered dropped
  });

  it("closeConsensus enforces one-vote-per-vendor", async () => {
    const b = openBallot({ question: "q", vendors: ["claude"], secret });
    const r1 = recordReply({ ballot: b, vendor: "claude", verdict: "TRUE", confidence: 0.9, secret });
    const r2 = recordReply({ ballot: b, vendor: "claude", verdict: "FALSE", confidence: 0.9, secret });
    const replies = [(r1 as { ok: true; reply: { ballotId: string; vendor: string; verdict: "TRUE" | "FALSE"; confidence: number; receivedAt: string; sig: string } }).reply, (r2 as { ok: true; reply: { ballotId: string; vendor: string; verdict: "TRUE" | "FALSE"; confidence: number; receivedAt: string; sig: string } }).reply];
    const c = await closeConsensus({ ballot: b, replies, secret });
    expect(c.replies.length).toBe(1); // duplicate dropped
  });

  it("closeConsensus not quorate when too few replies", async () => {
    const b = openBallot({ question: "q", vendors: ["a", "b", "c", "d", "e"], secret });
    const r = recordReply({ ballot: b, vendor: "a", verdict: "TRUE", confidence: 1, secret });
    const reply = (r as { ok: true; reply: { ballotId: string; vendor: string; verdict: "TRUE"; confidence: number; receivedAt: string; sig: string } }).reply;
    const c = await closeConsensus({ ballot: b, replies: [reply], secret });
    expect(c.quorate).toBe(false); // 1 of 5 < floor(5/2)+1 = 3
  });

  it("formatConsensusPulseLine emits a compact summary", async () => {
    const b = openBallot({ question: "q", vendors: ["a"], secret });
    const r = recordReply({ ballot: b, vendor: "a", verdict: "TRUE", confidence: 1, secret });
    const reply = (r as { ok: true; reply: { ballotId: string; vendor: string; verdict: "TRUE"; confidence: number; receivedAt: string; sig: string } }).reply;
    const c = await closeConsensus({ ballot: b, replies: [reply], secret });
    expect(formatConsensusPulseLine(c)).toContain("SHADOW-CONSENSUS");
  });
});
