// v2.33.0 — CITIZEN COURT discrete root tests.

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  recordRevealAndWait, vote, listVerdicts, listPending, verifyVerdict,
  computeHsc, readHsc, __resetConfessionalChainForTest,
} from "./index.js";
import type { CourtVerdict } from "./types.js";

function makeRepo(): string { return mkdtempSync(join(tmpdir(), "court-")); }

describe("CITIZEN COURT — reveal + vote", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); __resetConfessionalChainForTest(); });

  it("recordRevealAndWait respects delayMs=0 in tests", async () => {
    const t0 = Date.now();
    const r = await recordRevealAndWait(repo, {
      primaryVendor: "claude-opus-4-7",
      promptHash: "p1", primaryResponseHash: "r1", primaryAction: "accepted",
      revealVendors: ["gpt-5"], delayMs: 0,
      revealResponses: { "gpt-5": "alternate answer" },
    });
    expect(Date.now() - t0).toBeLessThan(500);
    expect(r.id).toMatch(/^rv-/);
    expect(r.reveal.reveals[0]!.vendor).toBe("gpt-5");
  });

  it("vote finalizes verdict + HMAC verifies + removes pending", async () => {
    const r = await recordRevealAndWait(repo, {
      primaryVendor: "claude", promptHash: "p", primaryResponseHash: "rA",
      primaryAction: "accepted", revealVendors: ["gpt", "gemini"], delayMs: 0,
      revealResponses: { gpt: "x", gemini: "y" },
    });
    expect(listPending(repo).length).toBe(1);
    const v = vote(repo, { revealId: r.id, votedMostTruthful: "gpt", reasoning: "more accurate" });
    expect(v.votedMostTruthful).toBe("gpt");
    expect(v.hmac).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyVerdict(v).ok).toBe(true);
    expect(listPending(repo).length).toBe(0);
    expect(listVerdicts(repo).length).toBe(1);
  });

  it("vote rejects target not in court", async () => {
    const r = await recordRevealAndWait(repo, {
      primaryVendor: "claude", promptHash: "p", primaryResponseHash: "rA",
      primaryAction: "accepted", revealVendors: ["gpt"], delayMs: 0,
    });
    expect(() => vote(repo, { revealId: r.id, votedMostTruthful: "deepseek" })).toThrow(/not in court/);
  });

  it("ABSTAIN vote is allowed + tracked as abstainsInvolving", async () => {
    const r = await recordRevealAndWait(repo, {
      primaryVendor: "claude", promptHash: "p", primaryResponseHash: "rA",
      primaryAction: "rejected", revealVendors: ["gpt"], delayMs: 0,
    });
    vote(repo, { revealId: r.id, votedMostTruthful: "ABSTAIN" });
    const hsc = readHsc(repo);
    const claude = hsc.find((h) => h.vendor === "claude")!;
    expect(claude.abstainsInvolving).toBe(1);
    expect(claude.truthfulVotes + claude.lostVotes).toBe(0); // no decisive vote
  });

  it("tampered verdict fails verify", async () => {
    const r = await recordRevealAndWait(repo, {
      primaryVendor: "claude", promptHash: "p", primaryResponseHash: "rA",
      primaryAction: "accepted", revealVendors: ["gpt"], delayMs: 0,
    });
    const v = vote(repo, { revealId: r.id, votedMostTruthful: "claude" });
    const tampered: CourtVerdict = { ...v, votedMostTruthful: "gpt" };
    expect(verifyVerdict(tampered).ok).toBe(false);
  });
});

describe("CITIZEN COURT — HSC computation", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); __resetConfessionalChainForTest(); });

  async function pushVote(primary: string, reveals: string[], winner: string): Promise<void> {
    const r = await recordRevealAndWait(repo, {
      primaryVendor: primary, promptHash: Math.random().toString(),
      primaryResponseHash: "x", primaryAction: "accepted",
      revealVendors: reveals, delayMs: 0,
    });
    vote(repo, { revealId: r.id, votedMostTruthful: winner });
  }

  it("vendor with all wins → high HSC + 🟢 trustworthy band when sample is clear", async () => {
    // Wilson LB at perfect score crosses 0.65 around n=10; below that the
    // confidence band is still cautious. Push 10 to clearly cross.
    for (let i = 0; i < 10; i++) await pushVote("claude", ["gpt"], "claude");
    const hsc = readHsc(repo);
    const claude = hsc.find((h) => h.vendor === "claude")!;
    expect(claude.truthfulVotes).toBe(10);
    expect(claude.lostVotes).toBe(0);
    expect(claude.honestyScoreRaw).toBe(1);
    expect(claude.band).toBe("🟢 trustworthy");
  });

  it("vendor with all losses → 🔴 suspect band when n>=5", async () => {
    for (let i = 0; i < 6; i++) await pushVote("loser", ["winner"], "winner");
    const loser = readHsc(repo).find((h) => h.vendor === "loser")!;
    expect(loser.truthfulVotes).toBe(0);
    expect(loser.lostVotes).toBe(6);
    expect(loser.band).toBe("🔴 suspect");
  });

  it("under-measured vendor (n<5) → ⚪ unmeasured + cohort note", async () => {
    await pushVote("x", ["y"], "x");
    const x = readHsc(repo).find((h) => h.vendor === "x")!;
    expect(x.band).toBe("⚪ unmeasured");
    expect(x.cohortNote).toMatch(/under-measured/);
  });

  it("HSC sorted by honestyScoreLB descending", async () => {
    for (let i = 0; i < 6; i++) await pushVote("top", ["bottom"], "top");
    for (let i = 0; i < 6; i++) await pushVote("bottom", ["top"], "top"); // top still wins
    const hsc = readHsc(repo);
    expect(hsc[0]!.vendor).toBe("top");
    expect(hsc[0]!.honestyScoreLB).toBeGreaterThan(hsc[1]!.honestyScoreLB);
  });

  it("Wilson LB always 0..1", async () => {
    for (let i = 0; i < 20; i++) await pushVote("v", ["w"], i % 3 === 0 ? "v" : "w");
    const hsc = readHsc(repo);
    for (const h of hsc) {
      expect(h.honestyScoreLB).toBeGreaterThanOrEqual(0);
      expect(h.honestyScoreLB).toBeLessThanOrEqual(1);
    }
  });
});
