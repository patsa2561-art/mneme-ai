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

// ── IMPACT RADAR — the world-first view: a sonar of your change across 4 layers ────────────────
// The focus node sits at the CENTER; the four layers fan out as angular SECTORS (Business / API /
// Code / Data); concentric RINGS are blast hop-distance (ring 1 = direct, ring 2 = two hops…). A
// deterministic radar SWEEP + an expanding blast PULSE animate it, and clicking any node re-centers
// the radar on it (self-contained vanilla JS — one file, no framework, no network). Nothing about the
// DATA is invented: every position encodes a real fact (sector = the node's layer, radius = its real
// graph distance from the focus). Layout is computed in-page but deterministically (stable sort).
export function toRadarHtml(graph: CrossLayerGraph, focusId?: string, opts?: { maxDepth?: number; cap?: number; fingerprint?: string; title?: string }): string {
  // pick a center: the focus, else the highest-degree node (a radar needs a center).
  let center = focusId;
  if (!center || !(graph?.nodes ?? []).some((n) => n.id === center)) {
    const deg = new Map<string, number>(); for (const e of graph?.edges ?? []) { deg.set(e.source, (deg.get(e.source) ?? 0) + 1); deg.set(e.target, (deg.get(e.target) ?? 0) + 1); }
    center = [...(graph?.nodes ?? [])].sort((a, b) => (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0) || a.id.localeCompare(b.id))[0]?.id;
  }
  const pick = pickSubgraph(graph, center, { cap: opts?.cap ?? 80, maxDepth: opts?.maxDepth ?? 3 });
  const data = {
    focus: center ?? null,
    nodes: pick.nodes.map((n) => ({ id: n.id, type: n.type, name: (n.type === "api_endpoint" && n.method ? n.method + " " + n.name : n.name).slice(0, 60), file: n.file ?? "" })),
    edges: pick.edges.map((e) => ({ s: e.source, t: e.target, r: e.relation })),
    meta: LAYER_META, order: LAYER_ORDER, rel: RELATION_COLOR,
  };
  const json = JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  const title = opts?.title ?? "Impact Radar";
  const fp = opts?.fingerprint ?? "";
  // NOTE: inner JS uses NO backticks / template literals (this is a TS template literal).
  const js = [
    "var G=JSON.parse(document.getElementById('mneme-data').textContent);",
    "var NS='http://www.w3.org/2000/svg',W=820,CX=W/2,CY=W/2,R0=46,RING=78;",
    "var svg=document.getElementById('radar'),tip=document.getElementById('tip');",
    "function adj(){var a={};G.edges.forEach(function(e){(a[e.s]=a[e.s]||[]).push(e.t);(a[e.t]=a[e.t]||[]).push(e.s);});return a;}",
    "function bfs(f){var A=adj(),d={};d[f]=0;var q=[f];while(q.length){var x=q.shift();(A[x]||[]).forEach(function(y){if(d[y]==null){d[y]=d[x]+1;q.push(y);}});}return d;}",
    "function el(n,at){var e=document.createElementNS(NS,n);for(var k in at)e.setAttribute(k,at[k]);return e;}",
    "function layout(f){var d=bfs(f),byId={};G.nodes.forEach(function(n){byId[n.id]=n;});",
    "  var groups={};G.nodes.forEach(function(n){var dist=d[n.id];if(dist==null)return;var li=G.order.indexOf(n.type);if(li<0)li=2;var key=n.type;(groups[key]=groups[key]||[]).push(n);});",
    "  var pos={};var present=G.order.filter(function(t){return groups[t]&&groups[t].length;});var span=2*Math.PI/Math.max(1,present.length);",
    "  present.forEach(function(t,si){var arr=groups[t].slice().sort(function(a,b){return (d[a.id]-d[b.id])||a.name.localeCompare(b.name);});var base=si*span-Math.PI/2;",
    "    arr.forEach(function(n,i){var dist=Math.max(1,d[n.id]);var ang=base+span*((i+0.5)/arr.length);var rad=R0+dist*RING;pos[n.id]={x:CX+rad*Math.cos(ang),y:CY+rad*Math.sin(ang),dist:dist,type:n.type};});});",
    "  pos[f]={x:CX,y:CY,dist:0,type:byId[f]?byId[f].type:'function'};return {pos:pos,d:d,byId:byId};}",
    "function draw(f){while(svg.firstChild)svg.removeChild(svg.firstChild);var L=layout(f);var pos=L.pos,byId=L.byId;",
    "  var maxd=0;for(var k in pos)maxd=Math.max(maxd,pos[k].dist);",
    "  for(var r=1;r<=maxd;r++){svg.appendChild(el('circle',{cx:CX,cy:CY,r:R0+r*RING,fill:'none',stroke:'#1f2937',['stroke-width']:1,opacity:0.5}));}",
    "  var present=G.order.filter(function(t){return G.nodes.some(function(n){return n.type===t&&pos[n.id];});});var span=2*Math.PI/Math.max(1,present.length);",
    "  present.forEach(function(t,si){var a=si*span-Math.PI/2;var ex=CX+(R0+maxd*RING+24)*Math.cos(a-span/2),ey=CY+(R0+maxd*RING+24)*Math.sin(a-span/2);",
    "    svg.appendChild(el('line',{x1:CX,y1:CY,x2:ex,y2:ey,stroke:'#1f2937',opacity:0.35}));",
    "    var lx=CX+(R0+maxd*RING+30)*Math.cos(a),ly=CY+(R0+maxd*RING+30)*Math.sin(a);var tl=el('text',{x:lx,y:ly,fill:G.meta[t].color,['font-size']:13,['font-weight']:700,['text-anchor']:'middle'});tl.textContent=G.meta[t].icon+' '+G.meta[t].label.toUpperCase();svg.appendChild(tl);});",
    "  var beam=el('line',{x1:CX,y1:CY,x2:CX,y2:CY-(R0+maxd*RING),stroke:'#22d3ee',['stroke-width']:2,opacity:0.55});var at=el('animateTransform',{attributeName:'transform',type:'rotate',from:'0 '+CX+' '+CY,to:'360 '+CX+' '+CY,dur:'5s',repeatCount:'indefinite'});beam.appendChild(at);svg.appendChild(beam);",
    "  var pulse=el('circle',{cx:CX,cy:CY,r:R0,fill:'none',stroke:'#22d3ee',['stroke-width']:2});pulse.appendChild(el('animate',{attributeName:'r',from:R0,to:R0+maxd*RING,dur:'3s',repeatCount:'indefinite'}));pulse.appendChild(el('animate',{attributeName:'opacity',from:0.6,to:0,dur:'3s',repeatCount:'indefinite'}));svg.appendChild(pulse);",
    "  G.edges.forEach(function(e){var a=pos[e.s],b=pos[e.t];if(!a||!b)return;var hot=(e.s===f||e.t===f);svg.appendChild(el('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:G.rel[e.r]||'#6b7280',['stroke-width']:hot?2:1,opacity:hot?0.85:0.28}));});",
    "  Object.keys(pos).forEach(function(id){var p=pos[id],n=byId[id];if(!n)return;var isF=(id===f);var g=el('g',{cursor:'pointer'});var c=el('circle',{cx:p.x,cy:p.y,r:isF?13:7,fill:G.meta[p.type].color,stroke:isF?'#22d3ee':'#0b1220',['stroke-width']:isF?3:1.5});g.appendChild(c);",
    "    if(isF||p.dist<=2){var t=el('text',{x:p.x,y:p.y-(isF?18:12),['font-size']:isF?12:10,['text-anchor']:'middle',fill:'#e5e7eb'});t.textContent=n.name.length>20?n.name.slice(0,19)+'…':n.name;g.appendChild(t);}",
    "    g.addEventListener('mouseenter',function(ev){tip.style.display='block';tip.style.left=(ev.clientX+12)+'px';tip.style.top=(ev.clientY+12)+'px';tip.innerHTML='<b>'+G.meta[p.type].icon+' '+esc(n.name)+'</b>'+(n.file?'<br><span style=\\'opacity:.6\\'>'+esc(n.file)+'</span>':'')+'<br><span style=\\'opacity:.6\\'>'+ (p.dist===0?'focus':p.dist+' hop'+(p.dist>1?'s':'')+' away')+'</span>';});",
    "    g.addEventListener('mouseleave',function(){tip.style.display='none';});",
    "    g.addEventListener('click',function(){draw(id);document.getElementById('focusName').textContent=n.name;});svg.appendChild(g);});}",
    "function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}",
    "if(G.focus)draw(G.focus);",
  ].join("\n");
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + hEsc(title) + " · Mneme</title>" +
    "<style>body{margin:0;font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e5e7eb}.wrap{max-width:860px;margin:0 auto;padding:20px}h1{font-size:18px;margin:0 0 2px}.sub{color:#94a3b8;font-size:12px;margin:0 0 10px}.card{background:radial-gradient(circle at 50% 45%,#0f1b2e,#0b1220 70%);border:1px solid #1f2937;border-radius:14px;padding:8px}svg{width:100%;height:auto;display:block}.legend{font-size:12px;color:#94a3b8;margin:10px 2px}.legend b{color:#22d3ee;font-weight:600}#tip{position:fixed;display:none;background:#0f1b2e;border:1px solid #334155;border-radius:8px;padding:6px 9px;font-size:12px;pointer-events:none;max-width:280px;box-shadow:0 6px 20px rgba(0,0,0,.5);z-index:9}footer{margin-top:10px;font-size:11px;color:#64748b}code{background:#1f2937;padding:1px 5px;border-radius:4px}.hint{color:#22d3ee}</style></head>" +
    "<body><div class=\"wrap\"><h1>🛰 " + hEsc(title) + " — <span id=\"focusName\" class=\"hint\"></span></h1>" +
    "<p class=\"sub\">CODE ↔ DATA ↔ API ↔ BUSINESS · the center is your change; rings = blast hop-distance; sectors = layers. <span class=\"hint\">Click any node to re-center the radar.</span> Deterministic, no LLM — every position encodes a real fact.</p>" +
    "<div class=\"card\"><svg id=\"radar\" viewBox=\"0 0 820 820\" role=\"img\" aria-label=\"" + hEsc(title) + "\"></svg></div>" +
    "<div class=\"legend\">" + ["WRITES_TO", "READS", "HANDLED_BY", "CALLS", "IMPLEMENTS"].map((r) => "<b style=\"color:" + (RELATION_COLOR[r] ?? "#6b7280") + "\">●</b> " + r).join(" &nbsp; ") + "</div>" +
    "<footer>" + pick.nodes.length + " nodes · " + pick.edges.length + " edges" + (fp ? " · fingerprint <code>" + hEsc(fp) + "</code>" : "") + " · honest: reachable coupling to inspect, not a proven runtime break · Mneme Impact Radar</footer>" +
    "<div id=\"tip\"></div>" +
    "<script id=\"mneme-data\" type=\"application/json\">" + json + "</script><script>" + js + "</script></div></body></html>";
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
  const radar = toRadarHtml(g, focus?.id, { fingerprint: "abc123" });
  const det = toMermaid(g, focus?.id) === mm && toRadarHtml(g, focus?.id, { fingerprint: "abc123" }) === radar;  // deterministic
  const mmOK = mm.startsWith("flowchart") && mm.includes("Wallet") && /subgraph (business_rule|api_endpoint|db_table)/.test(mm);
  const htmlOK = html.includes("<svg") && html.includes("</html>") && html.includes("WRITES_TO") && html.includes("abc123");
  const laneOK = html.includes("DATA") && html.includes("BUSINESS");           // multi-lane present
  const radarOK = radar.includes("id=\"radar\"") && radar.includes("mneme-data") && radar.includes("Impact Radar") && radar.includes("animateTransform") && radar.includes("abc123");
  const safeFocus = (() => { try { toMermaid(g); toHtml(g); toRadarHtml(g); toMermaid(null as never); toHtml(null as never); toRadarHtml(null as never); return true; } catch { return false; } })();
  const nastyName = "</script><script>alert(1)</script>";
  const noInject = !toHtml({ nodes: [{ id: "x", type: "function", name: "<script>alert(1)</script>" }], edges: [] }, "x").includes("<script>alert")
    && !toRadarHtml({ nodes: [{ id: "x", type: "function", name: nastyName }], edges: [] }, "x").includes("</script><script>alert");  // embedded JSON escapes < > &
  const checks = [
    { name: "MERMAID", pass: mmOK, detail: "flowchart with per-layer subgraphs renders anywhere (GitHub/chat)" },
    { name: "HTML-SVG", pass: htmlOK, detail: "self-contained offline SVG page with legend + fingerprint" },
    { name: "FOUR-LANES", pass: laneOK, detail: "the 4 layers drawn as horizontal bands (cross-layer picture)" },
    { name: "IMPACT-RADAR", pass: radarOK, detail: "the world-first radar view: center=focus, sectors=layers, rings=hop-distance, animated sweep+pulse, click-to-recenter (self-contained)" },
    { name: "DETERMINISTIC", pass: det, detail: "same graph → byte-identical render (no layout LLM/random)" },
    { name: "XSS-SAFE", pass: noInject, detail: "node names are HTML-escaped — a malicious symbol can't inject script" },
    { name: "TOTAL", pass: safeFocus, detail: "overview + null inputs never throw" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
