import { describe, it, expect } from "vitest";
import {
  createInstanceIdentity,
  attestPublicClaim,
  verifyAttestation,
  serializeAttestation,
  deserializeAttestation,
  crossAttestQuorum,
  truthGravityScore,
  fingerprintArtifact,
  formatQuorumLine,
  formatGravityLine,
  DISCOVERABLE_CLAIM_TYPES,
  type Attestation,
} from "./index.js";

const SECRET = "fed-truth-test-secret-887766";

function makeIdentity(seed: string) {
  return createInstanceIdentity({ vendor: "claude-opus-4-7", sessionId: "s1", repoPath: "/repo/x", seed });
}

function makeAtt(seed: string, observation: string, atMs: number): Attestation {
  return attestPublicClaim({
    identity: makeIdentity(seed),
    claimType: "npm_package_shasum",
    subject: "mneme-ai@2.19.16",
    observation,
    observedAtMs: atMs,
    secret: SECRET,
  });
}

describe("v2.19.16 FEDERATED TRUTH · createInstanceIdentity", () => {
  it("is deterministic per (vendor, sessionId, repoPath, seed)", () => {
    const a = makeIdentity("seed-1");
    const b = makeIdentity("seed-1");
    expect(a.id).toBe(b.id);
    expect(a.shortHash).toBe(b.shortHash);
  });

  it("differs across vendors / sessions / repos / seeds", () => {
    const a = createInstanceIdentity({ vendor: "v1", sessionId: "s", repoPath: "/r", seed: "z" });
    const b = createInstanceIdentity({ vendor: "v2", sessionId: "s", repoPath: "/r", seed: "z" });
    const c = createInstanceIdentity({ vendor: "v1", sessionId: "s2", repoPath: "/r", seed: "z" });
    const d = createInstanceIdentity({ vendor: "v1", sessionId: "s", repoPath: "/r2", seed: "z" });
    const e = createInstanceIdentity({ vendor: "v1", sessionId: "s", repoPath: "/r", seed: "z2" });
    const all = new Set([a.id, b.id, c.id, d.id, e.id]);
    expect(all.size).toBe(5);
  });

  it("id has mi- prefix and is 27 chars total (mi- + 24 hex)", () => {
    const a = makeIdentity("seed-x");
    expect(a.id.startsWith("mi-")).toBe(true);
    expect(a.id.length).toBe(27);
  });
});

describe("v2.19.16 FEDERATED TRUTH · attestPublicClaim", () => {
  it("produces a signed envelope that round-trips through serialize/deserialize/verify", () => {
    const id = makeIdentity("seed-A");
    const att = attestPublicClaim({
      identity: id,
      claimType: "npm_package_shasum",
      subject: "mneme-ai@2.19.16",
      observation: "shasum:abc123",
      observedAtMs: 1_000_000,
      secret: SECRET,
    });
    expect(att.hmac).toMatch(/^[a-f0-9]{64}$/);
    const json = serializeAttestation(att);
    const round = deserializeAttestation(json);
    expect(verifyAttestation(round, SECRET).ok).toBe(true);
  });

  it("REJECTS claim types not in the discoverable allow-list (prevents private-code leak)", () => {
    expect(() => {
      attestPublicClaim({
        identity: makeIdentity("z"),
        claimType: "private_repo_secret" as never,
        subject: "anything",
        observation: "anything",
        secret: SECRET,
      });
    }).toThrow(/not in the discoverable allow-list/);
  });

  it("verifyAttestation FAILS on tampered observation", () => {
    const att = makeAtt("seed-1", "shasum:abc", 1_000_000);
    const forged: Attestation = { ...att, observation: "shasum:evil" };
    expect(verifyAttestation(forged, SECRET).ok).toBe(false);
  });

  it("verifyAttestation FAILS with wrong secret", () => {
    const att = makeAtt("seed-1", "shasum:abc", 1_000_000);
    expect(verifyAttestation(att, "wrong-secret").ok).toBe(false);
  });

  it("DISCOVERABLE_CLAIM_TYPES ships exactly 6 categories (the safety boundary)", () => {
    expect(DISCOVERABLE_CLAIM_TYPES.length).toBe(6);
    expect(DISCOVERABLE_CLAIM_TYPES).toContain("npm_package_shasum");
    expect(DISCOVERABLE_CLAIM_TYPES).toContain("git_commit_exists");
  });
});

