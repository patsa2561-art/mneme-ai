import { describe, it, expect } from "vitest";
import { deriveOutcomes, scoreReputation, agentLedgerGauntlet, type OutcomeCommit } from "./index.js";

const commits: OutcomeCommit[] = [
  { sha: "aaaaaaa1", author: "alice", message: "feat: x", ageDays: 200 },
  { sha: "bbbbbbb2", author: "bob", message: "feat: risky", ageDays: 200 },
  { sha: "ccccccc3", author: "carol", message: "Revert \"feat: risky\"\n\nThis reverts commit bbbbbbb2.", ageDays: 199 },
  { sha: "ddddddd4", author: "alice", message: "feat: y", ageDays: 2 },
];

describe("agent_ledger", () => {
  it("gauntlet is 100", () => expect(agentLedgerGauntlet().score).toBe(100));

  it("derives reverted / survived / pending from git facts", () => {
    const r = deriveOutcomes(commits, { matureDays: 30 });
    expect(r.find((x) => x.agent === "bob")!.outcome).toBe("reverted");
    expect(r.find((x) => x.agent === "alice" && x.sha === "aaaaaaa1")!.outcome).toBe("survived");
    expect(r.find((x) => x.agent === "alice" && x.sha === "ddddddd4")!.outcome).toBe("pending");
    expect(r.some((x) => x.agent === "carol")).toBe(false); // the revert commit itself isn't tracked
  });

  it("Wilson-LB ranks a durable author above a reverted one", () => {
    const rep = scoreReputation([
      ...Array.from({ length: 25 }, () => ({ agent: "good", outcome: "survived" as const })),
      ...Array.from({ length: 8 }, () => ({ agent: "bad", outcome: "reverted" as const })), { agent: "bad", outcome: "survived" as const },
    ]);
    const good = rep.find((r) => r.agent === "good")!; const bad = rep.find((r) => r.agent === "bad")!;
    expect(good.band).toBe("TRUSTED");
    expect(bad.band).toBe("RISKY");
    expect(good.score).toBeGreaterThan(bad.score);
  });

  it("an author with <5 decided is UNPROVEN (can't be inflated)", () => {
    const rep = scoreReputation([{ agent: "n", outcome: "survived" }, { agent: "n", outcome: "survived" }]);
    expect(rep[0].band).toBe("UNPROVEN");
  });

  it("incidents weigh heavier than reverts", () => {
    const inc = scoreReputation([...Array.from({ length: 5 }, () => ({ agent: "a", outcome: "survived" as const })), ...Array.from({ length: 3 }, () => ({ agent: "a", outcome: "incident" as const }))]);
    const rev = scoreReputation([...Array.from({ length: 5 }, () => ({ agent: "b", outcome: "survived" as const })), ...Array.from({ length: 3 }, () => ({ agent: "b", outcome: "reverted" as const }))]);
    expect(inc[0].score).toBeLessThan(rev[0].score);
  });

  it("never throws on garbage", () => {
    expect(() => deriveOutcomes(null as never)).not.toThrow();
    expect(() => scoreReputation(null as never)).not.toThrow();
  });
});
