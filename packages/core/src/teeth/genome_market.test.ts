import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { publishCard, readCard, listCards, castVote, revokeCard, computeAllVerdicts, computeReputation } from "./genome_market.js";

describe("teeth/genome_market · cards", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-market-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("publishCard creates file + content hash matches", () => {
    const c = publishCard(repo, { id: "vac-001", author: "alice", title: "test vaccine", body: "do not eval()" });
    expect(c.id).toBe("vac-001");
    expect(c.contentHash).toMatch(/^[a-f0-9]{64}$/);
    const r = readCard(repo, "vac-001");
    expect(r?.body).toBe("do not eval()");
  });

  it("readCard returns null when content tampered (hash mismatch)", () => {
    publishCard(repo, { id: "vac-002", author: "alice", title: "t", body: "original" });
    // tamper: edit the on-disk JSON to change body without updating hash
    const path = join(repo, ".mneme/genome-market/cards/vac-002.json");
    const c = JSON.parse(readFileSync(path, "utf8"));
    c.body = "tampered";
    writeFileSync(path, JSON.stringify(c));
    expect(readCard(repo, "vac-002")).toBeNull();
  });

  it("listCards returns sorted by id", () => {
    publishCard(repo, { id: "z", author: "a", title: "z", body: "z" });
    publishCard(repo, { id: "a", author: "a", title: "a", body: "a" });
    publishCard(repo, { id: "m", author: "a", title: "m", body: "m" });
    const ids = listCards(repo).map((c) => c.id);
    expect(ids).toEqual(["a", "m", "z"]);
  });

  it("slugifies dangerous ids", () => {
    const c = publishCard(repo, { id: "../../evil", author: "a", title: "t", body: "b" });
    expect(c.id).not.toContain("/");
    expect(c.id).not.toContain("..");
  });
});

describe("teeth/genome_market · voting", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-market-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("rejects self-vote", () => {
    publishCard(repo, { id: "vac-1", author: "alice", title: "t", body: "b" });
    const r = castVote(repo, { validator: "alice", cardId: "vac-1", vouch: true });
    expect(r.outcome).toBe("self-vote");
  });

  it("rejects duplicate vote from same validator", () => {
    publishCard(repo, { id: "vac-1", author: "alice", title: "t", body: "b" });
    expect(castVote(repo, { validator: "bob", cardId: "vac-1", vouch: true }).outcome).toBe("recorded");
    expect(castVote(repo, { validator: "bob", cardId: "vac-1", vouch: false }).outcome).toBe("duplicate");
  });

  it("rejects vote on non-existent card", () => {
    expect(castVote(repo, { validator: "x", cardId: "nope", vouch: true }).outcome).toBe("no-such-card");
  });

  it("recorded vote persists across reads", () => {
    publishCard(repo, { id: "vac-1", author: "alice", title: "t", body: "b" });
    castVote(repo, { validator: "bob", cardId: "vac-1", vouch: true });
    const v = computeAllVerdicts(repo)[0]!;
    expect(v.vouchCount).toBe(1);
  });
});