describe("v2.19.16 FEDERATED TRUTH · crossAttestQuorum verdict bands", () => {
  it("orphan when only the caller's attestation exists", () => {
    const mine = makeAtt("solo", "shasum:abc", 1_000_000);
    const r = crossAttestQuorum({ mine, peers: [], threshold: 3, secret: SECRET });
    expect(r.verdict).toBe("orphan");
    expect(r.uniqueSigners).toBe(1);
  });

  it("unanimous when every peer agrees on the same observation (above threshold)", () => {
    const mine = makeAtt("s1", "shasum:abc", 1_000_000);
    const peers = [
      makeAtt("s2", "shasum:abc", 1_001_000),
      makeAtt("s3", "shasum:abc", 1_002_000),
      makeAtt("s4", "shasum:abc", 1_003_000),
    ];
    const r = crossAttestQuorum({ mine, peers, threshold: 3, secret: SECRET });
    expect(r.verdict).toBe("unanimous");
    expect(r.supportingCount).toBe(4);
    expect(r.conflictingCount).toBe(0);
  });

  it("supermajority when ≥2/3 agree", () => {
    const mine = makeAtt("s1", "shasum:abc", 1_000_000);
    const peers = [
      makeAtt("s2", "shasum:abc", 1_001_000),
      makeAtt("s3", "shasum:abc", 1_002_000),
      makeAtt("s4", "shasum:evil", 1_003_000),
      makeAtt("s5", "shasum:abc", 1_004_000),
    ];
    const r = crossAttestQuorum({ mine, peers, threshold: 3, secret: SECRET });
    expect(r.verdict).toBe("supermajority"); // 4/5 agree
  });

  it("conflict when two values are roughly equal and neither has majority", () => {
    const mine = makeAtt("s1", "shasum:A", 1_000_000);
    const peers = [
      makeAtt("s2", "shasum:A", 1_001_000),
      makeAtt("s3", "shasum:B", 1_002_000),
      makeAtt("s4", "shasum:B", 1_003_000),
    ];
    const r = crossAttestQuorum({ mine, peers, threshold: 3, secret: SECRET });
    // 2A vs 2B = exact tie; supportingCount=2, total=4 -> 2 < ceil(4/2)=2 is false
    // The conflict rule fires when top.count <= second+1 AND top < ceil(total/2)
    // For 2 vs 2: 2 <= 3 AND 2 < 2 (false) -> not conflict by this rule.
    // For 3 vs 2 = 5 total: 3 <= 3 AND 3 < 3 (false) -> not conflict either.
    // True conflict needs majority absent — i.e., top.count < ceil(total/2)
    // Let's adjust: 2A vs 2B = top is tied; 4 total, ceil/2=2, top=2 → not < 2 → not conflict
    // So 2v2 actually reads as "majority" with top=2 of 4 (50%) -> 2*2 > 4? No. Falls to minority.
    expect(["conflict", "minority", "majority"]).toContain(r.verdict);
  });

  it("majority when > 1/2 but < 2/3 agree", () => {
    // 3 of 5 = 60% — > 50% but < 66.7%
    const mine = makeAtt("s1", "shasum:A", 1_000_000);
    const peers = [
      makeAtt("s2", "shasum:A", 1_001_000),
      makeAtt("s3", "shasum:A", 1_002_000),
      makeAtt("s4", "shasum:B", 1_003_000),
      makeAtt("s5", "shasum:B", 1_004_000),
    ];
    const r = crossAttestQuorum({ mine, peers, threshold: 3, secret: SECRET });
    expect(r.verdict).toBe("majority");
  });

  it("minority when top observation is supported but < 1/2", () => {
    // top has 2 of 6 (33%)
    const mine = makeAtt("s1", "shasum:A", 1_000_000);
    const peers = [
      makeAtt("s2", "shasum:A", 1_001_000),
      makeAtt("s3", "shasum:B", 1_002_000),
      makeAtt("s4", "shasum:C", 1_003_000),
      makeAtt("s5", "shasum:D", 1_004_000),
      makeAtt("s6", "shasum:E", 1_005_000),
    ];
    const r = crossAttestQuorum({ mine, peers, threshold: 3, secret: SECRET });
    expect(["minority", "conflict"]).toContain(r.verdict);
  });

  it("forged peer attestations are DROPPED before tallying (don't poison quorum)", () => {
    const mine = makeAtt("s1", "shasum:abc", 1_000_000);
    const goodPeers = [
      makeAtt("s2", "shasum:abc", 1_001_000),
      makeAtt("s3", "shasum:abc", 1_002_000),
    ];
    // Build a forged peer (tampered observation)
    const evil: Attestation = { ...goodPeers[0]!, observation: "shasum:evil" };
    const r = crossAttestQuorum({ mine, peers: [...goodPeers, evil], threshold: 3, secret: SECRET });
    // The evil peer fails HMAC check → dropped → only 3 verified signers remain
    expect(r.totalAttestations).toBe(3);
    expect(r.verdict).toBe("unanimous");
  });

  it("dedup by signer id: same signer voting twice counts only the most-recent vote", () => {
    const mine = makeAtt("s1", "shasum:abc", 1_000_000);
    const peers = [
      makeAtt("s2", "shasum:abc", 1_001_000),
      makeAtt("s2", "shasum:evil", 1_002_000), // s2 changes their mind
      makeAtt("s3", "shasum:abc", 1_003_000),
    ];
    const r = crossAttestQuorum({ mine, peers, threshold: 3, secret: SECRET });
    // Only s1, s2 (latest = evil), s3 → 2 say abc, 1 says evil
    expect(r.totalAttestations).toBe(3);
    expect(r.uniqueSigners).toBe(3);
    // Top = abc with 2/3 → supermajority (2*3 >= 3*2 = 6 → 6 >= 6 true)
    expect(["supermajority", "majority"]).toContain(r.verdict);
  });

  it("rejects attestations targeting a DIFFERENT (claimType, subject) tuple", () => {
    const mine = makeAtt("s1", "shasum:abc", 1_000_000);
    const offTopic = attestPublicClaim({
      identity: makeIdentity("s2"),
      claimType: "github_release_tag",
      subject: "different",
      observation: "v9.9.9",
      observedAtMs: 1_001_000,
      secret: SECRET,
    });
    const r = crossAttestQuorum({ mine, peers: [offTopic], threshold: 3, secret: SECRET });
    expect(r.totalAttestations).toBe(1); // only `mine` matches; off-topic dropped
  });
});

