import { describe, it, expect } from "vitest";
import { dossierGauntlet } from "./index.js";
describe("ACCOUNTABILITY DOSSIER", () => {
  it("MEASURED: dossierGauntlet = 100", async () => { const g = await dossierGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass)); expect(g.score).toBe(100); });
});
