import { describe, it, expect } from "vitest";
import { forgettingGauntlet } from "./index.js";
describe("PROOF-OF-FORGETTING", () => {
  it("MEASURED: forgettingGauntlet = 100", () => { const g = forgettingGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass)); expect(g.score).toBe(100); });
});