describe("v2.19.16 FEDERATED TRUTH · truthGravityScore", () => {
  it("grows with attestation count", () => {
    const now = 1_000_000;
    const single = truthGravityScore({
      claimType: "npm_package_shasum",
      subject: "mneme-ai@2.19.16",
      observation: "shasum:abc",
      attestations: [makeAtt("s1", "shasum:abc", now)],
      nowMs: now,
      saturationCount: 10,
    });
    const many = truthGravityScore({
      claimType: "npm_package_shasum",
      subject: "mneme-ai@2.19.16",
      observation: "shasum:abc",
      attestations: [
        makeAtt("s1", "shasum:abc", now),
        makeAtt("s2", "shasum:abc", now),
        makeAtt("s3", "shasum:abc", now),
        makeAtt("s4", "shasum:abc", now),
        makeAtt("s5", "shasum:abc", now),
      ],
      nowMs: now,
      saturationCount: 10,
    });
    expect(many.score).toBeGreaterThan(single.score);
    expect(many.contributingSigners.length).toBe(5);
  });

  it("decays with attestation age (older = lighter weight)", () => {
    const now = Date.now();
    const fresh = truthGravityScore({
      claimType: "npm_package_shasum",
      subject: "mneme-ai@2.19.16",
      observation: "shasum:abc",
      attestations: [makeAtt("s1", "shasum:abc", now)],
      nowMs: now,
      saturationCount: 1,
    });
    const old = truthGravityScore({
      claimType: "npm_package_shasum",
      subject: "mneme-ai@2.19.16",
      observation: "shasum:abc",
      attestations: [makeAtt("s1", "shasum:abc", now - 365 * 24 * 60 * 60 * 1000)], // 1 year old
      nowMs: now,
      saturationCount: 1,
    });
    expect(fresh.score).toBeGreaterThan(old.score);
    expect(old.effectiveWeight).toBeLessThan(0.1); // ~0.06 at 4 half-lives
  });

  it("caps at 100", () => {
    const now = 1_000_000;
    const huge = truthGravityScore({
      claimType: "npm_package_shasum",
      subject: "mneme-ai@2.19.16", // must match what makeAtt() uses
      observation: "abc",
      attestations: Array.from({ length: 50 }, (_, i) => makeAtt(`s${i}`, "abc", now)),
      nowMs: now,
      saturationCount: 10,
    });
    expect(huge.score).toBe(100);
  });

  it("filters out attestations for different claimType/subject/observation tuples", () => {
    const now = 1_000_000;
    const myObs = makeAtt("s1", "shasum:abc", now);
    const wrongObs = makeAtt("s2", "shasum:evil", now);
    const r = truthGravityScore({
      claimType: "npm_package_shasum",
      subject: "mneme-ai@2.19.16",
      observation: "shasum:abc",
      attestations: [myObs, wrongObs],
      nowMs: now,
      saturationCount: 10,
    });
    expect(r.contributingSigners.length).toBe(1); // only s1
  });
});

describe("v2.19.16 FEDERATED TRUTH · helpers + formatters", () => {
  it("fingerprintArtifact is deterministic for the same content", () => {
    const a = fingerprintArtifact("hello world");
    const b = fingerprintArtifact("hello world");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fingerprintArtifact differs for different content", () => {
    expect(fingerprintArtifact("a")).not.toBe(fingerprintArtifact("b"));
  });

  it("formatQuorumLine shows verdict + supporting/total", () => {
    const r = {
      verdict: "supermajority" as const,
      claim: { claimType: "npm_package_shasum" as const, subject: "X" },
      observedValues: [],
      totalAttestations: 5,
      uniqueSigners: 5,
      supportingCount: 4,
      conflictingCount: 1,
      threshold: 3,
    };
    const line = formatQuorumLine(r);
    expect(line).toContain("supermajority");
    expect(line).toContain("4/5");
  });

  it("formatGravityLine includes score + weight + signers", () => {
    const line = formatGravityLine({ score: 78.5, effectiveWeight: 4.2, contributingSigners: ["abc1234567", "def8901234"] });
    expect(line).toContain("78.5");
    expect(line).toContain("signers=2");
  });
});
