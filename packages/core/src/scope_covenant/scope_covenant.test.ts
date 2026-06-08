import { describe, it, expect } from "vitest";
import { buildCrossLayerGraph } from "../cross_layer_graph/index.js";
import { verifyScope, recordScope, scopeFidelity, rankFidelity, scopeGauntlet } from "./index.js";

const g = buildCrossLayerGraph([
  { path: "schema.prisma", content: "model Wallet { id Int @id }\nmodel Payment { id Int @id }" },
  { path: "auth.ts", content: "export function createUserWallet(uid){ return prisma.wallet.create({data:{uid}}); }" },
  { path: "billing.ts", content: "export function charge(uid){ return prisma.payment.create({data:{uid}}); }" },
]);

describe("scope_covenant", () => {
  it("gauntlet is 100", () => expect(scopeGauntlet().score).toBe(100));

  it("HONORED when the edit stays within declared files + tables", () => {
    const diff = "--- a/auth.ts\n+++ b/auth.ts\n@@ -1,1 +1,2 @@ export function createUserWallet(uid){\n+ log(uid);\n";
    const v = verifyScope(g, diff, { agent: "a", intent: "tweak wallet creation", allow: { files: ["auth.ts"], tables: ["Wallet"] } });
    expect(v.verdict).toBe("HONORED");
    expect(v.honored).toBe(true);
  });

  it("BREACHED when the edit reaches an unpromised file + table — naming both", () => {
    const diff = "--- a/auth.ts\n+++ b/auth.ts\n@@ -1,1 +1,2 @@ export function createUserWallet(uid){\n+x\n--- a/billing.ts\n+++ b/billing.ts\n@@ -1,1 +1,2 @@ export function charge(uid){\n+x\n";
    const v = verifyScope(g, diff, { agent: "a", intent: "tweak wallet creation", allow: { files: ["auth.ts"], tables: ["Wallet"] } });
    expect(v.verdict).toBe("BREACHED");
    expect(v.breachFiles).toContain("billing.ts");
    expect(v.breachTables).toContain("Payment");
  });

  it("intent-mentioned tables are not breaches (no allow-list needed)", () => {
    const diff = "--- a/billing.ts\n+++ b/billing.ts\n@@ -1,1 +1,2 @@ export function charge(uid){\n+x\n";
    const v = verifyScope(g, diff, { agent: "a", intent: "update the payment charging flow", allow: { files: ["billing.ts"] } });
    expect(v.breachTables).not.toContain("Payment");     // "payment" is in the intent
  });

  it("scope-fidelity is a Wilson lower bound; thin data → UNPROVEN", () => {
    let led: ReturnType<typeof recordScope> = [];
    for (let i = 0; i < 20; i++) led = recordScope(led, "good", i < 19, i);
    led = recordScope(led, "new", true, 0);
    expect(["EXEMPLARY", "RELIABLE"]).toContain(scopeFidelity(led, "good").band);
    expect(scopeFidelity(led, "good").rateLB).toBeLessThan(1);
    expect(scopeFidelity(led, "new").band).toBe("UNPROVEN");
    expect(rankFidelity(led)[0].agent).toBe("good");
  });

  it("never throws on garbage", () => {
    expect(() => verifyScope(null as never, "x", null as never)).not.toThrow();
    expect(() => scopeFidelity(null as never, "x")).not.toThrow();
  });
});
