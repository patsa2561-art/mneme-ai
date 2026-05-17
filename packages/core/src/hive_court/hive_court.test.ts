import { describe, it, expect } from "vitest";
import {
  adjudicate,
  verifyWrit,
  shouldDeferToWrit,
  computeStats,
  formatWritLine,
  HIVE_COURT_TUNABLES,
  type AgentClaim,
} from "./index.js";

const SECRET = "court-test-secret-997744";

function claim(agentId: string, vendor: string, text: string, scores: { f?: number; p?: number; t?: number; v?: AgentClaim["truthForensicVerdict"] } = {}): AgentClaim {
  return {
    agentId,
    vendor,
    claim: text,
    factCoverageScore: scores.f ?? 0.5,
    peerAuditScore: scores.p ?? 0.5,
    trinityVoteShare: scores.t ?? 0.5,
    truthForensicVerdict: scores.v ?? "ACCEPTED",
  };
}

describe("v2.19.30 HIVE COURT · adjudicate (4-source composite)", () => {
  it("0 claims → INSUFFICIENT_PARTIES + NO_CLAIMS caveat (defensive)", () => {
    const w = adjudicate({ topic: "x", claims: [], secret: SECRET });
    expect(w.tier).toBe("INSUFFICIENT_PARTIES");
    expect(w.winnerAgentId).toBe("");
    expect(w.caveats).toContain("NO_CLAIMS");
  });

  it("1 claim → SINGLE_PARTY_DEFAULT (winner by default)", () => {
    const w = adjudicate({
      topic: "refactor x",
      claims: [claim("alone", "claude", "approach A")],
      secret: SECRET,
    });
    expect(w.tier).toBe("SINGLE_PARTY_DEFAULT");
    expect(w.winnerAgentId).toBe("alone");
    expect(w.caveats).toContain("SINGLE_PARTY");
  });

  it("CLEAR tier when margin >= 0.10 (default)", () => {
    const w = adjudicate({
      topic: "x",
      claims: [
        claim("a", "claude", "A", { f: 1, p: 1, t: 1, v: "ACCEPTED" }),
        claim("b", "openai", "B", { f: 0.2, p: 0.2, t: 0.2, v: "ACCEPTED" }),
      ],
      secret: SECRET,
    });
    expect(w.tier).toBe("CLEAR");
    expect(w.winnerAgentId).toBe("a");
    expect(w.margin).toBeGreaterThan(0.1);
  });

  it("CLOSE_CALL tier when 0.03 <= margin < 0.10 + CLOSE_CALL caveat", () => {
    const w = adjudicate({
      topic: "x",
      claims: [
        claim("a", "claude", "A", { f: 0.8, p: 0.8, t: 0.8, v: "ACCEPTED" }),
        claim("b", "openai", "B", { f: 0.7, p: 0.7, t: 0.7, v: "ACCEPTED" }),
      ],
      secret: SECRET,
    });
    expect(w.tier).toBe("CLOSE_CALL");
    expect(w.caveats).toContain("CLOSE_CALL");
  });

  it("DISPUTED tier when margin < 0.03 + USER_ATTENTION_REQUIRED caveat", () => {
    const w = adjudicate({
      topic: "x",
      claims: [
        claim("a", "claude", "A", { f: 0.8, p: 0.8, t: 0.8, v: "ACCEPTED" }),
        claim("b", "openai", "B", { f: 0.79, p: 0.79, t: 0.79, v: "ACCEPTED" }),
      ],
      secret: SECRET,
    });
    expect(w.tier).toBe("DISPUTED");
    expect(w.caveats).toContain("USER_ATTENTION_REQUIRED");
  });

  it("TRUTH FORENSIC REJECTED forces winner finalScore=0 (can't be a liar)", () => {
    const w = adjudicate({
      topic: "x",
      claims: [
        claim("liar", "claude", "false", { f: 1, p: 1, t: 1, v: "REJECTED" }),
        claim("truth", "openai", "true", { f: 0.5, p: 0.5, t: 0.5, v: "ACCEPTED" }),
      ],
      secret: SECRET,
    });
    expect(w.winnerAgentId).toBe("truth"); // even with weaker scores wins because liar zeroed
    expect(w.composites.find((c) => c.agentId === "liar")?.finalScore).toBe(0);
  });

  it("HMAC sig verifies untampered; rejects tamper", () => {
    const w = adjudicate({
      topic: "x",
      claims: [claim("a", "claude", "A")],
      secret: SECRET,
    });
    expect(verifyWrit(w, SECRET)).toBe(true);
    expect(verifyWrit({ ...w, winnerAgentId: "FAKE" }, SECRET)).toBe(false);
  });

  it("custom margin thresholds respected", () => {
    const w = adjudicate({
      topic: "x",
      claims: [
        claim("a", "claude", "A", { f: 1, p: 1, t: 1 }),
        claim("b", "openai", "B", { f: 0.7, p: 0.7, t: 0.7 }),
      ],
      closeCallMargin: 0.5, // very strict
      secret: SECRET,
    });
    // margin between a and b is ~0.3 -- below strict 0.5 close-call → DISPUTED OR CLOSE_CALL
    expect(["CLOSE_CALL", "DISPUTED"]).toContain(w.tier);
  });
});

