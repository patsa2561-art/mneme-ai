import { describe, it, expect } from "vitest";
import { buildCrossLayerGraph } from "../cross_layer_graph/index.js";
import { scorePosture, securityAudit, securityAuditGauntlet } from "./index.js";

describe("security_audit", () => {
  it("gauntlet is 100", () => expect(securityAuditGauntlet().score).toBe(100));

  it("scorePosture: clean=100/CLEAR, injection→AT-RISK, exfil→REVIEW, floored at 0", () => {
    expect(scorePosture({}).posture).toBe(100);
    expect(scorePosture({}).verdict).toBe("CLEAR");
    expect(scorePosture({ injection: 1 }).verdict).toBe("AT-RISK");
    expect(scorePosture({ authz: 1 }).verdict).toBe("AT-RISK");
    expect(scorePosture({ exfil: 1 }).verdict).toBe("REVIEW");
    expect(scorePosture({ injection: 99 }).posture).toBe(0);
  });

  it("securityAudit composes all three axes", () => {
    const files = [{ path: "api.ts", content:
      "router.get(\"/search\", search);\nexport function search(req){ return db.query(\"SELECT \" + req.query.q); }\n" +
      "router.get(\"/me\", getMe);\nexport function getMe(){ return prisma.credentials.findMany(); }\n" }];
    const g = buildCrossLayerGraph([{ path: "schema.prisma", content: "model Credentials { id Int @id }" }, ...files]);
    const a = securityAudit(g, files);
    expect(a.verdict).toBe("AT-RISK");
    expect(a.findings.some((f) => f.category === "injection")).toBe(true);
    expect(a.findings.some((f) => f.category === "exfil")).toBe(true);
    expect(a.posture).toBeLessThan(100);
  });

  it("a clean repo → CLEAR 100", () => {
    const g = buildCrossLayerGraph([{ path: "u.ts", content: "export function add(a,b){ return a+b; }" }]);
    const a = securityAudit(g, [{ path: "u.ts", content: "export function add(a,b){ return a+b; }" }]);
    expect(a.verdict).toBe("CLEAR");
    expect(a.posture).toBe(100);
  });

  it("never throws on garbage", () => {
    expect(() => scorePosture(null as never)).not.toThrow();
    expect(() => securityAudit(null as never, null as never)).not.toThrow();
  });
});
