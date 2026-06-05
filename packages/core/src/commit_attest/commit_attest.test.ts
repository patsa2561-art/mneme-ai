import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attestCommit, verifyAttest, verifyAttestChain, attestVerdict, attestGauntlet, type CommitFacts } from "./index.js";

const REPO = mkdtempSync(join(tmpdir(), "mneme-attest-"));
const facts = (i: number, secrets = 0): CommitFacts => ({
  sha: `${"f".repeat(36)}${1000 + i}`, author: "dev@x", agent: i % 2 ? "claude-code" : "human",
  subject: `commit ${i}`, files: [`src/f${i}.ts`], addedSecrets: secrets, diffHash: "d" + i, ts: 1700000000000 + i,
});

describe("COMMIT ATTESTATION — proof-carrying git commits (offline-verifiable, no trust)", () => {
  it("a signed attestation verifies offline + names the agent + the screened verdict", () => {
    const e = attestCommit(REPO, facts(0), null);
    const v = verifyAttest(e);
    expect(v.valid).toBe(true);
    expect(v.agent).toBe("human");
    expect(v.verdict).toBe("clean");
    expect(e.record.subject).toContain("commit:");
    expect(e.record.sig).toBeTruthy();
  });

  it("a commit that adds secrets is signed 'flagged' (honest verdict)", () => {
    expect(attestVerdict(facts(1, 3))).toBe("flagged");
    const e = attestCommit(REPO, facts(1, 3), null);
    expect(e.record.verdict).toBe("flagged");
    expect(verifyAttest(e).valid).toBe(true);
  });

  it("tampering ANY field breaks verification (facts→payloadHash + recordId binding)", () => {
    const e = attestCommit(REPO, facts(2), null);
    const bad = JSON.parse(JSON.stringify(e));
    bad.facts.author = "attacker@evil";
    expect(verifyAttest(bad).valid).toBe(false);   // readable provenance bound to the signature
    const bad2 = JSON.parse(JSON.stringify(e));
    bad2.record.verdict = "clean-but-was-flagged";
    expect(verifyAttest(bad2).valid).toBe(false);  // signed field bound to recordId
  });

  it("a chain verifies + reordering/splicing breaks lineage", () => {
    const chain = []; let prev: string | null = null;
    for (let i = 0; i < 4; i++) { const e = attestCommit(REPO, facts(i), prev); chain.push(e); prev = e.record.recordId; }
    expect(verifyAttestChain(chain).ok).toBe(true);
    expect(verifyAttestChain(chain).agents).toBeTruthy();
    const spliced = [chain[0], chain[2], chain[1], chain[3]];
    expect(verifyAttestChain(spliced).chainIntact).toBe(false);
    expect(verifyAttestChain(spliced).ok).toBe(false);
  });

  it("total on garbage", () => {
    expect(() => verifyAttest(null as never)).not.toThrow();
    expect(verifyAttest({ record: {}, receipt: {} } as never).valid).toBe(false);
    expect(() => verifyAttestChain([])).not.toThrow();
  });

  it("MEASURED: attestGauntlet scores 100 (chain · tamper · forge · reorder · honest-verdict · deterministic)", () => {
    const g = attestGauntlet(REPO);
    if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass));
    expect(g.score).toBe(100);
  });
});
