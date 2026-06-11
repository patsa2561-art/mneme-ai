import { describe, it, expect } from "vitest";
import { buildCrossLayerGraph } from "../cross_layer_graph/index.js";
import { deadPaths, deadPathGauntlet } from "./index.js";

const g = buildCrossLayerGraph([
  { path: "schema.prisma", content: "model Audit { id Int @id }\nmodel Seed { id Int @id }\nmodel Live { id Int @id }" },
  { path: "api.ts", content:
    "router.get(\"/x\", handler);\n" +
    "export function handler(){ return helper(); }\n" +
    "export function helper(){ return prisma.seed.findMany(); }\n" +
    "export function logAudit(){ return prisma.audit.create({data:{}}); }\n" +
    "export function liveWrite(){ return prisma.live.create({data:{}}); }\n" +
    "export function liveRead(){ return prisma.live.findMany(); }\n" },
]);

describe("dead_path", () => {
  it("gauntlet is 100", () => expect(deadPathGauntlet().score).toBe(100));

  it("flags a write-only table, not a read+written one", () => {
    const d = deadPaths(g);
    expect(d.writeOnlyTables.some((t) => /audit/i.test(t.name))).toBe(true);
    expect(d.writeOnlyTables.some((t) => /live/i.test(t.name))).toBe(false);
  });

  it("flags a read-only table", () => {
    expect(deadPaths(g).readOnlyTables.some((t) => /seed/i.test(t.name))).toBe(true);
  });

  it("flags a function reachable from no endpoint; not handlers/callees", () => {
    const d = deadPaths(g);
    expect(d.endpointUnreachableFunctions.some((f) => /logAudit/i.test(f.name))).toBe(true);
    expect(d.endpointUnreachableFunctions.some((f) => /handler|helper/i.test(f.name))).toBe(false);
  });

  it("does NOT compute unreachability when there are no endpoints", () => {
    const d = deadPaths(buildCrossLayerGraph([{ path: "x.ts", content: "export function a(){ return 1; }" }]));
    expect(d.hasEndpoints).toBe(false);
    expect(d.endpointUnreachableFunctions.length).toBe(0);
  });

  it("never throws on garbage", () => {
    expect(() => deadPaths(null as never)).not.toThrow();
    expect(deadPaths(null as never).clean).toBe(true);
  });
});
