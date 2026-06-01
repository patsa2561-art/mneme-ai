import { describe, it, expect } from "vitest";
import { parseDiff, analyzeDiff, buildPassport, verifyPassport, pceGauntlet } from "./index.js";

const benign = [
  "diff --git a/src/foo.ts b/src/foo.ts",
  "@@ -1,2 +1,3 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
].join("\n");

describe("v2.139 · PCE — Proof-Carrying Edit", () => {
  it("gauntlet is 100", () => {
    expect(pceGauntlet().score).toBe(100);
  });

  it("parses a unified diff into per-file added/removed", () => {
    const p = parseDiff(benign);
    expect(p.files).toHaveLength(1);
    expect(p.files[0]!.path).toBe("src/foo.ts");
    expect(p.addedCount).toBe(2);
    expect(p.removedCount).toBe(1);
  });

  it("detects an out-of-scope edit and allows an in-scope one", () => {
    const oos = ["diff --git a/secrets/keys.txt b/secrets/keys.txt", "+x"].join("\n");
    expect(analyzeDiff(oos, { declaredScope: ["src/**"] }).inScope).toBe(false);
    expect(analyzeDiff(benign, { declaredScope: ["src/**"] }).inScope).toBe(true);
  });

  it("BLOCKs an added secret and a forbidden primitive", () => {
    const sec = ["diff --git a/src/x.ts b/src/x.ts", "+const k = 'AKIAABCDEFGHIJKLMNOP';"].join("\n");
    expect(buildPassport(sec).verdict).toBe("BLOCK");
    const net = ["diff --git a/src/x.ts b/src/x.ts", "+await fetch('http://x');"].join("\n");
    expect(buildPassport(net, { forbidPrimitives: ["network"] }).verdict).toBe("BLOCK");
  });

  it("verify accepts a genuine pair, catches a tampered diff AND a forged cert", () => {
    const pass = buildPassport(benign, { declaredScope: ["src/**"] });
    expect(verifyPassport(benign, pass, { declaredScope: ["src/**"] }).ok).toBe(true);
    const tampered = benign.replace("const c = 4;", "rmSync('/');");
    expect(verifyPassport(tampered, pass, { declaredScope: ["src/**"] }).ok).toBe(false);
    const forged = { ...pass, verdict: "BLOCK" as const };
    expect(verifyPassport(benign, forged, { declaredScope: ["src/**"] }).ok).toBe(false);
  });

  it("is total on hostile input", () => {
    expect(() => parseDiff(null as never)).not.toThrow();
    expect(() => analyzeDiff(undefined as never, { declaredScope: null as never })).not.toThrow();
    expect(() => buildPassport(123 as never)).not.toThrow();
    expect(() => verifyPassport("x", null as never)).not.toThrow();
  });
});
