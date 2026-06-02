import { describe, it, expect } from "vitest";
import { route, extractEntities, benchmark, gatewayGauntlet } from "./index.js";

describe("v2.146 · THE INTENT GATEWAY", () => {
  it("gauntlet is 100", () => {
    expect(gatewayGauntlet().score).toBe(100);
  });

  it("MEASURED: beats the old keyword router by a wide margin (≥0.8 top-1)", () => {
    const b = benchmark();
    expect(b.newAcc).toBeGreaterThanOrEqual(0.8);
    expect(b.newAcc).toBeGreaterThan(b.oldAcc + 0.2);
  });

  it("nails the previously-failed cases (EN + Thai)", () => {
    expect(route("check if our agents are drifting from their mission").command).toBe("mneme telos");
    expect(route("ตรวจว่า agent กำลังเฉออกจากเป้าหมายไหม").command).toBe("mneme telos");
    expect(route("stop all the bots, something feels off").command).toBe("mneme govern");
    expect(route("make sure this risky diff is safe before it touches my code").command).toBe("mneme crucible");
    expect(route("ใครแก้ฟังก์ชันนี้ล่าสุดและทำไม").command).toBe("mneme haunt");
  });

  it("abstains (CLARIFY/UNKNOWN) on gibberish — never a confident misfire", () => {
    expect(route("asdfghjkl qwerty zzz").verdict).not.toBe("ROUTED");
  });

  it("extracts entities + compiles a runnable invocation", () => {
    const r = route("ดูแลเรื่องงบ 50000 ห้ามโพสต์ด่าใคร");
    expect(r.command).toBe("mneme govern");
    expect(r.entities.budget).toBe(50000);
    expect(r.entities.forbidden?.length).toBeGreaterThan(0);
    expect(r.invocation).toMatch(/charter-init --budget 50000/);
  });

  it("is total on hostile input", () => {
    expect(() => route(null as never)).not.toThrow();
    expect(() => extractEntities(undefined as never)).not.toThrow();
    expect(() => benchmark([])).not.toThrow();
  });
});
