/**
 * /atrophy — knowledge-decay heatmap for a repo.
 *
 * v1.8.0 ships the layout + render with demo data; v1.9.0 wires real
 * data from the Postgres backend.
 */

import type { GetServerSideProps } from "next";

interface AtrophyCell {
  author: string;
  area: string;
  score: number;
  daysSinceLastTouch: number;
}

interface Props {
  repoName: string;
  cells: AtrophyCell[];
}

function colorForScore(score: number): string {
  if (score < 30) return "#c33";       // red — fading
  if (score < 50) return "#fa0";       // orange — at risk
  if (score < 70) return "#fd5";       // yellow — moderate
  return "#0a8";                       // green — fresh
}

export default function AtrophyPage({ repoName, cells }: Props) {
  const authors = Array.from(new Set(cells.map((c) => c.author))).sort();
  const areas = Array.from(new Set(cells.map((c) => c.area))).sort();
  const lookup = new Map(cells.map((c) => [`${c.author}|${c.area}`, c]));

  return (
    <div style={{ fontFamily: "ui-monospace, monospace", padding: "2rem", maxWidth: 1200, margin: "0 auto" }}>
      <a href="/" style={{ color: "#888" }}>← back</a>
      <h1 style={{ fontSize: 28, marginTop: 16 }}>{repoName} · atrophy heatmap</h1>
      <p style={{ color: "#666" }}>
        Knowledge half-life by (author × area). Darker red = more fading. Based on Ebbinghaus forgetting curve over commit recency.
      </p>
      {cells.length === 0 ? (
        <div style={{ padding: 32, color: "#888", border: "1px dashed #ccc", marginTop: 24 }}>
          No atrophy data uploaded yet. Run <code>mneme atrophy --json | curl -X POST {`<dashboard>`}/api/ingest/atrophy</code>.
        </div>
      ) : (
        <table style={{ borderCollapse: "collapse", marginTop: 24 }}>
          <thead>
            <tr>
              <th style={{ padding: 4 }}></th>
              {areas.map((a) => (
                <th key={a} style={{ padding: 4, fontSize: 11, writingMode: "vertical-rl" as const }}>{a}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {authors.map((author) => (
              <tr key={author}>
                <td style={{ padding: 4, fontSize: 12, fontWeight: 600 }}>{author}</td>
                {areas.map((area) => {
                  const cell = lookup.get(`${author}|${area}`);
                  return (
                    <td key={area} style={{
                      width: 32, height: 32,
                      background: cell ? colorForScore(cell.score) : "#eee",
                      textAlign: "center", color: "white", fontSize: 10,
                      border: "1px solid white",
                    }} title={cell ? `score=${cell.score}, ${cell.daysSinceLastTouch}d` : "no data"}>
                      {cell ? cell.score : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  return {
    props: {
      repoName: String(ctx.query["repo"] ?? "demo-repo"),
      cells: [],
    },
  };
};
