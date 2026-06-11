import { describe, it, expect } from "vitest";
import { buildCrossLayerGraph } from "../cross_layer_graph/index.js";
import { exfilPaths, exfilVerdict, exfilPathGauntlet } from "./index.js";

const g = buildCrossLayerGraph([
  { path: "schema.prisma", content: "model Credentials { id Int @id }\nmodel Article { id Int @id }" },
  { path: "api.ts", content:
    "router.get(\"/me\", getMe);\n" +
    "export function getMe(){ return prisma.credentials.findMany(); }\n" +
    "router.get(\"/safe\", getSafe);\n" +
    "export function getSafe(){ const r = prisma.credentials.findMany(); return toSafeUser(r); }\n" +
    "export function toSafeUser(x){ return x; }\n" +
    "router.get(\"/public\", getPublic);\n" +
    "export function getPublic(){ return prisma.article.findMany(); }\n" },
]);

describe("exfil_path", () => {
  it("gauntlet is 100", () => expect(exfilPathGauntlet().score).toBe(100));

  it("flags an endpoint that reads a sensitive table with no redaction", () => {
    const p = exfilPaths(g);
    expect(p.some((x) => x.endpoint === "/me" && x.sensitiveTables.some((t) => /credentials/i.test(t)))).toBe(true);
  });

  it("clears a path with a redaction/projection function", () => {
    expect(exfilPaths(g).some((x) => x.endpoint === "/safe")).toBe(false);
  });

  it("does not flag a non-sensitive read", () => {
    expect(exfilPaths(g).some((x) => x.endpoint === "/public")).toBe(false);
  });

  it("verdict reflects presence", () => {
    expect(exfilVerdict(exfilPaths(g)).clear).toBe(false);
    expect(exfilVerdict([]).clear).toBe(true);
  });

  it("never throws on garbage", () => {
    expect(() => exfilPaths(null as never)).not.toThrow();
    expect(exfilPaths(null as never).length).toBe(0);
  });
});