describe("v2.19.30 HIVE COURT · shouldDeferToWrit (agent contract)", () => {
  it("CLEAR tier → agents defer", () => {
    const w = adjudicate({
      topic: "x",
      claims: [claim("a", "x", "A", { f: 1 }), claim("b", "y", "B", { f: 0 })],
      secret: SECRET,
    });
    expect(shouldDeferToWrit(w, SECRET)).toBe(true);
  });

  it("DISPUTED tier → agents PAUSE (user attention)", () => {
    const w = adjudicate({
      topic: "x",
      claims: [
        claim("a", "x", "A", { f: 0.5 }),
        claim("b", "y", "B", { f: 0.501 }),
      ],
      secret: SECRET,
    });
    expect(shouldDeferToWrit(w, SECRET)).toBe(false);
  });

  it("Tampered WRIT → agents refuse to defer (fail-safe)", () => {
    const w = adjudicate({
      topic: "x",
      claims: [claim("a", "x", "A"), claim("b", "y", "B")],
      secret: SECRET,
    });
    expect(shouldDeferToWrit({ ...w, tier: "CLEAR" as const, winnerAgentId: "EVIL" }, SECRET)).toBe(false);
  });
});

describe("v2.19.30 HIVE COURT · stats + formatter", () => {
  it("computeStats reports tier + claims + margin + user attention flag", () => {
    const w = adjudicate({
      topic: "x",
      claims: [claim("a", "x", "A", { f: 1 }), claim("b", "y", "B", { f: 0.5 })],
      secret: SECRET,
    });
    const s = computeStats(w);
    expect(s.totalClaims).toBe(2);
    expect(s.tier).toBe(w.tier);
    expect(s.margin).toBeGreaterThan(0);
  });

  it("formatWritLine uses ⚖/⚠/🔥/· per tier", () => {
    const clear = adjudicate({ topic: "x", claims: [claim("a", "x", "A", { f: 1 }), claim("b", "y", "B", { f: 0 })], secret: SECRET });
    expect(formatWritLine(clear)).toContain("⚖");
    const empty = adjudicate({ topic: "x", claims: [], secret: SECRET });
    expect(formatWritLine(empty)).toContain("—");
  });
});

describe("v2.19.30 HIVE COURT · 24/7 invariants + determinism", () => {
  it("MEASURED 100% determinism: same claims → same WRIT body (30 trials)", () => {
    const claims = [claim("a", "x", "A", { f: 0.8 }), claim("b", "y", "B", { f: 0.6 })];
    const replay = () => {
      const w = adjudicate({ topic: "x", claims, secret: SECRET });
      // We strip issuedAtMs + sig because they reflect time; the rest must be identical
      const { issuedAtMs, sig, ...rest } = w;
      void issuedAtMs; void sig;
      return JSON.stringify(rest);
    };
    const first = replay();
    let allEqual = true;
    for (let i = 0; i < 30; i++) {
      if (replay() !== first) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
  });

  it("never crashes on 200 random disputes (3-5 agents each)", () => {
    let crashed = false;
    try {
      for (let i = 0; i < 200; i++) {
        const n = 3 + (i % 3);
        const claims: AgentClaim[] = Array.from({ length: n }, (_, j) => claim(
          `a${j}`, `v${j}`, `claim${i}_${j}`,
          { f: Math.random(), p: Math.random(), t: Math.random() },
        ));
        adjudicate({ topic: `topic_${i}`, claims, secret: SECRET });
      }
    } catch {
      crashed = true;
    }
    expect(crashed).toBe(false);
  });

  it("HIVE_COURT_TUNABLES exposed (frozen)", () => {
    expect(Object.isFrozen(HIVE_COURT_TUNABLES)).toBe(true);
    expect(HIVE_COURT_TUNABLES.DEFAULT_CLOSE_CALL_MARGIN).toBe(0.1);
    expect(HIVE_COURT_TUNABLES.DEFAULT_DISPUTED_MARGIN).toBe(0.03);
  });
});
