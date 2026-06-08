/**
 * Regenerate the README's live Impact-Radar demo from a small, realistic SAMPLE project that
 * exercises all four layers (business ↔ api ↔ code ↔ data). The output is a self-contained HTML
 * file (no network, no deps) committed at docs/demo/impact-radar.html and rendered from the README
 * via htmlpreview.github.io. Run: node scripts/gen-radar-demo.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { crossLayerGraph } from "../packages/core/dist/index.js";

// A tiny but real example app: auth + wallet + orders. PRD features annotate the code so the
// business→code IMPLEMENTS links anchor deterministically (no LLM, no guessing).
const files = [
  { path: "prisma/schema.prisma", content: `model User { id Int @id\n email String }\nmodel Wallet { id Int @id\n uid Int\n balance Int }\nmodel Order { id Int @id\n uid Int\n total Int }\nmodel Product { id Int @id\n price Int }` },
  { path: "src/routes.ts", content: `router.post("/v1/auth/register", registerHandler);\nrouter.post("/v1/orders", createOrderHandler);\nrouter.get("/v1/wallet", getWalletHandler);\nrouter.get("/v1/products", listProducts);` },
  { path: "src/auth.ts", content: `// feature: new user wallet bonus\nexport function registerHandler(req, res) {\n  const u = prisma.user.create({ data: { email: req.body.email } });\n  createUserWallet(u.id);\n  return res.json(u);\n}\nexport function createUserWallet(uid) {\n  return prisma.wallet.create({ data: { uid, balance: 100 } });\n}` },
  { path: "src/orders.ts", content: `// feature: place an order\nexport function createOrderHandler(req, res) {\n  const o = prisma.order.create({ data: { uid: req.user.id, total: req.body.total } });\n  chargeWallet(req.user.id, o.total);\n  return res.json(o);\n}\nexport function chargeWallet(uid, amount) {\n  return prisma.wallet.update({ where: { uid }, data: { balance: { decrement: amount } } });\n}\nexport function getWalletHandler(req, res) {\n  return res.json(prisma.wallet.findUnique({ where: { uid: req.user.id } }));\n}\nexport function listProducts(req, res) {\n  return res.json(prisma.product.findMany());\n}` },
  { path: "docs/PRD.md", content: `## Feature: new user wallet bonus\nEvery new user gets a wallet seeded with 100.\n\n## Feature: place an order\nA user can place an order, which charges their wallet.` },
];

const g = crossLayerGraph.buildCrossLayerGraph(files);
const fp = createHash("sha256").update(JSON.stringify(g.nodes.map((n) => n.id).sort()) + JSON.stringify(g.edges.map((e) => `${e.source}|${e.target}|${e.relation}`).sort())).digest("hex").slice(0, 16);
// Open in OVERVIEW (galaxy) so the viewer sees the whole 4-layer sample app, then clicks any node
// to fly into its blast radar.
const html = crossLayerGraph.toRadarHtml(g, undefined, { fingerprint: fp, title: "Impact Radar — sample app", overview: true });
const focus = { name: "overview" };
mkdirSync("docs/demo", { recursive: true });
writeFileSync("docs/demo/impact-radar.html", html, "utf8");
// A static PNG card (focused on createOrderHandler) — the README preview image + a shareable card.
const cardFocus = crossLayerGraph.resolveNode(g, "createOrderHandler");
const svg = crossLayerGraph.toRadarSvg(g, cardFocus?.id, { fingerprint: fp, maxDepth: 4 });
await sharp(Buffer.from(svg)).png().toFile("docs/demo/impact-radar.png");
console.log("wrote docs/demo/impact-radar.png (PNG card)");

const byType = (t) => g.nodes.filter((n) => n.type === t).length;
const byRel = (r) => g.edges.filter((e) => e.relation === r).length;
console.log(`wrote docs/demo/impact-radar.html (${(html.length / 1024).toFixed(0)} KB) · focus=${focus?.name}`);
console.log(`layers: business ${byType("business_rule")} · api ${byType("api_endpoint")} · code ${byType("function")} · data ${byType("db_table")}`);
console.log(`edges: IMPLEMENTS ${byRel("IMPLEMENTS")} · HANDLED_BY ${byRel("HANDLED_BY")} · WRITES_TO ${byRel("WRITES_TO")} · READS ${byRel("READS")} · CALLS ${byRel("CALLS")}`);
