import { describe, it, expect } from "vitest";
import { mintGenesis, birth, verifyBirth, verifyLineage, actionAllowed, arkBench, arkGauntlet, scarOf, type AgentGenome } from "./index.js";

const sealLike = (g: AgentGenome, patch: Partial<AgentGenome>) => ({ ...g, ...patch }); // tamper helper (id stays stale)

describe("v3.136 · THE ARK — accountable AI reproduction", () => {
  it("gauntlet is 100", () => expect(arkGauntlet().score).toBe(100));

  it("★ a malicious birth is NEVER approved (precision 1.0, ≥98.5% accuracy)", () => {
    const b = arkBench();
    expect(b.approvePrecision).toBe(1);
    expect(b.leaks).toEqual([]);
    expect(b.accuracy).toBeGreaterThanOrEqual(0.985);
  });

  it("a valid child inherits + narrows; verifyBirth passes", () => {
    const root = mintGenesis("eden", { values: ["honesty"] }, { bounds: ["delete-db"], scars: [scarOf("rm -rf /", "drowned the old world")] });
    const child = birth(root, "worker", { addBounds: ["spend"], addScars: [scarOf("disable-auth", "incident")] });
    expect(verifyBirth(root, child).ok).toBe(true);
    expect(child.bounds).toContain("delete-db");        // kept parent bound
    expect(child.scars.length).toBe(2);                 // carried + added
    expect(child.generation).toBe(1);
  });

  it("blocks privilege escalation + scar amnesia (tamper the child)", () => {
    const root = mintGenesis("eden", { values: ["honesty"] }, { bounds: ["delete-db"], scars: [scarOf("rm -rf /", "x")] });
    const child = birth(root, "w");
    expect(verifyBirth(root, sealLike(child, { bounds: [] })).ok).toBe(false);   // dropped a bound → caught (id mismatch + escalation)
    expect(verifyBirth(root, sealLike(child, { scars: [] })).ok).toBe(false);    // forgot the scar → caught
  });

  it("runtime gate denies a bounded/scarred action", () => {
    const root = mintGenesis("e", { values: [] }, { bounds: ["delete-prod-db"] });
    expect(actionAllowed(root, "delete-prod-db").allowed).toBe(false);
    expect(actionAllowed(root, "read-file").allowed).toBe(true);
  });

  it("a clean bloodline verifies end-to-end", () => {
    const root = mintGenesis("e", { values: ["v"] });
    const c1 = birth(root, "c1", { addBounds: ["x"] });
    const c2 = birth(c1, "c2", { addScars: [scarOf("y", "z")] });
    expect(verifyLineage([root, c1, c2]).ok).toBe(true);
  });

  it("is total on hostile input", () => {
    expect(() => birth(null as never, "x")).not.toThrow();
    expect(() => verifyBirth(null as never, null as never)).not.toThrow();
    expect(mintGenesis("", { values: [] }).ark).toBe("ARK/1");
  });
});
