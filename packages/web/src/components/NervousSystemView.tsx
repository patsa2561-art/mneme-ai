import { useEffect, useMemo, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
} from "d3-force";
import { drag } from "d3-drag";
import { select, type BaseType } from "d3-selection";
import { zoom, zoomIdentity, type D3ZoomEvent } from "d3-zoom";
import type { GraphLink, GraphNode, NervousSystemData } from "../types";

interface Props {
  data: NervousSystemData;
  selectedEmail: string | null;
  onSelect: (email: string | null) => void;
}

interface Tooltip {
  x: number;
  y: number;
  node: GraphNode;
}

const COLORS = {
  fresh: "#a78bfa",
  warm: "#7c3aed",
  fading: "#9ca3af",
  ghost: "#4b5563",
};

function freshnessColor(f: number): string {
  if (f >= 0.7) return COLORS.fresh;
  if (f >= 0.4) return COLORS.warm;
  if (f >= 0.15) return COLORS.fading;
  return COLORS.ghost;
}

function buildGraph(data: NervousSystemData): { nodes: GraphNode[]; links: GraphLink[] } {
  const byEmail = new Map<string, GraphNode>();
  for (const p of data.passports ?? []) {
    const email = p.identity.email.toLowerCase();
    const fresh = clamp01(p.expertise.knowledgeMass / 8); // crude normalization
    byEmail.set(email, {
      id: email,
      name: p.identity.name,
      email,
      knowledgeMass: p.expertise.knowledgeMass,
      freshness: fresh,
      joinedAt: Date.parse(p.identity.fromDate) || 0,
      lastActiveAt: Date.parse(p.expertise.lastActiveAt) || 0,
      pageRank: p.influenceSlot?.pageRank ?? 0,
      rank: p.influenceSlot?.rank ?? null,
      passport: p,
    });
  }
  // Make sure alphas appear even if they don't have a passport.
  for (const a of data.alphas ?? []) {
    const email = a.email.toLowerCase();
    if (byEmail.has(email)) continue;
    byEmail.set(email, {
      id: email,
      name: a.name,
      email,
      knowledgeMass: 0,
      freshness: 0.5,
      joinedAt: 0,
      lastActiveAt: 0,
      pageRank: a.pageRank,
      rank: a.rank,
      passport: null,
    });
  }
  const nodes = [...byEmail.values()];

  const links: GraphLink[] = [];
  for (const pair of data.telepathy.pairs) {
    const a = pair.authorA.email.toLowerCase();
    const b = pair.authorB.email.toLowerCase();
    if (!byEmail.has(a) || !byEmail.has(b)) continue;
    links.push({
      source: a,
      target: b,
      score: pair.score,
      events: pair.events,
      topic: pair.topTopic.topic,
      lastSeen: Date.parse(pair.lastSeenAt) || 0,
    });
  }
  return { nodes, links };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function radiusFor(n: GraphNode): number {
  // Scale so even tiny knowledge mass nodes are visible; massive ones cap out.
  const base = 14;
  const extra = Math.sqrt(n.knowledgeMass) * 6;
  return Math.min(46, base + extra);
}

export function NervousSystemView({ data, selectedEmail, onSelect }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const simRef = useRef<Simulation<GraphNode, GraphLink> | null>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  // Build nodes/links once per data.
  const graph = useMemo(() => buildGraph(data), [data]);

  // Watch container for size changes.
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      setSize({ w: Math.max(320, r.width), h: Math.max(280, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Build/refresh the simulation when the data or size changes.
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = select(svgRef.current);
    svg.selectAll("*").remove();

    const defs = svg.append("defs");
    const grad = defs
      .append("radialGradient")
      .attr("id", "node-grad-fresh")
      .attr("cx", "30%")
      .attr("cy", "30%");
    grad.append("stop").attr("offset", "0%").attr("stop-color", "#c4b5fd");
    grad.append("stop").attr("offset", "100%").attr("stop-color", "#7c3aed");
    const grad2 = defs
      .append("radialGradient")
      .attr("id", "node-grad-warm")
      .attr("cx", "30%")
      .attr("cy", "30%");
    grad2.append("stop").attr("offset", "0%").attr("stop-color", "#a78bfa");
    grad2.append("stop").attr("offset", "100%").attr("stop-color", "#5b21b6");
    const glow = defs
      .append("filter")
      .attr("id", "soft-glow")
      .attr("x", "-50%")
      .attr("y", "-50%")
      .attr("width", "200%")
      .attr("height", "200%");
    glow.append("feGaussianBlur").attr("stdDeviation", "4").attr("result", "b");
    const merge = glow.append("feMerge");
    merge.append("feMergeNode").attr("in", "b");
    merge.append("feMergeNode").attr("in", "SourceGraphic");

    const root = svg.append("g").attr("class", "graph-root");
    const linkLayer = root.append("g").attr("class", "link-layer");
    const nodeLayer = root.append("g").attr("class", "node-layer");

    // Initialize node positions: cluster around the centre to avoid the
    // "shotgun-blast" look every D3 tutorial ships with.
    const cx = size.w / 2;
    const cy = size.h / 2;
    for (const n of graph.nodes) {
      if (n.x === undefined) {
        const r = 40 + Math.random() * 80;
        const a = Math.random() * Math.PI * 2;
        n.x = cx + Math.cos(a) * r;
        n.y = cy + Math.sin(a) * r;
      }
    }

    const sim = forceSimulation<GraphNode, GraphLink>(graph.nodes)
      .force(
        "link",
        forceLink<GraphNode, GraphLink>(graph.links)
          .id((d) => d.id)
          .distance((l) => 80 + 60 * (1 - Math.min(1, l.score)))
          .strength((l) => 0.2 + 0.6 * Math.min(1, l.score)),
      )
      .force("charge", forceManyBody().strength(-360))
      .force("center", forceCenter(cx, cy).strength(0.05))
      .force(
        "collide",
        forceCollide<GraphNode>().radius((d) => radiusFor(d) + 6).strength(0.9),
      )
      .alpha(0.9)
      .alphaDecay(0.03);

    simRef.current = sim;

    const linkSel = linkLayer
      .selectAll<SVGLineElement, GraphLink>("line")
      .data(graph.links)
      .enter()
      .append("line")
      .attr("stroke", "url(#node-grad-fresh)")
      .attr("stroke-opacity", (l) => 0.25 + Math.min(0.55, l.score * 0.4))
      .attr("stroke-width", (l) => 1 + Math.min(4, l.events / 4))
      .attr("stroke-linecap", "round");

    const nodeSel = nodeLayer
      .selectAll<SVGGElement, GraphNode>("g.node")
      .data(graph.nodes)
      .enter()
      .append("g")
      .attr("class", "node")
      .style("cursor", "pointer");

    nodeSel
      .append("circle")
      .attr("class", "node-halo")
      .attr("r", (d) => radiusFor(d) + 8)
      .attr("fill", (d) => freshnessColor(d.freshness))
      .attr("opacity", 0.18);

    nodeSel
      .append("circle")
      .attr("class", "node-body")
      .attr("r", (d) => radiusFor(d))
      .attr("fill", (d) => (d.freshness >= 0.5 ? "url(#node-grad-fresh)" : freshnessColor(d.freshness)))
      .attr("stroke", "rgba(255,255,255,0.12)")
      .attr("stroke-width", 1.2);

    nodeSel
      .append("text")
      .attr("class", "node-label")
      .attr("text-anchor", "middle")
      .attr("dy", (d) => radiusFor(d) + 16)
      .attr("fill", "rgba(232,232,255,0.78)")
      .attr("font-size", 11)
      .attr("font-weight", 500)
      .attr("pointer-events", "none")
      .text((d) => d.name.length > 22 ? d.name.slice(0, 21) + "…" : d.name);

    // Drag.
    const dragBehavior = drag<SVGGElement, GraphNode>()
      .on("start", (event, d) => {
        if (!event.active) sim.alphaTarget(0.25).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
    nodeSel.call(dragBehavior as never);

    // Click → select.
    nodeSel.on("click", (_, d) => {
      onSelect(d.email);
    });
    // Hover → tooltip.
    nodeSel
      .on("mousemove", (event: MouseEvent, d) => {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        setTooltip({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          node: d,
        });
      })
      .on("mouseleave", () => setTooltip(null));

    // Zoom + pan.
    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on("zoom", (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        root.attr("transform", event.transform.toString());
      });
    svg.call(zoomBehavior as never);
    svg.call(zoomBehavior.transform as never, zoomIdentity);

    sim.on("tick", () => {
      linkSel
        .attr("x1", (d) => (typeof d.source === "string" ? 0 : d.source.x ?? 0))
        .attr("y1", (d) => (typeof d.source === "string" ? 0 : d.source.y ?? 0))
        .attr("x2", (d) => (typeof d.target === "string" ? 0 : d.target.x ?? 0))
        .attr("y2", (d) => (typeof d.target === "string" ? 0 : d.target.y ?? 0));
      nodeSel.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => {
      sim.stop();
      simRef.current = null;
    };
  }, [graph, size.w, size.h, onSelect]);

  // Visual selection highlight — react to selection without rebuilding the sim.
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = select(svgRef.current);
    const target = (selectedEmail ?? "").toLowerCase();
    const nodeSel = svg.selectAll<BaseType, GraphNode>("g.node");
    nodeSel.classed("selected", (d) => d.email === target);
    nodeSel.classed("dim", (d) => target !== "" && d.email !== target);
  }, [selectedEmail]);

  if (graph.nodes.length === 0) {
    return (
      <div ref={containerRef} className="graph-container">
        <div className="graph-empty">
          <p>No authors at this point in time.</p>
          <p className="graph-empty-hint">
            Drag the time scrubber forward to watch the team appear.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="graph-container">
      <svg
        ref={svgRef}
        className="graph-svg"
        viewBox={`0 0 ${size.w} ${size.h}`}
        preserveAspectRatio="xMidYMid meet"
      />
      {tooltip && (
        <div
          className="graph-tooltip"
          style={{
            left: `${tooltip.x + 14}px`,
            top: `${tooltip.y + 14}px`,
          }}
        >
          <div className="graph-tooltip-name">{tooltip.node.name}</div>
          <div className="graph-tooltip-row">
            <span>knowledge mass</span>
            <b>{tooltip.node.knowledgeMass.toFixed(2)}</b>
          </div>
          <div className="graph-tooltip-row">
            <span>page rank</span>
            <b>{tooltip.node.pageRank.toFixed(3)}</b>
          </div>
          <div className="graph-tooltip-hint">click to open passport</div>
        </div>
      )}
      <Legend />
    </div>
  );
}

function Legend() {
  return (
    <div className="graph-legend" aria-label="Legend">
      <div className="legend-row"><span className="legend-dot fresh" /> active</div>
      <div className="legend-row"><span className="legend-dot warm" /> warm</div>
      <div className="legend-row"><span className="legend-dot fade" /> fading</div>
      <div className="legend-row"><span className="legend-dot ghost" /> atrophied</div>
      <div className="legend-row hint">node size = knowledge mass · edges = telepathy</div>
    </div>
  );
}
