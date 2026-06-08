import { describe, it, expect } from "vitest";
import { buildCrossLayerGraph } from "../cross_layer_graph/index.js";
import { footprint, detectCollisions, collisionVerdict, collisionGauntlet } from "./index.js";

const g = buildCrossLayerGraph([
  { path: "schema.prisma", content: "model User { id Int @id }\nmodel Wallet { id Int @id }\nmodel Audit { id Int @id }" },
  { path: "auth.ts", content: "export function register(uid){ return prisma.user.create({data:{}}); }" },
  { path: "billing.ts", content: "export function charge(uid){ prisma.user.update({where:{}}); return prisma.wallet.create({data:{}}); }" },
  { path: "report.ts", content: "export function report(){ return prisma.audit.findMany(); }" },
]);
const dAuth = "--- a/auth.ts\n+++ b/auth.ts\n@@ -1,1 +1,2 @@ export function register(uid){\n+x\n";
const dBilling = "--- a/billing.ts\n+++ b/billing.ts\n@@ -1,1 +1,2 @@ export function charge(uid){\n+x\n";
const dReport = "--- a/report.ts\n+++ b/report.ts\n@@ -1,1 +1,2 @@ export function report(){\n+x\n";

describe("agent_collision", () => {
  it("gauntlet is 100", () => expect(collisionGauntlet().score).toBe(100));

  it("footprint extracts what a change set writes/reads", () => {
    const fp = footprint(g, { agent: "a", diff: dBilling });
    expect(fp.writes).toContain("Wallet");
    expect(fp.writes).toContain("User");        // billing updates User
    expect(fp.files).toContain("billing.ts");
  });

  it("HIGH collision: two agents WRITE the same table from DIFFERENT files (git-invisible)", () => {
    const cols = detectCollisions(g, [{ agent: "claude", diff: dAuth }, { agent: "gpt", diff: dBilling }]);
    expect(cols.length).toBe(1);
    expect(cols[0].severity).toBe("HIGH");
    expect(cols[0].sharedWriteTables).toContain("User");
    expect(cols[0].sharedFiles).toEqual([]);    // different files — git sees NO conflict
  });

  it("no collision when footprints are disjoint (no false alarm)", () => {
    const cols = detectCollisions(g, [{ agent: "a", diff: dAuth }, { agent: "b", diff: dReport }]);
    expect(cols).toEqual([]);
    expect(collisionVerdict(cols).clear).toBe(true);
  });

  it("same-function edit by two agents → HIGH", () => {
    const cols = detectCollisions(g, [{ agent: "a", diff: dAuth }, { agent: "b", diff: dAuth }]);
    expect(cols[0].severity).toBe("HIGH");
    expect(cols[0].sharedFunctions).toContain("register");
    expect(cols[0].sharedFiles).toContain("auth.ts");
  });

  it("verdict rolls up the worst severity across pairs", () => {
    const cols = detectCollisions(g, [{ agent: "a", diff: dAuth }, { agent: "b", diff: dBilling }, { agent: "c", diff: dReport }]);
    const v = collisionVerdict(cols);
    expect(v.clear).toBe(false);
    expect(v.worst).toBe("HIGH");
  });

  it("never throws on garbage", () => {
    expect(() => detectCollisions(null as never, null as never)).not.toThrow();
    expect(() => footprint(null as never, null as never)).not.toThrow();
  });
});
