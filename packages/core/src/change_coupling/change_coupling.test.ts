import { describe, it, expect } from "vitest";
import { buildCrossLayerGraph } from "../cross_layer_graph/index.js";
import { changeCoupling, changeCouplingGauntlet } from "./index.js";

const g = buildCrossLayerGraph([
  { path: "schema.prisma", content: "model User { id Int @id }" },
  { path: "auth.ts", content: "export function register(){ return prisma.user.create({data:{}}); }" },
  { path: "billing.ts", content: "export function bill(){ return 1; }" },
  { path: "notify.ts", content: "export function notify(){ return 2; }" },
]);
const cs = [
  ["auth.ts", "schema.prisma"], ["auth.ts", "schema.prisma"], ["auth.ts", "schema.prisma"],
  ["billing.ts", "notify.ts"], ["billing.ts", "notify.ts"], ["billing.ts", "notify.ts"],
  ["auth.ts"], ["billing.ts"],
];

describe("change_coupling", () => {
  it("gauntlet is 100", () => expect(changeCouplingGauntlet().score).toBe(100));

  it("a graph-explained co-change is STRUCTURAL", () => {
    const r = changeCoupling(cs, g, { minSupport: 3 });
    const authSchema = r.pairs.find((p) => (p.a.includes("auth") || p.b.includes("auth")) && (p.a.includes("schema") || p.b.includes("schema")));
    expect(authSchema?.structural).toBe(true);
  });

  it("a co-change with no graph link is HIDDEN", () => {
    const r = changeCoupling(cs, g, { minSupport: 3 });
    expect(r.hidden.some((p) => (p.a.includes("billing") || p.b.includes("billing")) && (p.a.includes("notify") || p.b.includes("notify")))).toBe(true);
    expect(r.hidden.some((p) => p.a.includes("auth") && p.b.includes("schema"))).toBe(false);
  });

  it("respects minSupport (a single co-change is ignored)", () => {
    expect(changeCoupling([["x.ts", "y.ts"]], g, { minSupport: 3 }).pairs.length).toBe(0);
  });

  it("normalizes path separators (git '/' vs scanned '\\')", () => {
    const g2 = buildCrossLayerGraph([{ path: "a\\b.prisma", content: "model T { id Int @id }" }, { path: "a\\w.ts", content: "export function w(){ return prisma.t.create({data:{}}); }" }]);
    const r = changeCoupling([["a/w.ts", "a/b.prisma"], ["a/w.ts", "a/b.prisma"], ["a/w.ts", "a/b.prisma"]], g2, { minSupport: 3 });
    expect(r.pairs[0]?.structural).toBe(true);   // forward-slash changesets match backslash graph paths
  });

  it("never throws on garbage", () => {
    expect(() => changeCoupling(null as never, null as never)).not.toThrow();
  });
});
