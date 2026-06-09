import { describe, it, expect } from "vitest";
import { buildCrossLayerGraph } from "../cross_layer_graph/index.js";
import { factsFromGraph, dropProof, reachesProof, graphLogicGauntlet } from "./index.js";

const g = buildCrossLayerGraph([
  { path: "schema.prisma", content: "model Wallet { id Int @id }\nmodel Orphan { id Int @id }" },
  { path: "routes.ts", content: "router.get(\"/balance\", getBalance);" },
  { path: "svc.ts", content: "export function getBalance(){ return readWallet(); }\nexport function readWallet(){ return prisma.wallet.findMany(); }" },
]);

describe("graph_logic", () => {
  it("gauntlet is 100", () => expect(graphLogicGauntlet().score).toBe(100));

  it("turns the graph into ground logic atoms", () => {
    const f = factsFromGraph(g);
    expect(f).toContain("reads(readwallet,wallet)");
    expect(f).toContain("calls(getbalance,readwallet)");
    expect(f.some((x) => x.startsWith("serves("))).toBe(true);
  });

  it("PROVEN unsafe to drop a read table, with a proof chain to the reader", () => {
    const d = dropProof(g, "Wallet");
    expect(d.verdict).toBe("UNSAFE");
    expect(d.blockers.some((b) => b.kind === "reader" && b.name === "readwallet")).toBe(true);
    expect(d.chain.some((s) => s.atom === "unsafe_to_drop(wallet)")).toBe(true);
  });

  it("LIKELY_SAFE (prove-or-unknown) for a table nothing touches — never a false safe", () => {
    const d = dropProof(g, "Orphan");
    expect(d.verdict).toBe("LIKELY_SAFE");
    expect(d.blockers.length).toBe(0);
  });

  it("PROVEN reaches: endpoint → table through the call graph", () => {
    const r = reachesProof(g, "/balance", "Wallet");
    expect(r.reachable).toBe(true);
    expect(r.chain.length).toBeGreaterThan(0);
  });

  it("never throws on garbage", () => {
    expect(() => factsFromGraph(null as never)).not.toThrow();
    expect(() => dropProof(null as never, "x")).not.toThrow();
    expect(() => reachesProof(null as never, "a", "b")).not.toThrow();
  });
});