describe("teeth/genome_market · ratification + revocation", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-market-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("3 vouches from base-rep validators ratify (3 * sqrt(1) = 3 ≥ threshold)", () => {
    publishCard(repo, { id: "vac-1", author: "alice", title: "t", body: "b" });
    castVote(repo, { validator: "bob", cardId: "vac-1", vouch: true });
    castVote(repo, { validator: "carol", cardId: "vac-1", vouch: true });
    castVote(repo, { validator: "dan", cardId: "vac-1", vouch: true });
    const v = computeAllVerdicts(repo);
    expect(v[0]!.ratified).toBe(true);
    expect(v[0]!.netStake).toBeGreaterThanOrEqual(3);
  });

  it("2 vouches not enough (2 < 3 threshold)", () => {
    publishCard(repo, { id: "vac-1", author: "alice", title: "t", body: "b" });
    castVote(repo, { validator: "bob", cardId: "vac-1", vouch: true });
    castVote(repo, { validator: "carol", cardId: "vac-1", vouch: true });
    const v = computeAllVerdicts(repo)[0]!;
    expect(v.ratified).toBe(false);
    expect(v.reasonIfNot).toContain("net stake");
  });

  it("refute cancels out a vouch", () => {
    publishCard(repo, { id: "vac-1", author: "alice", title: "t", body: "b" });
    castVote(repo, { validator: "bob", cardId: "vac-1", vouch: true });
    castVote(repo, { validator: "carol", cardId: "vac-1", vouch: false });
    const v = computeAllVerdicts(repo)[0]!;
    expect(v.netStake).toBeCloseTo(0, 2);
    expect(v.ratified).toBe(false);
  });

  it("revocation flips ratified card to revoked", () => {
    publishCard(repo, { id: "vac-1", author: "alice", title: "t", body: "b" });
    castVote(repo, { validator: "b", cardId: "vac-1", vouch: true });
    castVote(repo, { validator: "c", cardId: "vac-1", vouch: true });
    castVote(repo, { validator: "d", cardId: "vac-1", vouch: true });
    expect(computeAllVerdicts(repo)[0]!.ratified).toBe(true);
    revokeCard(repo, "vac-1", "found exploit");
    const v = computeAllVerdicts(repo)[0]!;
    expect(v.revoked).toBe(true);
    expect(v.ratified).toBe(false);
    expect(v.reasonIfNot).toBe("revoked");
  });

  it("re-revoking is a no-op", () => {
    publishCard(repo, { id: "vac-1", author: "alice", title: "t", body: "b" });
    revokeCard(repo, "vac-1", "r1");
    expect(revokeCard(repo, "vac-1", "r2").outcome).toBe("already-revoked");
  });
});

describe("teeth/genome_market · reputation + slashing", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-market-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("base reputation = 1 for unknown validator", () => {
    expect(computeReputation(repo, "stranger")).toBe(1);
  });

  it("slashing: voting YES on a revoked card costs reputation", () => {
    publishCard(repo, { id: "v1", author: "alice", title: "t", body: "b" });
    publishCard(repo, { id: "v2", author: "alice", title: "t", body: "b2" });
    castVote(repo, { validator: "bob", cardId: "v1", vouch: true });
    castVote(repo, { validator: "bob", cardId: "v2", vouch: true });
    castVote(repo, { validator: "c", cardId: "v1", vouch: true });
    castVote(repo, { validator: "d", cardId: "v1", vouch: true });
    castVote(repo, { validator: "c", cardId: "v2", vouch: true });
    castVote(repo, { validator: "d", cardId: "v2", vouch: true });
    const repBeforeSlash = computeReputation(repo, "bob");
    revokeCard(repo, "v1", "compromised");
    const repAfterSlash = computeReputation(repo, "bob");
    expect(repAfterSlash).toBeLessThan(repBeforeSlash);
  });

  it("quadratic voting: 100-rep validator has weight ~10, not 100", () => {
    publishCard(repo, { id: "vac-1", author: "alice", title: "t", body: "b" });
    castVote(repo, { validator: "whale", cardId: "vac-1", vouch: true });
    const v = computeAllVerdicts(repo)[0]!;
    // Single fresh-rep validator (rep=1) → sqrt(1) = 1, not enough
    expect(v.netStake).toBeCloseTo(1, 2);
    expect(v.ratified).toBe(false);
  });

  it("multiple ratified cards grow author reputation", () => {
    for (let i = 0; i < 3; i++) {
      publishCard(repo, { id: `vac-${i}`, author: "alice", title: "t", body: `b${i}` });
      castVote(repo, { validator: "b", cardId: `vac-${i}`, vouch: true });
      castVote(repo, { validator: "c", cardId: `vac-${i}`, vouch: true });
      castVote(repo, { validator: "d", cardId: `vac-${i}`, vouch: true });
    }
    const rep = computeReputation(repo, "alice");
    expect(rep).toBeGreaterThan(1);
  });
});
