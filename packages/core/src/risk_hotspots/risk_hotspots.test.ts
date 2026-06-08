import { describe, it, expect } from "vitest";
import { riskHotspots, riskSummary, riskGauntlet } from "./index.js";

const files = [
  { path: "schema.prisma", content: "model Wallet { id Int @id }\nmodel Log { id Int @id }" },
  { path: "pay.ts", content: "export function pay(req,res){ return chargeWallet(req.uid); }\nexport function chargeWallet(uid){ return prisma.wallet.update({where:{uid},data:{}}); }\nexport function logIt(){ return prisma.log.create({data:{}}); }" },
  { path: "routes.ts", content: "router.post(\"/pay\", pay);" },
];

describe("risk_hotspots", () => {
  it("gauntlet is 100", () => expect(riskGauntlet().score).toBe(100));

  it("ranks an untested sensitive keystone as the top CRITICAL hotspot, factors shown", () => {
    const hs = riskHotspots(files);
    expect(hs[0].name).toBe("chargeWallet");
    expect(hs[0].band).toBe("CRITICAL");
    expect(hs[0].factors.join(" ")).toMatch(/untested/);
    expect(hs[0].factors.join(" ")).toMatch(/SENSITIVE/);
  });

  it("adding a test lowers the hotspot's score (responds to real signals)", () => {
    const before = riskHotspots(files)[0].score;
    const after = riskHotspots([...files, { path: "pay.test.ts", content: "chargeWallet(1)" }]).find((h) => h.name === "chargeWallet")!;
    expect(after.score).toBeLessThan(before);
    expect(after.factors.join(" ")).not.toMatch(/untested/);
  });

  it("summary rolls up bands + worst", () => {
    const s = riskSummary(riskHotspots(files));
    expect(s.critical).toBeGreaterThanOrEqual(1);
    expect(s.worst!.name).toBe("chargeWallet");
  });

  it("top option limits the list", () => {
    expect(riskHotspots(files, { top: 1 }).length).toBe(1);
  });

  it("never throws on garbage", () => {
    expect(() => riskHotspots(null as never)).not.toThrow();
  });
});
