/**
 * /audit — fleet-wide audit verdict timeline for a repo.
 *
 * Shows every `mneme audit --certify` result over time as a strip chart.
 * Hover to see the per-axis breakdown. v1.8.0 ships the layout; v1.9.0
 * pipes real data from Postgres.
 */

import type { GetServerSideProps } from "next";

interface AuditEntry {
  commitHash: string;
  ranAt: string;
  verdict: "PASS" | "WARN" | "FAIL";
  axes: Record<string, "pass" | "warn" | "fail" | "skipped">;
}

interface Props {
  repoName: string;
  entries: AuditEntry[];
}

function colorForVerdict(v: AuditEntry["verdict"]): string {
  return v === "PASS" ? "#0a8" : v === "WARN" ? "#fa0" : "#c33";
}

export default function AuditPage({ repoName, entries }: Props) {
  const passed = entries.filter((e) => e.verdict === "PASS").length;
  const warned = entries.filter((e) => e.verdict === "WARN").length;
  const failed = entries.filter((e) => e.verdict === "FAIL").length;

  return (
    <div style={{ fontFamily: "ui-monospace, monospace", padding: "2rem", maxWidth: 1200, margin: "0 auto" }}>
      <a href="/" style={{ color: "#888" }}>← back</a>
      <h1 style={{ fontSize: 28, marginTop: 16 }}>{repoName} · audit timeline</h1>
      <p style={{ color: "#666" }}>
        Every <code>mneme audit --certify</code> verdict, sorted chronologically. 5-axis trust certificates.
      </p>

      <div style={{ marginTop: 24, marginBottom: 16, display: "flex", gap: 16 }}>
        <Stat label="Total audits" value={entries.length} color="#333" />
        <Stat label="Passed" value={passed} color="#0a8" />
        <Stat label="Warned" value={warned} color="#fa0" />
        <Stat label="Failed" value={failed} color="#c33" />
      </div>

      {entries.length === 0 ? (
        <div style={{ padding: 32, color: "#888", border: "1px dashed #ccc" }}>
          No audit data uploaded yet. Run <code>mneme audit --certify --json | curl -X POST {`<dashboard>`}/api/ingest/audit</code>.
        </div>
      ) : (
        <>
          <div style={{ marginTop: 24, display: "flex", flexWrap: "wrap", gap: 2 }}>
            {entries.map((e, i) => (
              <div key={i} title={`${e.commitHash.slice(0, 8)} · ${e.ranAt} · ${e.verdict}`} style={{
                width: 16, height: 24, background: colorForVerdict(e.verdict), borderRadius: 2, cursor: "pointer",
              }} />
            ))}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 32 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #333", textAlign: "left" }}>
                <th style={{ padding: 6 }}>Commit</th>
                <th style={{ padding: 6 }}>When</th>
                <th style={{ padding: 6 }}>Verdict</th>
                <th style={{ padding: 6 }}>Axes</th>
              </tr>
            </thead>
            <tbody>
              {entries.slice(-20).reverse().map((e, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: 6, fontFamily: "monospace", fontSize: 11 }}>{e.commitHash.slice(0, 8)}</td>
                  <td style={{ padding: 6, color: "#666", fontSize: 12 }}>{e.ranAt.slice(0, 19)}</td>
                  <td style={{ padding: 6, color: colorForVerdict(e.verdict), fontWeight: 600 }}>{e.verdict}</td>
                  <td style={{ padding: 6, fontSize: 11 }}>{Object.entries(e.axes).map(([k, v]) => `${k}=${v}`).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ minWidth: 120 }}>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: "#666", textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  return {
    props: {
      repoName: String(ctx.query["repo"] ?? "demo-repo"),
      entries: [],
    },
  };
};
