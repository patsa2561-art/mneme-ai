import { describe, it, expect } from "vitest";
import { HYDRA_TOOLS } from "./_hydra_tools.js";

const rt = { meta: { rootPath: process.cwd() } } as never;
const byName = Object.fromEntries(HYDRA_TOOLS.map((t) => [t.name, t]));
const CORPUS = "alpha beta alpha beta gamma delta. alpha beta alpha beta gamma delta. ".repeat(8);
/* eslint-disable @typescript-eslint/no-explicit-any */
const D = (r: { data: unknown }): any => r.data;
const call = (name: string, args: Record<string, unknown>) => byName[name]!.handler(rt, args as never);

describe("v2.101 HYDRA MCP tools — protocol surface + self-attesting results", () => {
  it("exposes the full HYDRA stack as mneme.hydra.* tools", () => {
    expect(HYDRA_TOOLS.map((t) => t.name)).toEqual([
      "mneme.hydra.forge", "mneme.hydra.gauntlet", "mneme.hydra.guard",
      "mneme.hydra.chain", "mneme.hydra.replay", "mneme.hydra.verify",
    ]);
    for (const t of HYDRA_TOOLS) { expect(typeof t.handler).toBe("function"); expect(t.inputSchema?.type).toBe("object"); }
  });

  it("forge returns a sound gauntlet AND a NOTARY self-attest proof", async () => {
    const r = D(await call("mneme.hydra.forge", { text: CORPUS }));
    expect(r.gauntlet.score).toBe(100);
    expect(r._proof).toBeTruthy();
    expect(r._proof.receipt).toBeTruthy();
    expect(typeof r._proof.dataHash).toBe("string");
  });

  it("THE GEM — verify confirms a genuine result and CATCHES a tampered one", async () => {
    const r = D(await call("mneme.hydra.forge", { text: CORPUS }));
    const data = { ...r }; const proof = data._proof; delete data._proof;
    const good = D(await call("mneme.hydra.verify", { proof, data }));
    expect(good.genuine).toBe(true);
    expect(good.signatureValid).toBe(true);
    expect(good.dataHashMatches).toBe(true);
    // tamper the data → must be caught
    const evil = D(await call("mneme.hydra.verify", { proof, data: { ...data, gauntlet: { ...data.gauntlet, score: 0 } } }));
    expect(evil.genuine).toBe(false);
  });

  it("guard + gauntlet tools return signed sound verdicts", async () => {
    const g = D(await call("mneme.hydra.guard", { text: CORPUS, staleFraction: 0.3 }));
    expect(g.guarded.score).toBe(100);
    expect(g._proof).toBeTruthy();
    const a = D(await call("mneme.hydra.gauntlet", { text: CORPUS }));
    expect(a.gauntlet.score).toBe(100);
  });

  it("chain + replay flow through the protocol (append → temporal guarded replay)", async () => {
    const c = D(await call("mneme.hydra.chain", { text: CORPUS, commit: "abc123", subject: "test" }));
    expect(c.gauntlet.score).toBe(100);
    const rep = D(await call("mneme.hydra.replay", { guard: true, halflife: 1 }));
    expect(rep.ok ?? true).not.toBe(false);
  });

  it("STABILITY — every handler is total (garbage args never throw)", async () => {
    for (const t of HYDRA_TOOLS) {
      await expect(t.handler(rt, { index: "nope", staleFraction: "x", text: 123 } as never)).resolves.toBeTruthy();
    }
    const bad = D(await call("mneme.hydra.verify", {}));
    expect(bad.ok).toBe(false);
  });
});
