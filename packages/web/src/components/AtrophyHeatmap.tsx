import { useMemo } from "react";
import type { NervousSystemData } from "../types";
import { AtrophyIntelligenceStrip } from "./AtrophyIntelligenceStrip";

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
    if (data._liveMode) {
      return (
        <div className="heatmap-empty">
          <h3>Atrophy heatmap needs file-level data.</h3>
          <p>
            The {data._liveSource ?? "git"} REST API doesn't expose per-commit
            file diffs cheaply, so we don't fetch them in live preview (would
            burn the unauthenticated rate limit on a single repo).
          </p>
          <p className="heatmap-empty-cta">
            For the full heatmap on this repo, ask your AI agent: <em>"install
            Mneme, run <code>mneme index</code>, then dump <code>nervous-system
            --json</code>"</em>, and drop the resulting file via{" "}
            <b>Load my repo</b>.
          </p>
        </div>
      );
    }
    return (
      <div className="heatmap-empty">
        <p>Not enough overlap between authors and files at this moment.</p>
      </div>
    );
  }

  const cellW = 32;
  const cellH = 26;
  const gap = 3;
  const labelW = 360;
  // headerH derives from the LONGEST author name so labels never clip.
  // 14pt char ≈ 8.5px; rotated -45° → projected vertical = chars × 8.5 × sin(45°).
  // Add 24px padding for breathing room. Floor at 200px (looks balanced
  // even when names are short).
  const longestName = heat.authors.reduce((max, a) => Math.max(max, a.name.length), 0);
  const headerH = Math.max(200, Math.ceil(longestName * 8.5 * 0.7071) + 24);
  const width = labelW + heat.authors.length * (cellW + gap);
  const height = headerH + heat.files.length * (cellH + gap) + 8;

  // ─── Wisdom callouts: derive insights from the data ─────────────────
  const atRiskCount = data.atrophy.criticalFiles.filter((f) => f.tier === "at-risk").length;
  const totalCritical = data.atrophy.criticalFiles.length;
  const busFactorOne = data.atrophy.criticalFiles.filter((f) => f.liveExpertCount === 1).length;

  // Top knower: author with the most "topKnower" appearances across critical files.
  const ownership = new Map<string, { name: string; count: number }>();
  for (const f of data.atrophy.criticalFiles) {
    if (!f.topKnower) continue;
    const cur = ownership.get(f.topKnower.email);
    if (cur) cur.count++;
    else ownership.set(f.topKnower.email, { name: f.topKnower.name, count: 1 });
  }
  const topOwner = Array.from(ownership.entries()).sort((a, b) => b[1].count - a[1].count)[0];

  // Most-at-risk file: highest atrophy among at-risk tier
  const mostAtRisk = data.atrophy.criticalFiles
    .filter((f) => f.tier === "at-risk")
    .sort((a, b) => a.freshestKnowledge - b.freshestKnowledge)[0];

  return (
    <div className="heatmap-container">
      <header className="atrophy-intro">
        <h2>⏳ Knowledge Atrophy — who knows what, how fresh, who's leaving you alone with it</h2>
        <p>
          Each row is a file Mneme is tracking. Each column is an author.
          <b> Cell color = how fresh that author's knowledge is right now</b>{" "}
          (purple = live · green/teal = warm · gray = decaying ghost-code).
          Below: the 3 questions an engineering leader asks <i>tomorrow morning</i>.
        </p>
      </header>

      {/* v1.19.3 — Nuclear intelligence strip: connects atrophy data to
          Mneme's full metric stack (HKD/KAH/3am-files/heroes/orphans/talent-years)
          + actionable insight cards. */}
      <AtrophyIntelligenceStrip data={data} />

      <div className="atrophy-callouts">
        <div className={`atrophy-callout ${atRiskCount > 0 ? "warn" : "ok"}`}>
          <div className="atrophy-callout-glyph">🔥</div>
          <div className="atrophy-callout-num">
            {atRiskCount}<span className="atrophy-callout-denom">/{totalCritical}</span>
          </div>
          <div className="atrophy-callout-label">files at-risk</div>
          <div className="atrophy-callout-explain">
            Knowledge decayed past the 40% threshold. {mostAtRisk ? <>Worst: <code>{mostAtRisk.filePath}</code></> : "—"}
          </div>
        </div>

        <div className={`atrophy-callout ${busFactorOne > 0 ? "warn" : "ok"}`}>
          <div className="atrophy-callout-glyph">🧍</div>
          <div className="atrophy-callout-num">{busFactorOne}</div>
          <div className="atrophy-callout-label">bus-factor of 1</div>
          <div className="atrophy-callout-explain">
            Files with exactly one live expert. One resignation away from disaster.
          </div>
        </div>

        <div className="atrophy-callout">
          <div className="atrophy-callout-glyph">👑</div>
          <div className="atrophy-callout-num">{topOwner ? topOwner[1].count : 0}</div>
          <div className="atrophy-callout-label">{topOwner ? `${topOwner[1].name} owns` : "no top owner yet"}</div>
          <div className="atrophy-callout-explain">
            of the {totalCritical} critical files. Pair before they leave.
          </div>
        </div>
      </div>

      <div className="heatmap-scroll">
        <svg width={width} height={height} role="img" aria-label="Atrophy heatmap">
          {heat.authors.map((a, i) => (
            <g key={a.email} transform={`translate(${labelW + i * (cellW + gap) + cellW / 2 + 2}, ${headerH - 8})`}>
              <text
                transform={`rotate(-45)`}
                fill="rgba(232,232,255,0.92)"
                fontSize="14"
                fontWeight="500"
                style={{ cursor: "pointer" }}
                onClick={() => onSelectAuthor(a.email)}
              >
                {a.name}
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
                  width={labelW - 8}
                  height={cellH}
                  fill={isHighlight ? "rgba(124,58,237,0.22)" : "transparent"}
                  rx={5}
                />
                <text
                  x={10}
                  y={cellH - 7}
                  fill="rgba(232,232,255,0.88)"
                  fontSize="13.5"
                  fontFamily="var(--font-mono, monospace)"
                  style={{ cursor: "pointer" }}
                  onClick={() => onHighlightFile(isHighlight ? null : f)}
                >
                  {f.length > 44 ? "…" + f.slice(-43) : f}
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
                rx={4}
                fill={knowColor(c.knowledge)}
                opacity={0.4 + 0.6 * Math.max(0.05, c.knowledge)}
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
