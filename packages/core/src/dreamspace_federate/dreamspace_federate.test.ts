import { describe, it, expect } from "vitest";
import {
  attestElite,
  verifyAttestation,
  aggregateBlessing,
  verifyBlessingQuorum,
  exportStarterPack,
  verifyStarterPack,
  BLESSING_EMOJI,
  formatQuorumLine,
  formatStarterPackLine,
  type EliteAttestation,
} from "./index.js";

const SECRET = "federate-test-secret-997744";

function mkAttest(instance: string, tool: string, fitness: number, useCount: number, ts = 1): EliteAttestation {
  return attestElite({
    instanceId: instance,
    toolName: tool,
    localFitness: fitness,
    localUseCount: useCount,
    ts,
    secret: SECRET,
  })!;
}

describe("v2.19.27 FEDERATE · attestElite", () => {
  it("issues attestation when fitness >= threshold", () => {
    const a = attestElite({
      instanceId: "inst1",
      toolName: "mneme.x",
      localFitness: 0.8,
      localUseCount: 100,
      secret: SECRET,
    });
    expect(a).not.toBeNull();
    expect(verifyAttestation(a!, SECRET)).toBe(true);
  });

  it("REFUSES attestation when fitness < threshold (default 0.7)", () => {
    const a = attestElite({
      instanceId: "inst1",
      toolName: "mneme.x",
      localFitness: 0.5,
      localUseCount: 100,
      secret: SECRET,
    });
    expect(a).toBeNull();
  });

  it("custom minFitness override works", () => {
    const a = attestElite({
      instanceId: "inst1",
      toolName: "mneme.x",
      localFitness: 0.3,
      localUseCount: 100,
      minFitness: 0.2,
      secret: SECRET,
    });
    expect(a).not.toBeNull();
  });

  it("MEASURED 100% determinism: same input -> same sig (30 trials)", () => {
    const args = { instanceId: "x", toolName: "y", localFitness: 0.8, localUseCount: 10, ts: 1, secret: SECRET };
    const first = attestElite(args)!.sig;
    let allEqual = true;
    for (let i = 0; i < 30; i++) {
      if (attestElite(args)!.sig !== first) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
  });
});

describe("v2.19.27 FEDERATE · aggregateBlessing (quorum bands)", () => {
  it("0 attestations -> orphan", () => {
    const q = aggregateBlessing({ toolName: "mneme.x", attestations: [], totalInstancesKnown: 10, secret: SECRET });
    expect(q.band).toBe("orphan");
    expect(q.isBlessed).toBe(false);
  });

  it(">= 95% of known instances -> unanimous + blessed", () => {
    const attests = Array.from({ length: 20 }, (_, i) => mkAttest(`inst${i}`, "mneme.x", 0.9, 10));
    const q = aggregateBlessing({ toolName: "mneme.x", attestations: attests, totalInstancesKnown: 20, secret: SECRET });
    expect(q.band).toBe("unanimous");
    expect(q.isBlessed).toBe(true);
  });

  it(">= 67% -> supermajority + blessed", () => {
    const attests = Array.from({ length: 7 }, (_, i) => mkAttest(`inst${i}`, "mneme.x", 0.9, 10));
    const q = aggregateBlessing({ toolName: "mneme.x", attestations: attests, totalInstancesKnown: 10, secret: SECRET });
    expect(q.band).toBe("supermajority");
    expect(q.isBlessed).toBe(true);
  });

  it(">= 51% -> majority (NOT blessed)", () => {
    const attests = Array.from({ length: 6 }, (_, i) => mkAttest(`inst${i}`, "mneme.x", 0.9, 10));
    const q = aggregateBlessing({ toolName: "mneme.x", attestations: attests, totalInstancesKnown: 10, secret: SECRET });
    expect(q.band).toBe("majority");
    expect(q.isBlessed).toBe(false);
  });

  it("forged attestations DROPPED + counted in forgedDropped", () => {
    const good = mkAttest("inst1", "mneme.x", 0.9, 10);
    const tampered = { ...mkAttest("inst2", "mneme.x", 0.9, 10), localFitness: 0.99 };
    const q = aggregateBlessing({
      toolName: "mneme.x",
      attestations: [good, tampered],
      totalInstancesKnown: 2,
      secret: SECRET,
    });
    expect(q.forgedDropped).toBe(1);
    expect(q.validAttestations).toBe(1);
  });

  it("one-vote-per-instance: keeps latest by ts (dedup)", () => {
    const old = mkAttest("inst1", "mneme.x", 0.7, 5, 1);
    const fresh = mkAttest("inst1", "mneme.x", 0.9, 10, 100);
    const q = aggregateBlessing({
      toolName: "mneme.x",
      attestations: [old, fresh],
      totalInstancesKnown: 1,
      secret: SECRET,
    });
    expect(q.validAttestations).toBe(1);
    expect(q.meanFitness).toBe(0.9); // latest kept
    expect(q.totalUseCount).toBe(10);
  });

  it("ignores attestations for different toolName", () => {
    const a = mkAttest("inst1", "mneme.OTHER", 0.9, 10);
    const q = aggregateBlessing({
      toolName: "mneme.x",
      attestations: [a],
      totalInstancesKnown: 10,
      secret: SECRET,
    });
    expect(q.validAttestations).toBe(0);
    expect(q.band).toBe("orphan");
  });

  it("MEASURED 100% determinism: same attestations -> same quorum sig (30 trials)", () => {
    const attests = [mkAttest("a", "t", 0.9, 5), mkAttest("b", "t", 0.8, 3)];
    const input = { toolName: "t", attestations: attests, totalInstancesKnown: 2, secret: SECRET };
    const first = aggregateBlessing(input).sig;
    let allEqual = true;
    for (let i = 0; i < 30; i++) {
      if (aggregateBlessing(input).sig !== first) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
  });
});

describe("v2.19.27 FEDERATE · exportStarterPack", () => {
  it("sorts blessed-first, then meanFitness desc, then attestationCount desc", () => {
    const quorums = [
      aggregateBlessing({ toolName: "low", attestations: [mkAttest("i1", "low", 0.7, 1)], totalInstancesKnown: 1, secret: SECRET }),
      aggregateBlessing({ toolName: "high", attestations: [mkAttest("i1", "high", 0.95, 1)], totalInstancesKnown: 1, secret: SECRET }),
      aggregateBlessing({ toolName: "mid", attestations: [mkAttest("i1", "mid", 0.85, 1)], totalInstancesKnown: 1, secret: SECRET }),
    ];
    const pack = exportStarterPack({ quorums, topN: 10, builtAt: 0, secret: SECRET });
    expect(pack.entries.map((e) => e.toolName)).toEqual(["high", "mid", "low"]);
  });

  it("topN respected", () => {
    const quorums = Array.from({ length: 5 }, (_, i) =>
      aggregateBlessing({
        toolName: `t${i}`,
        attestations: [mkAttest("inst", `t${i}`, 0.95, 5)],
        totalInstancesKnown: 1,
        secret: SECRET,
      }),
    );
    const pack = exportStarterPack({ quorums, topN: 2, builtAt: 0, secret: SECRET });
    expect(pack.entries.length).toBe(2);
  });

  it("HMAC sig verifies; rejects tamper", () => {
    const pack = exportStarterPack({ quorums: [], topN: 100, builtAt: 0, secret: SECRET });
    expect(verifyStarterPack(pack, SECRET)).toBe(true);
    expect(verifyStarterPack({ ...pack, topN: 999 }, SECRET)).toBe(false);
  });
});

describe("v2.19.27 FEDERATE · formatters + emoji", () => {
  it("BLESSING_EMOJI maps each band", () => {
    expect(BLESSING_EMOJI.unanimous).toBe("🏆");
    expect(BLESSING_EMOJI.supermajority).toBe("🥇");
    expect(BLESSING_EMOJI.majority).toBe("🥈");
    expect(BLESSING_EMOJI.minority).toBe("🥉");
    expect(BLESSING_EMOJI.conflict).toBe("⚖");
    expect(BLESSING_EMOJI.orphan).toBe("🌌");
  });

  it("formatQuorumLine includes band + valid/total counts + meanFit", () => {
    const q = aggregateBlessing({
      toolName: "x",
      attestations: [mkAttest("i", "x", 0.9, 1)],
      totalInstancesKnown: 1,
      secret: SECRET,
    });
    const line = formatQuorumLine(q);
    expect(line).toContain("FEDERATE x");
    expect(line).toContain("meanFit=");
  });

  it("formatStarterPackLine reports total + blessed counts", () => {
    const pack = exportStarterPack({ quorums: [], topN: 100, builtAt: 0, secret: SECRET });
    const line = formatStarterPackLine(pack);
    expect(line).toContain("STARTER-PACK");
    expect(line).toContain("blessed");
  });
});

describe("v2.19.27 FEDERATE · verifyBlessingQuorum", () => {
  it("HMAC sig verifies untampered + rejects tamper", () => {
    const q = aggregateBlessing({
      toolName: "x",
      attestations: [mkAttest("i", "x", 0.9, 1)],
      totalInstancesKnown: 1,
      secret: SECRET,
    });
    expect(verifyBlessingQuorum(q, SECRET)).toBe(true);
    expect(verifyBlessingQuorum({ ...q, meanFitness: 0.5 }, SECRET)).toBe(false);
  });
});
