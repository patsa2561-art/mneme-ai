import { useMemo } from "react";
import type { NervousSystemData } from "../types";

interface Props {
  data: NervousSystemData;
  highlightFile: string | null;
  onHighlightFile: (path: string | null) => void;
  onSelectAuthor: (email: string) => void;
}

interface Cell {
  fileIdx: number;
  authorIdx: number;
  knowledge: number;
  touches: number;
  daysAgo: number;
}

interface HeatModel {
  files: string[];
  authors: Array<{ email: string; name: string }>;
  cells: Cell[];
}

function buildHeat(data: NervousSystemData): HeatModel {
  const fileSet = new Set<string>();
  const authors: Array<{ email: string; name: string }> = [];
  const cells: Cell[] = [];

  for (const f of data.atrophy.criticalFiles) fileSet.add(f.filePath);
  for (const p of data.passports) {
    for (const f of p.expertise.topFiles) fileSet.add(f.filePath);
  }

  const files = [...fileSet].slice(0, 60);
  const fileIndex = new Map(files.map((f, i) => [f, i]));

  for (const p of data.passports) {
    const ai = authors.length;
    authors.push({ email: p.identity.email, name: p.identity.name });
    for (const f of p.expertise.topFiles) {
      const fi = fileIndex.get(f.filePath);
      if (fi === undefined) continue;
      cells.push({
        fileIdx: fi,
        authorIdx: ai,
        knowledge: f.knowledge,
        touches: f.touchCount,
        daysAgo: f.lastTouchDaysAgo,
      });
    }
  }
  return { files, authors, cells };
}

function knowColor(k: number): string {
  // Deep purple at high, sage at mid, warm gray at low.
  if (k >= 0.7) return "#7c3aed";
  if (k >= 0.5) return "#a78bfa";
  if (k >= 0.3) return "#10b981";
  if (k >= 0.15) return "#6b7280";
  return "#374151";
}

export function AtrophyHeatmap({
  data,
  highlightFile,
  onHighlightFile,
  onSelectAuthor,
}: Props) {
  const heat = useMemo(() => buildHeat(data), [data]);
  if (heat.files.length === 0 || heat.authors.length === 0) {
    return (
      <div className="heatmap-empty">
        <p>Not enough overlap between authors and files at this moment.</p>
      </div>
    );
  }

  const cellW = 22;
  const cellH = 18;
  const gap = 2;
  const labelW = 280;
  const headerH = 110;
  const width = labelW + heat.authors.length * (cellW + gap);
  const height = headerH + heat.files.length * (cellH + gap);

  return (
    <div className="heatmap-container">
      <div className="heatmap-scroll">
        <svg width={width} height={height} role="img" aria-label="Atrophy heatmap">
          {heat.authors.map((a, i) => (
            <g key={a.email} transform={`translate(${labelW + i * (cellW + gap)}, ${headerH - 4})`}>
              <text
                transform={`rotate(-55)`}
                fill="rgba(232,232,255,0.85)"
                fontSize="11"
                style={{ cursor: "pointer" }}
                onClick={() => onSelectAuthor(a.email)}
              >
                {a.name.length > 18 ? a.name.slice(0, 17) + "…" : a.name}
              </text>
            </g>
          ))}
          {heat.files.map((f, fi) => {
            const isHighlight = highlightFile === f;
            return (
              <g key={f} transform={`translate(0, ${headerH + fi * (cellH + gap)})`}>
                <rect
                  x={0}
                  y={0}
                  width={labelW - 6}
                  height={cellH}
                  fill={isHighlight ? "rgba(124,58,237,0.18)" : "transparent"}
                  rx={4}
                />
                <text
                  x={6}
                  y={cellH - 4}
                  fill="rgba(232,232,255,0.78)"
                  fontSize="11"
                  style={{ cursor: "pointer" }}
                  onClick={() => onHighlightFile(isHighlight ? null : f)}
                >
                  {f.length > 38 ? "…" + f.slice(-37) : f}
                </text>
              </g>
            );
          })}
          {heat.cells.map((c, i) => (
            <g
              key={i}
              transform={`translate(${labelW + c.authorIdx * (cellW + gap)}, ${headerH + c.fileIdx * (cellH + gap)})`}
            >
              <title>
                {`${heat.authors[c.authorIdx]?.name} · ${heat.files[c.fileIdx]} · knowledge ${(c.knowledge * 100).toFixed(0)}% · ${c.touches} touches · ${c.daysAgo}d ago`}
              </title>
              <rect
                width={cellW}
                height={cellH}
                rx={3}
                fill={knowColor(c.knowledge)}
                opacity={0.35 + 0.65 * Math.max(0.05, c.knowledge)}
              />
            </g>
          ))}
        </svg>
      </div>
      <HeatmapLegend />
    </div>
  );
}

function HeatmapLegend() {
  const stops = [0.85, 0.6, 0.4, 0.25, 0.05];
  return (
    <div className="heatmap-legend">
      <span className="heatmap-legend-label">knowledge</span>
      {stops.map((k) => (
        <span
          key={k}
          className="heatmap-legend-swatch"
          style={{ background: knowColor(k), opacity: 0.35 + 0.65 * k }}
          title={`${(k * 100).toFixed(0)}%`}
        />
      ))}
    </div>
  );
}
