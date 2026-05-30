import { describe, it, expect } from "vitest";
import { parseRobots, isPathAllowed, rateAcquire, distill, ingestSource, verifyProvenance, archaeologyGauntlet } from "./index.js";

const R = process.cwd();

describe("v2.107 DATA ARCHAEOLOGY — signed provenance ingest", () => {
  it("respects robots.txt (longest-match; ties → allow)", () => {
    const r = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/ok", "mneme");
    expect(isPathAllowed(r, "/public")).toBe(true);
    expect(isPathAllowed(r, "/private/secret")).toBe(false);
    expect(isPathAllowed(r, "/private/ok/page")).toBe(true);   // more specific Allow wins
  });

  it("inherits the * block when the agent has no specific rules", () => {
    const r = parseRobots("User-agent: *\nDisallow: /x\nUser-agent: googlebot\nDisallow: /", "mneme");
    expect(isPathAllowed(r, "/x")).toBe(false);
    expect(isPathAllowed(r, "/y")).toBe(true);
  });

  it("rate-limits with a deterministic token bucket", () => {
    const a = rateAcquire(null, 2, 1, 1000);
    const b = rateAcquire(a.state, 2, 1, 1000);
    const c = rateAcquire(b.state, 2, 1, 1000);
    expect(a.allowed && b.allowed).toBe(true);
    expect(c.allowed).toBe(false);
    expect(c.waitMs).toBeGreaterThan(0);
    // refills over time
    expect(rateAcquire(c.state, 2, 1, 3000).allowed).toBe(true);
  });

  it("distills dense fact-shaped statements, dropping chatter (deterministic)", () => {
    const facts = distill("The error rate is 3.2 percent. ok. Mneme Cortex signs every fact. lol. Version 2.1 ships now.");
    expect(facts.length).toBeGreaterThanOrEqual(2);
    expect(facts.join(" ")).not.toContain("lol");
    // deterministic
    expect(distill("The error rate is 3.2 percent.")).toEqual(distill("The error rate is 3.2 percent."));
  });

  it("ingest produces facts each with SIGNED, offline-verifiable provenance", () => {
    const ing = ingestSource(R, { url: "https://src.example/x", content: "Latency is 42 ms at peak. The system supports 1000 users.", fetchedAt: 1700000000000 }, 1700000000000);
    expect(ing.facts.length).toBeGreaterThan(0);
    const f = ing.facts[0]!;
    const v = verifyProvenance(f);
    expect(v.bound).toBe(true);
    expect(v.sourceUrl).toBe("https://src.example/x");
  });

  it("a FORGED source/statement is caught (tamper-evident provenance)", () => {
    const ing = ingestSource(R, { url: "https://real.example", content: "The ratio is 9 to 1 in production.", fetchedAt: 1 }, 1);
    for (const mut of [
      (x: Record<string, unknown>) => { x.sourceUrl = "https://evil.example"; },
      (x: Record<string, unknown>) => { x.statement = "fabricated claim"; },
      (x: Record<string, unknown>) => { x.contentHash = "deadbeef"; },
      (x: Record<string, unknown>) => { x.fetchedAt = 999; },
    ]) {
      const t = JSON.parse(JSON.stringify(ing.facts[0])); mut(t);
      expect(verifyProvenance(t).bound).toBe(false);
    }
  });

  it("archaeology gauntlet scores 100", () => {
    const g = archaeologyGauntlet(R, 1700000000000);
    expect(g.robotsRespected).toBe(true);
    expect(g.rateLimits).toBe(true);
    expect(g.distills).toBe(true);
    expect(g.signedProvenance).toBe(true);
    expect(g.forgeryCaught).toBe(true);
    expect(g.score).toBe(100);
  });

  it("STABILITY — total on garbage", () => {
    expect(() => parseRobots(null as never)).not.toThrow();
    expect(isPathAllowed(null as never, null as never)).toBe(true);
    expect(distill(null as never)).toEqual([]);
    expect(ingestSource(R, null as never, 0).distilled).toBe(0);
    expect(verifyProvenance(null as never).bound).toBe(false);
  });
});
