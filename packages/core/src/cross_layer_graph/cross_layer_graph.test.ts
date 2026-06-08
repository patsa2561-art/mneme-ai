import { describe, it, expect } from "vitest";
import { buildCrossLayerGraph, blastRadius, resolveNode, crossLayerGauntlet, businessCoverage, toMermaid, toHtml, toRadarHtml, toRadarSvg, renderGauntlet } from "./index.js";

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

  it("multi-language: Python (def + Django ORM + FastAPI) lights up all layers", () => {
    const g = buildCrossLayerGraph([
      { path: "app.py", content: "# feature: create user\n@app.post(\"/users\")\ndef create_user(name):\n    return User.objects.create(name=name)" },
      { path: "models.py", content: "class User(models.Model):\n    name = models.CharField()" },
      { path: "PRD.md", content: "## Feature: create user" },
    ]);
    expect(g.nodes.some((n) => n.type === "function" && n.name === "create_user")).toBe(true);   // Python def
    expect(g.nodes.some((n) => n.type === "db_table" && n.name === "User")).toBe(true);           // Django model
    expect(g.edges.some((e) => e.relation === "WRITES_TO")).toBe(true);                            // User.objects.create
    expect(g.edges.some((e) => e.relation === "IMPLEMENTS")).toBe(true);                           // # feature anchor
  });
  it("multi-language: Go func + Rust fn are extracted", () => {
    const go = buildCrossLayerGraph([{ path: "m.go", content: "func ListUsers() {}" }]);
    expect(go.nodes.some((n) => n.name === "ListUsers")).toBe(true);
    const rs = buildCrossLayerGraph([{ path: "m.rs", content: "fn handle_request() {}" }]);
    expect(rs.nodes.some((n) => n.name === "handle_request")).toBe(true);
  });

  it("business layer: anchors on a real link, abstains (UNKNOWN) otherwise", () => {
    const g = buildCrossLayerGraph([
      ...FILES,
      { path: "wallet.ts", content: "// feature: wallet bonus\nexport function applyWalletBonus(){ return prisma.wallet.create({data:{}}); }" },
      { path: "PRD.md", content: "## Feature: wallet bonus\n## Feature: nobody built this one" },
    ]);
    const cov = businessCoverage(g);
    expect(cov.anchored.some((r) => r.name === "wallet bonus")).toBe(true);        // annotation + name anchor
    expect(cov.orphan.some((r) => r.name === "nobody built this one")).toBe(true); // no anchor → UNKNOWN, not "unimplemented"
  });

  it("render gauntlet is 100 + renders deterministically + XSS-safe", () => {
    expect(renderGauntlet().score).toBe(100);
    const g = buildCrossLayerGraph(FILES);
    const node = resolveNode(g, "createUserWallet")!;
    expect(toMermaid(g, node.id)).toBe(toMermaid(g, node.id));                      // deterministic
    expect(toHtml(g, node.id)).toContain("<svg");
    expect(toHtml({ nodes: [{ id: "x", type: "function", name: "<script>x</script>" }], edges: [] }, "x")).not.toContain("<script>x");
  });

  it("blast radius surfaces business rules (the 4th layer)", () => {
    const g = buildCrossLayerGraph([
      { path: "o.ts", content: "// feature: place an order\nexport function createOrder(){ return prisma.order.create({data:{}}); }" },
      { path: "s.prisma", content: "model Order { id Int @id }" },
      { path: "P.md", content: "## Feature: place an order" },
    ]);
    const br = blastRadius(g, resolveNode(g, "createOrder")!.id, { maxDepth: 3 });
    expect(br.rules.map((r) => r.name)).toContain("place an order");
    expect(br.tables.map((t) => t.name)).toContain("Order");
  });

  it("radar (overview galaxy) + static share card render + are deterministic + XSS-safe", () => {
    const g = buildCrossLayerGraph(FILES);
    const overview = toRadarHtml(g, undefined, { overview: true });
    expect(overview).toContain("function galaxy");                                 // galaxy mode present
    expect(toRadarHtml(g, undefined, { overview: true })).toBe(overview);          // deterministic
    const node = resolveNode(g, "createUserWallet")!;
    const card = toRadarSvg(g, node.id, { fingerprint: "fp" });
    expect(card).toMatch(/^<svg/);
    expect(card).toBe(toRadarSvg(g, node.id, { fingerprint: "fp" }));              // deterministic
    expect(toRadarSvg({ nodes: [{ id: "x", type: "function", name: "<script>x</script>" }], edges: [] }, "x")).not.toContain("<script>x");
  });
});
