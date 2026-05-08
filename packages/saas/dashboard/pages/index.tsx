/**
 * Mneme Dashboard — landing page (v1.8.0).
 *
 * Lists the linked Mneme repos and links to per-repo dashboard views.
 * In v1.7.0 this was a scaffold; v1.8.0 ships 2 functional pages:
 * `/atrophy` and `/audit`.
 */

import type { GetServerSideProps } from "next";

interface Repo {
  id: string;
  name: string;
  lastSyncAt: string;
  totalCommits: number;
  audit5axisVerdict: "PASS" | "WARN" | "FAIL" | "UNKNOWN";
}

interface Props {
  repos: Repo[];
}

export default function Home({ repos }: Props) {
  return (
    <div style={{ fontFamily: "ui-monospace, monospace", padding: "2rem", maxWidth: 960, margin: "0 auto" }}>
      <h1 style={{ fontSize: 36, marginBottom: 8 }}>μνήμη · Mneme dashboard</h1>
      <p style={{ color: "#666", marginBottom: 32 }}>
        Cross-repo rollups powered by the Mneme CLI. Each row is a repo that pushed audit data to this instance.
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #333" }}>
            <th style={{ padding: "8px 4px" }}>Repo</th>
            <th style={{ padding: "8px 4px" }}>Last sync</th>
            <th style={{ padding: "8px 4px" }}>Commits</th>
            <th style={{ padding: "8px 4px" }}>5-axis</th>
            <th style={{ padding: "8px 4px" }}>Views</th>
          </tr>
        </thead>
        <tbody>
          {repos.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ padding: "24px 4px", color: "#888" }}>
                No repos synced yet. Run <code>mneme audit --report --upstream {`{this dashboard URL}`}</code> from a repo.
              </td>
            </tr>
          ) : (
            repos.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid #ddd" }}>
                <td style={{ padding: "8px 4px", fontWeight: 600 }}>{r.name}</td>
                <td style={{ padding: "8px 4px", color: "#666" }}>{r.lastSyncAt}</td>
                <td style={{ padding: "8px 4px" }}>{r.totalCommits}</td>
                <td style={{ padding: "8px 4px" }}>
                  <span style={{
                    padding: "2px 8px",
                    borderRadius: 4,
                    background:
                      r.audit5axisVerdict === "PASS" ? "#0a8" :
                      r.audit5axisVerdict === "WARN" ? "#fa0" :
                      r.audit5axisVerdict === "FAIL" ? "#c33" : "#888",
                    color: "white",
                  }}>{r.audit5axisVerdict}</span>
                </td>
                <td style={{ padding: "8px 4px" }}>
                  <a href={`/atrophy?repo=${r.id}`}>atrophy</a> · <a href={`/audit?repo=${r.id}`}>audit</a>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <footer style={{ marginTop: 64, paddingTop: 16, borderTop: "1px solid #ddd", color: "#888", fontSize: 12 }}>
        <a href="https://github.com/patsa2561-art/mneme-ai">github.com/patsa2561-art/mneme-ai</a>
        {" · "}
        <a href="https://www.npmjs.com/package/mneme-ai">npm</a>
      </footer>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async () => {
  // v1.8.0: returns demo data. v1.9.0 will read from Postgres.
  return {
    props: {
      repos: [],
    },
  };
};
