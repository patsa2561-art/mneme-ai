import { describe, it, expect } from "vitest";
import { buildCrossLayerGraph, blastRadius, resolveNode, crossLayerGauntlet } from "./index.js";

const FILES = [
  { path: "schema.prisma", content: "model User {\n id Int @id\n}\nmodel Wallet {\n id Int @id\n}" },
  { path: "auth.ts", content: "export async function registerHandler(req, res) {\n  await prisma.user.create({ data: {} });\n  await createUserWallet(req.body.id);\n}\nexport function createUserWallet(uid) {\n  return prisma.wallet.create({ data: { uid } });\n}" },
  { path: "routes.ts", content: "router.post(\"/v1/auth/register\", registerHandler);" },
];

describe("cross_layer_graph", () => {
  it("gauntlet is 100", () => expect(crossLayerGauntlet().score).toBe(100));

  it("extracts all three layers deterministically", () => {
    const g = buildCrossLayerGraph(FILES);
    expect(g.nodes.filter((n) => n.type === "db_table").map((n) => n.name).sort()).toEqual(["User", "Wallet"]);
    expect(g.nodes.some((n) => n.type === "api_endpoint" && n.name === "/v1/auth/register")).toBe(true);
    expect(g.nodes.some((n) => n.type === "function" && n.name === "createUserWallet")).toBe(true);
  });

  it("computes a CROSS-LAYER blast radius (table + endpoint)", () => {
    const g = buildCrossLayerGraph(FILES);
    const node = resolveNode(g, "createUserWallet")!;
    const br = blastRadius(g, node.id);
    expect(br.tables.map((t) => t.name)).toContain("Wallet");
    expect(br.endpoints.map((e) => e.name)).toContain("/v1/auth/register");  // via caller registerHandler
  });

  it("invents no edges — every endpoint is a real node", () => {
    const g = buildCrossLayerGraph(FILES);
    for (const e of g.edges) {
      expect(g.nodes.some((n) => n.id === e.source)).toBe(true);
      expect(g.nodes.some((n) => n.id === e.target)).toBe(true);
    }
  });

  it("never throws on garbage", () => {
    expect(() => buildCrossLayerGraph(null as never)).not.toThrow();
    expect(() => blastRadius(null as never, "x")).not.toThrow();
  });
});
