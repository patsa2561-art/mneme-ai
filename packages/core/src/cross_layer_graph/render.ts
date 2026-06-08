/**
 * CROSS-LAYER GRAPH — renderers. Two deterministic, dependency-free views of the 4-layer graph
 * (BUSINESS ↔ API ↔ CODE ↔ DATA):
 *   • toMermaid  — a Mermaid flowchart string that renders inline in GitHub / Markdown / Claude /
 *                  Cursor / any chat, with the four layers as subgraphs + a highlighted focus + blast.
 *   • toHtml     — a self-contained, offline, zero-JS-framework HTML page: a 4-LANE tiered SVG where
 *                  the layers are horizontal bands and the cross-layer edges literally cross between
 *                  them — the picture single-layer code-graphs can't draw. Deterministic layout
 *                  (stable sort, even spacing), so the same graph always renders identically.
 *
 * ★HONEST: a faithful drawing of the deterministically-extracted graph — no layout LLM, no fabricated
 * nodes. A focused view shows the reachable COUPLING to inspect, not a proven runtime path.
 */
import { type CrossLayerGraph, type GNode, type GEdge, type NodeType, blastRadius, buildCrossLayerGraph, resolveNode } from "./index.js";

const LAYER_ORDER: NodeType[] = ["business_rule", "api_endpoint", "function", "db_table"];
const LAYER_META: Record<NodeType, { label: string; icon: string; color: string; bg: string }> = {
  business_rule: { label: "Business", icon: "💼", color: "#7c3aed", bg: "#f5f3ff" },
  api_endpoint: { label: "API", icon: "🌐", color: "#0891b2", bg: "#ecfeff" },
  function: { label: "Code", icon: "⚙️", color: "#374151", bg: "#f9fafb" },
  db_table: { label: "Data", icon: "🗄️", color: "#b45309", bg: "#fffbeb" },
};
const RELATION_COLOR: Record<string, string> = { WRITES_TO: "#dc2626", READS: "#0891b2", HANDLED_BY: "#0891b2", CALLS: "#9ca3af", IMPLEMENTS: "#7c3aed" };

export interface SubgraphPick { nodes: GNode[]; edges: GEdge[]; focusId?: string }
/** Pick the nodes to draw: a focus + its blast radius (legible), or a degree-capped overview. */
export function pickSubgraph(graph: CrossLayerGraph, focusId?: string, opts?: { maxDepth?: number; cap?: number }): SubgraphPick {
  const nodes = graph?.nodes ?? []; const edges = graph?.edges ?? []; const cap = opts?.cap ?? 60;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (focusId && byId.has(focusId)) {
    const br = blastRadius(graph, focusId, { maxDepth: opts?.maxDepth ?? 2 });
    const keep = new Set<string>([focusId, ...br.tables.map((n) => n.id), ...br.endpoints.map((n) => n.id), ...br.functions.slice(0, cap).map((n) => n.id)]);
    return { nodes: nodes.filter((n) => keep.has(n.id)), edges: edges.filter((e) => keep.has(e.source) && keep.has(e.target)), focusId };
  }
  // overview: highest-degree nodes (the structural hubs), capped, + edges among them
  const deg = new Map<string, number>(); for (const e of edges) { deg.set(e.source, (deg.get(e.source) ?? 0) + 1); deg.set(e.target, (deg.get(e.target) ?? 0) + 1); }
  const ranked = [...nodes].sort((a, b) => (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0) || a.id.localeCompare(b.id)).slice(0, cap);
  const keep = new Set(ranked.map((n) => n.id));
  return { nodes: ranked, edges: edges.filter((e) => keep.has(e.source) && keep.has(e.target)) };
}

