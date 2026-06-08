/**
 * Generate the animated demo card for `mneme review` — a self-contained SMIL-animated SVG terminal
 * (plays in a GitHub README via <img>, no GIF recording) + a static PNG for social/OG.
 * The numbers are the REAL output of the suite on a small sample app (honest — a demo of the format).
 * Run: node scripts/gen-review-card.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import sharp from "sharp";
import { crossLayerGraph, riskHotspots, authzGap, testGap } from "../packages/core/dist/index.js";

// a realistic little app (auth + wallet + orders + an UNGUARDED transfer endpoint + an UNTESTED keystone)
const files = [
  { path: "prisma/schema.prisma", content: "model User { id Int @id }\nmodel Wallet { id Int @id }\nmodel Order { id Int @id }" },
  { path: "src/routes.ts", content: "router.post(\"/v1/transfer\", doTransfer);\nrouter.post(\"/v1/orders\", createOrder);\nrouter.post(\"/v1/auth/register\", registerHandler);" },
  { path: "src/auth.ts", content: "export function registerHandler(req,res){ requireAuth(req); return createUserWallet(req.uid); }\nexport function requireAuth(req){ return req.user; }\nexport function createUserWallet(uid){ return prisma.wallet.create({data:{uid}}); }" },
  { path: "src/money.ts", content: "export function doTransfer(req,res){ return prisma.wallet.update({where:{},data:{}}); }\nexport function createOrder(req,res){ requireAuth(req); return prisma.order.create({data:{}}); }" },
  { path: "src/auth.test.ts", content: "test('reg', () => registerHandler({}, {}));" },
];
const g = crossLayerGraph.buildCrossLayerGraph(files);
const byType = (t) => g.nodes.filter((n) => n.type === t).length;
const risk = riskHotspots.riskHotspots(files, { top: 4, graph: g }); const rsum = riskHotspots.riskSummary(risk);
const authz = authzGap.authzVerdict(authzGap.authzGaps(g));
const tg = testGap.analyzeTestGap(files, { graph: g });
let score = 100; score -= rsum.critical * 22; score -= rsum.high * 9; score -= authz.count * 18; score -= Math.min(24, tg.uncoveredKeystones.length * 6); score = Math.max(0, score);
const grade = score >= 90 ? "A" : score >= 78 ? "B" : score >= 62 ? "C" : score >= 45 ? "D" : "F";
const GC = { A: "#22c55e", B: "#84cc16", C: "#eab308", D: "#f97316", F: "#ef4444" };
const gc = GC[grade];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// the report lines (real values)
const lines = [
  { t: `$ npx mneme review`, c: "#22d3ee", d: 0 },
  { t: ``, c: "#e5e7eb", d: 0.6 },
  { t: `🕸  cross-layer graph   ⚙ ${byType("function")} fns · 🗄 ${byType("db_table")} tables · 🌐 ${byType("api_endpoint")} endpoints`, c: "#94a3b8", d: 0.9 },
  { t: ``, c: "", d: 1.0 },
  { t: `🎯  RISK HOTSPOTS       ${rsum.critical} critical · ${rsum.high} high`, c: "#e5e7eb", d: 1.3 },
  ...risk.slice(0, 3).map((h, i) => ({ t: `      ${h.band === "CRITICAL" ? "🔴" : h.band === "HIGH" ? "🟠" : "🟡"} ${h.name} — ${(h.factors[0] || "").slice(0, 46)}`, c: "#cbd5e1", d: 1.5 + i * 0.18 })),
  { t: ``, c: "", d: 2.1 },
  { t: `🔒  AUTHORIZATION       ${authz.clear ? "✓ clean" : "🔴 " + authz.count + " unguarded write → " + authz.worstTables.join(", ")}`, c: "#e5e7eb", d: 2.3 },
  { t: `🧪  TEST COVERAGE       keystones ${tg.coveredKeystones}/${tg.totalKeystones} guarded${tg.uncoveredKeystones.length ? " · ⚠ untested: " + tg.uncoveredKeystones[0].node.name : ""}`, c: "#e5e7eb", d: 2.5 },
  { t: ``, c: "", d: 2.6 },
  { t: `deterministic · no LLM · every finding traces to a real file`, c: "#64748b", d: 2.8 },
];
const W = 900, H = 540, dur = "0.35s", barW = Math.round((W - 240) * score / 100);
// `animated`=true → SMIL reveal (the .svg for README); false → final-state static (rasterizes to PNG)
function buildSvg(animated) {
  const op0 = animated ? ` opacity="0"` : "";
  const an = (begin, d2) => animated ? `<animate attributeName="opacity" from="0" to="1" begin="${begin}s" dur="${d2 || dur}" fill="freeze"/>` : "";
  const rows = lines.map((ln, i) => ln.t ? `<text x="34" y="${150 + i * 30}" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="15" fill="${ln.c}"${op0}>${an(ln.d)}${esc(ln.t)}</text>` : "").join("");
  const badgeScale = animated ? `<animateTransform attributeName="transform" type="scale" values="0.4;1.15;1" begin="0.3s" dur="0.5s" additive="sum" fill="freeze"/>` : "";
  const barFill = animated ? `<animate attributeName="width" from="0" to="${barW}" begin="0.5s" dur="0.9s" fill="freeze" calcMode="spline" keySplines="0.2 0.8 0.2 1" keyTimes="0;1"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system,Segoe UI,Roboto,sans-serif">
<defs><radialGradient id="bg" cx="30%" cy="0%"><stop offset="0%" stop-color="#0f1b2e"/><stop offset="75%" stop-color="#0b1220"/></radialGradient></defs>
<rect width="${W}" height="${H}" rx="14" fill="url(#bg)"/><rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="none" stroke="#1f2937"/>
<circle cx="26" cy="26" r="6" fill="#ff5f56"/><circle cx="46" cy="26" r="6" fill="#ffbd2e"/><circle cx="66" cy="26" r="6" fill="#27c93f"/>
<text x="${W / 2}" y="31" text-anchor="middle" font-size="13" fill="#64748b">mneme — Codebase Accountability Report</text>
<line x1="0" y1="52" x2="${W}" y2="52" stroke="#1f2937"/>
<g${op0}>${an("0.3", "0.4s")}
  <g transform="translate(${W - 150},78)">${badgeScale}
  <rect x="0" y="0" width="92" height="92" rx="16" fill="${gc}"/><text x="46" y="68" text-anchor="middle" font-size="58" font-weight="900" fill="#04141b">${grade}</text></g>
  <text x="${W - 158}" y="92" text-anchor="end" font-size="13" fill="#94a3b8">health</text>
  <text x="${W - 158}" y="112" text-anchor="end" font-size="22" font-weight="800" fill="${gc}">${score}/100</text></g>
<rect x="34" y="74" width="${W - 240}" height="12" rx="6" fill="#1f2937"/>
<rect x="34" y="74" width="${animated ? 0 : barW}" height="12" rx="6" fill="${gc}">${barFill}</rect>
<text x="34" y="118" font-size="13" fill="#94a3b8"${op0}>${an("0.5", "0.4s")}🔍 a graded report across every layer — in seconds, no LLM</text>
${rows}
</svg>`;
}
mkdirSync("docs/demo", { recursive: true });
writeFileSync("docs/demo/review-card.svg", buildSvg(true), "utf8");
// static PNG (final state, everything visible) for social/OG — strip color-emoji (the rasterizer has
// no emoji font; the animated .svg keeps them since browsers render emoji fine).
const pngSvg = buildSvg(false)
  .replace(/🕸|🎯|🔒|🧪|🔍|⚙|🗄|🌐/g, "›").replace(/🔴/g, "●").replace(/🟠/g, "◆").replace(/🟡/g, "○").replace(/⚠️?/g, "!").replace(/\s*·\s*$/gm, "");
await sharp(Buffer.from(pngSvg)).png().toFile("docs/demo/review-card.png");
console.log(`wrote docs/demo/review-card.svg + .png · grade ${grade} ${score}/100 · risk ${rsum.critical}C/${rsum.high}H · authz ${authz.clear ? "clean" : authz.count} · untested ${tg.uncoveredKeystones.length}`);
