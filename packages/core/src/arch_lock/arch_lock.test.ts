import { describe, it, expect } from "vitest";
import { buildLock, checkLock, archLockGauntlet } from "./index.js";

const base = [
  { path: "schema.prisma", content: "model Account { id Int @id }" },
  { path: "routes.ts", content: "router.get(\"/v1/users/:id\", getUser);\nrouter.post(\"/v1/charge\", payHandler);" },
  { path: "h.ts", content: "export function getUser(req){ requireAuth(req); return 1; }\nexport function requireAuth(r){ return r.user; }\nexport function payHandler(req){ requireAuth(req); return prisma.account.update({where:{}}); }" },
];

describe("arch_lock", () => {
  it("gauntlet is 100", () => expect(archLockGauntlet().score).toBe(100));

  it("buildLock captures the contract with a fingerprint", () => {
    const lock = buildLock(base);
    expect(lock.endpoints.length).toBeGreaterThanOrEqual(2);
    expect(lock.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it("self-check: same repo → no violations, fingerprint matches", () => {
    const lock = buildLock(base);
    const r = checkLock(lock, base);
    expect(r.ok).toBe(true);
    expect(r.fingerprintMatch).toBe(true);
  });

  it("removing an endpoint is a BREAKING regression", () => {
    const lock = buildLock(base);
    const r = checkLock(lock, [base[0], { path: "routes.ts", content: "router.post(\"/v1/charge\", payHandler);" }, base[2]]);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.kind === "REMOVED_ENDPOINT")).toBe(true);
  });

  it("a NEW authz gap is a SECURITY regression", () => {
    const lock = buildLock(base);
    const gapped = [base[0], base[1], { path: "h.ts", content: "export function getUser(req){ requireAuth(req); return 1; }\nexport function requireAuth(r){ return r.user; }\nexport function payHandler(req){ return prisma.account.update({where:{}}); }" }];
    const r = checkLock(lock, gapped);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.kind === "NEW_AUTHZ_GAP")).toBe(true);
  });

  it("adding an endpoint is allowed (not a violation)", () => {
    const lock = buildLock(base);
    const added = [base[0], { path: "routes.ts", content: base[1].content + "\nrouter.get(\"/v1/health\", getUser);" }, base[2]];
    const r = checkLock(lock, added);
    expect(r.ok).toBe(true);
    expect(r.addedEndpoints.some((e) => e.includes("/v1/health"))).toBe(true);
  });

  it("never throws on garbage", () => {
    expect(() => buildLock(null as never)).not.toThrow();
    expect(() => checkLock(null as never, null as never)).not.toThrow();
  });
});
