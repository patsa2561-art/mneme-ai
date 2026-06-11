import { describe, it, expect } from "vitest";
import { checkChange, vaccinate, scarVaccineGauntlet, BUILTIN_SCARS } from "./index.js";

const S = BUILTIN_SCARS;

describe("scar_vaccine", () => {
  it("gauntlet is 100", () => expect(scarVaccineGauntlet().score).toBe(100));

  it("FIRES on a past-mistake shape (retry around charge, no idempotency key)", () => {
    const v = vaccinate({ files: ["payments/retry.ts"], code: "async function chargeWithRetry(req){ for(let i=0;i<3;i++){ await charge(req); } }" }, S);
    expect(v.fires).toBe(true);
    expect(v.firing.some((h) => h.scar.id === "SCAR-double-charge")).toBe(true);
  });

  it("STAYS QUIET when the antibody is present (same shape + idempotency key)", () => {
    const v = vaccinate({ files: ["payments/retry.ts"], code: "async function chargeWithRetry(req){ const idempotencyKey=req.id; for(let i=0;i<3;i++){ await charge({...req,idempotencyKey}); } }" }, S);
    expect(v.fires).toBe(false);
    expect(v.immune.some((h) => h.scar.id === "SCAR-double-charge")).toBe(true);
  });

  it("fires the N+1 scar on a per-row loop query", () => {
    const v = vaccinate({ files: ["api/orders.ts"], code: "for (const o of orders) { await prisma.user.findUnique({where:{id:o.userId}}); }" }, S);
    expect(v.firing.some((h) => h.scar.id === "SCAR-n-plus-1")).toBe(true);
  });

  it("is silent on a novel, unrelated change", () => {
    const v = vaccinate({ files: ["ui/Button.tsx"], code: "const color = theme.primary; return color;" }, S);
    expect(v.fires).toBe(false);
    expect(v.immune.length).toBe(0);
  });

  it("respects a custom corpus + the antibody asymmetry", () => {
    const scar = [{ id: "X", severity: "high" as const, title: "t", files: ["mod"], triggers: ["dangerousCall"], antibodies: ["safeGuard"], lesson: "use safeGuard" }];
    expect(vaccinate({ files: ["mod/a.ts"], code: "dangerousCall()" }, scar).fires).toBe(true);
    expect(vaccinate({ files: ["mod/a.ts"], code: "safeGuard(); dangerousCall()" }, scar).fires).toBe(false);
  });

  it("never throws on garbage", () => {
    expect(() => checkChange(null as never, null as never)).not.toThrow();
    expect(() => vaccinate(null as never, null as never)).not.toThrow();
    expect(vaccinate({}, []).fires).toBe(false);
  });
});