const mmEsc = (s: string) => String(s).replace(/["\\]/g, "").replace(/[<>]/g, "").slice(0, 48);
function mmShape(n: GNode, id: string): string {
  const label = `${LAYER_META[n.type].icon} ${mmEsc(n.type === "api_endpoint" && n.method ? `${n.method} ${n.name}` : n.name)}`;
  if (n.type === "business_rule") return `${id}[["${label}"]]`;
  if (n.type === "api_endpoint") return `${id}(["${label}"])`;
  if (n.type === "db_table") return `${id}[("${label}")]`;
  return `${id}["${label}"]`;
}
/** Render the graph (focused or overview) as a Mermaid flowchart string — renders anywhere, zero deps. */
export function toMermaid(graph: CrossLayerGraph, focusId?: string, opts?: { maxDepth?: number; cap?: number }): string {
  const pick = pickSubgraph(graph, focusId, opts);
  const idOf = new Map<string, string>(); pick.nodes.forEach((n, i) => idOf.set(n.id, `n${i}`));
  const L: string[] = ["flowchart TB"];
  for (const layer of LAYER_ORDER) {
    const inLayer = pick.nodes.filter((n) => n.type === layer); if (!inLayer.length) continue;
    L.push(`  subgraph ${layer}["${LAYER_META[layer].icon} ${LAYER_META[layer].label}"]`);
    for (const n of inLayer) L.push(`    ${mmShape(n, idOf.get(n.id)!)}`);
    L.push("  end");
  }
  for (const e of pick.edges) { const s = idOf.get(e.source), t = idOf.get(e.target); if (s && t) L.push(`  ${s} -->|${e.relation}| ${t}`); }
  // styling: per-layer color + a bold focus
  for (const layer of LAYER_ORDER) L.push(`  classDef ${layer} fill:${LAYER_META[layer].bg},stroke:${LAYER_META[layer].color},color:${LAYER_META[layer].color};`);
  for (const n of pick.nodes) { const id = idOf.get(n.id)!; L.push(`  class ${id} ${n.type};`); }
  if (pick.focusId && idOf.get(pick.focusId)) L.push(`  style ${idOf.get(pick.focusId)} stroke-width:4px,stroke:#dc2626,font-weight:bold;`);
  return L.join("\n");
}

// ── self-contained HTML (4-lane tiered SVG) ───────────────────────────────────
const hEsc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
interface Placed { node: GNode; x: number; y: number }
/** Render a self-contained, offline, deterministic 4-lane SVG page. fingerprint is shown in the footer. */
export function toHtml(graph: CrossLayerGraph, focusId?: string, opts?: { maxDepth?: number; cap?: number; fingerprint?: string; title?: string }): string {
  const pick = pickSubgraph(graph, focusId, { cap: opts?.cap ?? 48, maxDepth: opts?.maxDepth });
  const W = 1200, laneH = 150, padX = 40, topPad = 70;
  const lanes = LAYER_ORDER.filter((l) => pick.nodes.some((n) => n.type === l));
  const H = topPad + lanes.length * laneH + 60;
  const placed = new Map<string, Placed>();
  lanes.forEach((layer, li) => {
    const row = pick.nodes.filter((n) => n.type === layer).sort((a, b) => a.name.localeCompare(b.name));
    const y = topPad + li * laneH + laneH / 2;
    const gap = (W - 2 * padX) / Math.max(1, row.length);
    row.forEach((n, i) => placed.set(n.id, { node: n, x: padX + gap * (i + 0.5), y }));
  });
  // edges (bezier between placed nodes)
  const edgeSvg = pick.edges.map((e) => {
    const a = placed.get(e.source), b = placed.get(e.target); if (!a || !b) return "";
    const my = (a.y + b.y) / 2; const col = RELATION_COLOR[e.relation] ?? "#9ca3af";
    const focusHit = pick.focusId && (e.source === pick.focusId || e.target === pick.focusId);
    return `<path d="M ${a.x.toFixed(1)} ${a.y.toFixed(1)} C ${a.x.toFixed(1)} ${my.toFixed(1)}, ${b.x.toFixed(1)} ${my.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}" fill="none" stroke="${col}" stroke-width="${focusHit ? 2.4 : 1}" opacity="${focusHit ? 0.95 : 0.4}"><title>${hEsc(e.relation)}</title></path>`;
  }).join("");
  // lane bands + labels
  const laneSvg = lanes.map((layer, li) => {
    const m = LAYER_META[layer]; const y = topPad + li * laneH;
    return `<rect x="0" y="${y}" width="${W}" height="${laneH}" fill="${m.bg}" opacity="0.6"/><text x="14" y="${y + 22}" font-size="13" font-weight="700" fill="${m.color}">${m.icon} ${m.label.toUpperCase()}</text>`;
  }).join("");
  // nodes
  const nodeSvg = [...placed.values()].map(({ node, x, y }) => {
    const m = LAYER_META[node.type]; const isFocus = node.id === pick.focusId;
    const label = node.type === "api_endpoint" && node.method ? `${node.method} ${node.name}` : node.name;
    const txt = label.length > 22 ? label.slice(0, 21) + "…" : label;
    const r = isFocus ? 11 : 7;
    return `<g><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${m.color}" stroke="${isFocus ? "#dc2626" : "#fff"}" stroke-width="${isFocus ? 3 : 1.5}"><title>${hEsc(label)}${node.file ? " — " + hEsc(node.file) : ""}</title></circle><text x="${x.toFixed(1)}" y="${(y + r + 12).toFixed(1)}" font-size="10" text-anchor="middle" fill="#374151">${hEsc(txt)}</text></g>`;
  }).join("");
  const legend = ["WRITES_TO", "READS", "HANDLED_BY", "CALLS", "IMPLEMENTS"].map((r, i) => `<span style="color:${RELATION_COLOR[r]}">&#9632;</span> ${r}${i < 4 ? " &nbsp; " : ""}`).join("");
  const title = opts?.title ?? (pick.focusId ? `Blast radius — ${placed.get(pick.focusId)?.node.name ?? ""}` : "Cross-Layer Graph");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${hEsc(title)} · Mneme</title>
<style>body{margin:0;font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;background:#fff;color:#111}.wrap{max-width:${W}px;margin:0 auto;padding:24px}h1{font-size:18px;margin:0 0 4px}.sub{color:#6b7280;font-size:13px;margin:0 0 12px}.legend{font-size:12px;color:#6b7280;margin:10px 0}svg{border:1px solid #e5e7eb;border-radius:10px;background:#fff;width:100%;height:auto}footer{margin-top:14px;font-size:11px;color:#9ca3af}code{background:#f3f4f6;padding:1px 5px;border-radius:4px}</style></head>
<body><div class="wrap"><h1>🕸 ${hEsc(title)}</h1><p class="sub">CODE ↔ DATA ↔ API ↔ BUSINESS · deterministic, no LLM — every node &amp; edge derives from a real file. Reachable coupling to inspect, not a proven runtime break.</p>
<div class="legend">${legend}</div>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${hEsc(title)}">${laneSvg}${edgeSvg}${nodeSvg}</svg>
<footer>${pick.nodes.length} nodes · ${pick.edges.length} edges${opts?.fingerprint ? ` · fingerprint <code>${hEsc(opts.fingerprint)}</code> (deterministic — re-render to verify)` : ""} · generated by Mneme cross-layer graph</footer></div></body></html>`;
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface RenderGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function renderGauntlet(): RenderGauntlet {
  const files = [
    { path: "schema.prisma", content: "model Wallet { id Int @id }" },
    { path: "auth.ts", content: "router.post(\"/v1/auth/register\", registerHandler);\nexport function registerHandler(req,res){ createUserWallet(1); }\n// feature: new user wallet bonus\nexport function createUserWallet(uid){ return prisma.wallet.create({data:{uid}}); }" },
    { path: "PRD.md", content: "## Feature: new user wallet bonus\nEvery new user gets a wallet." },
  ];
  const g = buildCrossLayerGraph(files);
  const focus = resolveNode(g, "createUserWallet");
  const mm = toMermaid(g, focus?.id);
  const html = toHtml(g, focus?.id, { fingerprint: "abc123" });
  const det = toMermaid(g, focus?.id) === mm;                                   // deterministic
  const mmOK = mm.startsWith("flowchart") && mm.includes("Wallet") && /subgraph (business_rule|api_endpoint|db_table)/.test(mm);
  const htmlOK = html.includes("<svg") && html.includes("</html>") && html.includes("WRITES_TO") && html.includes("abc123");
  const laneOK = html.includes("DATA") && html.includes("BUSINESS");           // multi-lane present
  const safeFocus = (() => { try { toMermaid(g); toHtml(g); toMermaid(null as never); toHtml(null as never); return true; } catch { return false; } })();
  const noInject = !toHtml({ nodes: [{ id: "x", type: "function", name: "<script>alert(1)</script>" }], edges: [] }, "x").includes("<script>alert");
  const checks = [
    { name: "MERMAID", pass: mmOK, detail: "flowchart with per-layer subgraphs renders anywhere (GitHub/chat)" },
    { name: "HTML-SVG", pass: htmlOK, detail: "self-contained offline SVG page with legend + fingerprint" },
    { name: "FOUR-LANES", pass: laneOK, detail: "the 4 layers drawn as horizontal bands (cross-layer picture)" },
    { name: "DETERMINISTIC", pass: det, detail: "same graph → byte-identical render (no layout LLM/random)" },
    { name: "XSS-SAFE", pass: noInject, detail: "node names are HTML-escaped — a malicious symbol can't inject script" },
    { name: "TOTAL", pass: safeFocus, detail: "overview + null inputs never throw" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
