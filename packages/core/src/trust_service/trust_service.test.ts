import { describe, it, expect } from "vitest";
import { routeTrust, trustServiceGauntlet, TRUST_ENDPOINTS } from "./index.js";
import type { SourceFile } from "../cross_layer_graph/index.js";

const base: SourceFile[] = [{ path: "schema.prisma", content: "model Wallet { id Int @id }" }, { path: "a.ts", content: "export function charge(){ return prisma.wallet.create({data:{}}); }" }];
const broke: SourceFile[] = [...base, { path: "b.ts", content: "export function drain(){ return prisma.wallet.update({where:{}}); }" }];

describe("trust_service", () => {
  it("gauntlet is 100", () => expect(trustServiceGauntlet().score).toBe(100));

  it("GET /health lists the endpoints", () => {
    const r = routeTrust({ method: "GET", path: "/health", body: {} });
    expect(r.status).toBe(200);
    expect((r.json.endpoints as unknown[]).length).toBe(TRUST_ENDPOINTS.length);
  });

  it("POST /scar/check fires on a non-idempotent retry", () => {
    const r = routeTrust({ method: "POST", path: "/scar/check", body: { files: ["payments/retry.ts"], code: "async function chargeWithRetry(req){ for(let i=0;i<3;i++){ await charge(req); } }" } });
    expect(r.json.fires).toBe(true);
  });

  it("POST /change-gate fuses scar + firewall into one verdict", () => {
    const r = routeTrust({ method: "POST", path: "/change-gate", body: { baselineFiles: base, currentFiles: broke, policy: "critical table wallet single-writer", files: ["payments/retry.ts"], code: "for(let i=0;i<3;i++){ await charge(req); }" } });
    expect(r.json.verdict).toBe("BLOCK");
    expect((r.json.reasons as string[]).length).toBeGreaterThan(0);
  });

  it("POST /agent-rep scores reputation", () => {
    const r = routeTrust({ method: "POST", path: "/agent-rep", body: { records: Array.from({ length: 25 }, () => ({ agent: "good", outcome: "survived" })) } });
    expect((r.json.agents as Array<{ band: string }>)[0].band).toBe("TRUSTED");
  });

  it("unknown path → 404, wrong method → 405", () => {
    expect(routeTrust({ method: "POST", path: "/nope", body: {} }).status).toBe(404);
    expect(routeTrust({ method: "GET", path: "/scar/check", body: {} }).status).toBe(405);
  });

  it("never throws on garbage", () => {
    expect(() => routeTrust(null as never)).not.toThrow();
    expect(routeTrust({ method: "POST", path: "/change-gate", body: {} }).status).toBe(200);
  });
});
