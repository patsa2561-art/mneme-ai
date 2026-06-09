import { describe, it, expect } from "vitest";
import { parseInvariants, checkInvariants, invariantsGauntlet } from "./index.js";

const files = [
  { path: "schema.prisma", content: "model Payment { id Int @id }\nmodel Audit { id Int @id }\nmodel Secret { id Int @id }\nmodel Account { id Int @id }" },
  { path: "routes.ts", content: "router.post(\"/v1/charge\", charge);\nrouter.get(\"/v1/secret\", leakSecret);\nrouter.post(\"/v1/xfer\", xfer);" },
  { path: "h.ts", content: "export function charge(req){ requireAuth(req); return prisma.payment.create({data:{}}); }\nexport function requireAuth(r){ return r.user; }\nexport function leakSecret(){ return prisma.secret.findMany(); }\nexport function xfer(){ return prisma.account.update({where:{}}); }\nexport function aw(){ return prisma.audit.create({data:{}}); }\nexport function aw2(){ return prisma.audit.update({where:{}}); }" },
];

describe("invariants", () => {
  it("gauntlet is 100", () => expect(invariantsGauntlet().score).toBe(100));

  it("parses the DSL", () => {
    const inv = parseInvariants("table users single-writer\ntable creds private\nendpoint POST /x exists\n# comment\ngarbage line");
    expect(inv.map((i) => i.kind)).toEqual(["single-writer", "private", "exists", "invalid"]);
  });

  it("single-writer: HOLDS for 1, VIOLATED (names writers) for 2", () => {
    const r = checkInvariants(files, parseInvariants("table Payment single-writer\ntable Audit single-writer"));
    expect(r.results[0].status).toBe("HOLDS");
    expect(r.results[1].status).toBe("VIOLATED");
    expect(r.results[1].counterexample).toMatch(/aw/);
  });

  it("private: VIOLATED when an endpoint reaches it, HOLDS when none", () => {
    const r = checkInvariants(files, parseInvariants("table Secret private\ntable Audit private"));
    expect(r.results[0].status).toBe("VIOLATED");
    expect(r.results[1].status).toBe("HOLDS");
  });

  it("guarded VIOLATED on an unguarded sensitive write; exists HOLDS/VIOLATED", () => {
    const r = checkInvariants(files, parseInvariants("table Account guarded\nendpoint POST /v1/charge exists\nendpoint GET /nope exists"));
    expect(r.results[0].status).toBe("VIOLATED");
    expect(r.results[1].status).toBe("HOLDS");
    expect(r.results[2].status).toBe("VIOLATED");
    expect(r.allHold).toBe(false);
  });

  it("never throws on garbage", () => {
    expect(() => checkInvariants(null as never, null as never)).not.toThrow();
    expect(() => parseInvariants(null as never)).not.toThrow();
  });
});
