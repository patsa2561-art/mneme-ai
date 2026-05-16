import { describe, it, expect } from "vitest";
import { buildBroadcast, verifyBroadcast, drainBroadcasts, formatBroadcastLine, formatDrainLine } from "./index.js";

describe("v2.19.7 · COLONY MIND — federated NEXUS broadcast", () => {
  it("buildBroadcast produces signed envelope", () => {
    const b = buildBroadcast({
      fromInstance: "host-a",
      refutedClaimText: "calculateTotal lives at src/foo.ts:42",
      refuteEvidence: "git log shows symbol moved to src/billing/total.ts:88",
      refuteConfidence: 0.92,
      refuteVendor: "grok",
    });
    expect(b.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(b.broadcastId).toMatch(/^cb-[0-9a-f]{14}$/);
    expect(verifyBroadcast(b)).toBe(true);
  });

  it("verifyBroadcast detects tampering", () => {
    const b = buildBroadcast({
      fromInstance: "host-a", refutedClaimText: "x", refuteEvidence: "y", refuteConfidence: 0.8, refuteVendor: "claude",
    });
    const tampered = { ...b, refuteConfidence: 0.01 };
    expect(verifyBroadcast(tampered)).toBe(false);
  });

  it("drainBroadcasts applies matching local pending claims", () => {
    const b = buildBroadcast({
      fromInstance: "host-a",
      refutedClaimText: "calculateTotal lives at src/foo.ts:42",
      refuteEvidence: "moved",
      refuteConfidence: 0.92, refuteVendor: "grok",
      matchThreshold: 0.3,
    });
    const localPending = [
      { claimId: "pc-local-1", body: "calculateTotal lives at src/foo.ts:42" },
      { claimId: "pc-local-2", body: "unrelated decision about color theme" },
    ];
    const deprecated: string[] = [];
    const r = drainBroadcasts({
      broadcasts: [b],
      localPending,
      localDeprecate: (id) => deprecated.push(id),
    });
    expect(r.applied).toBe(1);
    expect(r.localDeprecated[0]!.localClaimId).toBe("pc-local-1");
    expect(deprecated).toEqual(["pc-local-1"]);
  });

  it("drainBroadcasts ignores broadcasts with invalid sig", () => {
    const b = buildBroadcast({
      fromInstance: "host-a", refutedClaimText: "x", refuteEvidence: "y", refuteConfidence: 0.9, refuteVendor: "z",
    });
    const tampered = { ...b, fromInstance: "EVIL-PEER" };
    const r = drainBroadcasts({
      broadcasts: [tampered],
      localPending: [{ claimId: "pc-1", body: "x" }],
      localDeprecate: () => { throw new Error("MUST NOT BE CALLED"); },
    });
    expect(r.invalidSigs).toBe(1);
    expect(r.applied).toBe(0);
    expect(r.localDeprecated.length).toBe(0);
  });

  it("respects per-broadcast matchThreshold", () => {
    const strict = buildBroadcast({
      fromInstance: "host-a", refutedClaimText: "foo bar baz qux", refuteEvidence: "x", refuteConfidence: 0.9, refuteVendor: "z",
      matchThreshold: 0.95,
    });
    const r = drainBroadcasts({
      broadcasts: [strict],
      localPending: [{ claimId: "pc-1", body: "foo bar baz" }], // similar but not identical
      localDeprecate: () => { throw new Error("must not be called"); },
    });
    expect(r.applied).toBe(0);
  });

  it("DrainOutcome receipt is signed + summarises", () => {
    const b = buildBroadcast({
      fromInstance: "host-a", refutedClaimText: "x", refuteEvidence: "y", refuteConfidence: 0.9, refuteVendor: "z",
    });
    const r = drainBroadcasts({
      broadcasts: [b], localPending: [], localDeprecate: () => {},
    });
    expect(r.sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("formatters emit short summaries", () => {
    const b = buildBroadcast({
      fromInstance: "host-a", refutedClaimText: "x", refuteEvidence: "y", refuteConfidence: 0.9, refuteVendor: "claude",
    });
    expect(formatBroadcastLine(b)).toContain("COLONY");
    const d = drainBroadcasts({ broadcasts: [b], localPending: [], localDeprecate: () => {} });
    expect(formatDrainLine(d)).toContain("COLONY DRAIN");
  });
});
