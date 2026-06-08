import { describe, it, expect } from "vitest";
import { buildCrossLayerGraph } from "../cross_layer_graph/index.js";
import { authzGaps, authzVerdict, authzGauntlet } from "./index.js";

const g = buildCrossLayerGraph([
  { path: "schema.prisma", content: "model Account { id Int @id }\nmodel Payment { id Int @id }\nmodel Log { id Int @id }" },
  { path: "routes.ts", content: "router.post(\"/transfer\", doTransfer);\nrouter.post(\"/admin/pay\", payHandler);\nrouter.get(\"/log\", writeLog);" },
  { path: "handlers.ts", content: "export function doTransfer(req,res){ return prisma.account.update({where:{}}); }\nexport function payHandler(req,res){ requireAdmin(req); return doPay(); }\nexport function requireAdmin(req){ return req.user.isAdmin; }\nexport function doPay(){ return prisma.payment.create({data:{}}); }\nexport function writeLog(){ return prisma.log.create({data:{}}); }" },
]);

describe("authz_gap", () => {
  it("gauntlet is 100", () => expect(authzGauntlet().score).toBe(100));

  it("flags an unguarded write to a sensitive table", () => {
    const gaps = authzGaps(g);
    const transfer = gaps.find((x) => x.endpoint === "/transfer");
    expect(transfer).toBeTruthy();
    expect(transfer!.sensitiveTables).toContain("Account");
    expect(transfer!.handler).toBe("doTransfer");
  });

  it("an auth function on the call path clears the flag", () => {
    expect(authzGaps(g).some((x) => x.endpoint === "/admin/pay")).toBe(false);   // requireAdmin guards doPay
  });

  it("a write to a NON-sensitive table is not flagged (no false alarm)", () => {
    expect(authzGaps(g).some((x) => x.endpoint === "/log")).toBe(false);          // Log isn't sensitive
  });

  it("verdict rolls up the exposed sensitive tables", () => {
    const v = authzVerdict(authzGaps(g));
    expect(v.clear).toBe(false);
    expect(v.worstTables).toContain("Account");
  });

  it("never throws on garbage", () => {
    expect(() => authzGaps(null as never)).not.toThrow();
    expect(() => authzVerdict(null as never)).not.toThrow();
  });
});
