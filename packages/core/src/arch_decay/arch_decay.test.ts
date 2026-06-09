import { describe, it, expect } from "vitest";
import { measureDebt, decaySeries, archDecayGauntlet, type DebtSnapshot } from "./index.js";

const snap = (couplings: number, keystones = 0, authzGaps = 0, author?: string): DebtSnapshot => ({ functions: 0, tables: 0, endpoints: 0, couplings, keystones, authzGaps, author });

describe("arch_decay", () => {
  it("gauntlet is 100", () => expect(archDecayGauntlet().score).toBe(100));

  it("measureDebt counts cross-layer couplings from the graph", () => {
    const m = measureDebt([
      { path: "s.prisma", content: "model Wallet { id Int @id }" },
      { path: "r.ts", content: "router.get(\"/bal\", getBal);" },
      { path: "h.ts", content: "export function getBal(){ return prisma.wallet.findMany(); }" },
    ]);
    expect(m.couplings).toBeGreaterThanOrEqual(2);
    expect(m.tables).toBe(1);
    expect(m.endpoints).toBe(1);
  });

  it("rising coupling → ERODING with the worst-step commit + author", () => {
    const r = decaySeries([snap(10), snap(20), snap(45, 0, 0, "Bob")]);
    expect(r.trend).toBe("ERODING");
    expect(r.velocity.couplings).toBeGreaterThan(0);
    expect(r.worstStep?.toIndex).toBe(2);
    expect(r.worstStep?.author).toBe("Bob");
  });

  it("falling coupling → IMPROVING; flat → STABLE", () => {
    expect(decaySeries([snap(40), snap(30), snap(15)]).trend).toBe("IMPROVING");
    expect(decaySeries([snap(20), snap(20), snap(20)]).trend).toBe("STABLE");
  });

  it("new authz gaps erode even when coupling is flat", () => {
    expect(decaySeries([snap(20, 0, 0), snap(20, 0, 2)]).trend).toBe("ERODING");
  });

  it("never throws on garbage / <2 snapshots", () => {
    expect(() => measureDebt(null as never)).not.toThrow();
    expect(() => decaySeries(null as never)).not.toThrow();
    expect(decaySeries([snap(1)]).trend).toBe("STABLE");
  });
});
