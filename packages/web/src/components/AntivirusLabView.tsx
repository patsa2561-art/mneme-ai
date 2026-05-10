/**
 * AntivirusLabView -- the Mneme Vaccine Lab dashboard.
 *
 * Three sections:
 *   1. Strain Atlas      -- taxonomy of 8 known hallucination strains
 *   2. Pharmacopoeia     -- vaccines + efficacy bars (HMAC-signed)
 *   3. Realtime feed     -- recent scans + per-strain catch counts
 *   4. Cert ledger       -- benchmark proofs (signature snippets)
 *
 * In static demo mode (no .mneme/), shows seed data so the lab is never
 * empty. In live mode (Load my repo with a real .mneme/antivirus/), reads
 * the actual stats + pharmacopoeia files from the bundled artifact.
 */

import { useState, useMemo } from "react";

interface StrainCard {
  id: string;
  scientificName: string;
  commonName: string;
  pathogenesis: string;
  severity: number;
}

interface VaccineCard {
  id: string;
  strain: string;
  version: string;
  source: string;
  efficacy: {
    precision: number | null;
    recall: number | null;
    f1: number | null;
    tp: number; tn: number; fp: number; fn: number;
    signature: string;
    ranAt: string;
  } | null;
}

interface ScanCard {
  scanId: string;
  ranAt: string;
  claimsExamined: number;
  infections: number;
  totalMs: number;
}

// Seed data shown when no live .mneme/ is loaded. Mirrors what the actual
// CLI/MCP would produce on a fresh install.
const SEED_STRAINS: StrainCard[] = [
  { id: "citatio_viridis", scientificName: "Citatio viridis", commonName: "Phantom commit hash", pathogenesis: "AI cites a SHA that doesn't exist in git history.", severity: 4 },
  { id: "api_phantasma", scientificName: "API phantasma", commonName: "Ghost function/method", pathogenesis: "AI references a function with no definition.", severity: 4 },
  { id: "depends_imaginarium", scientificName: "Depends imaginarium", commonName: "Phantom npm package", pathogenesis: "AI imports a package that doesn't exist.", severity: 4 },
  { id: "persona_fictum", scientificName: "Persona fictum", commonName: "Invented author", pathogenesis: "AI attributes work to someone who never committed.", severity: 3 },
  { id: "structura_invenita", scientificName: "Structura invenita", commonName: "Phantom file path", pathogenesis: "AI references a file that doesn't exist.", severity: 3 },
  { id: "logica_circularis", scientificName: "Logica circularis", commonName: "Circular reasoning", pathogenesis: "Claim graph contains a cycle (premise == conclusion).", severity: 3 },
  { id: "tempus_perversum", scientificName: "Tempus perversum", commonName: "Time-warped event", pathogenesis: "AI cites a date that doesn't match when the event happened.", severity: 2 },
  { id: "confidens_cardinalis", scientificName: "Confidens cardinalis", commonName: "Off-by-N count", pathogenesis: "AI states a count that's off by more than tolerance.", severity: 2 },
];

const SEED_VACCINES: VaccineCard[] = SEED_STRAINS.map((s) => ({
  id: `anti_${s.id}_v1`,
  strain: s.id,
  version: "1.0.0",
  source: "seed",
  efficacy: {
    // Honest seed efficacy: shown as "uncertified" until benchmark runs.
    precision: null, recall: null, f1: null,
    tp: 0, tn: 0, fp: 0, fn: 0,
    signature: "",
    ranAt: "",
  },
}));

interface AntivirusLabViewProps {
  /** Optional: live data injected by App.tsx when a real .mneme/ is loaded. */
  liveStats?: {
    totalScans: number;
    totalInfectionsCaught: number;
    byStrain: Record<string, { caught: number; lastCaughtAt: string | null }>;
    recentScans: ScanCard[];
  };
  livePharmacopoeia?: VaccineCard[];
}

export function AntivirusLabView(props: AntivirusLabViewProps) {
  const [tab, setTab] = useState<"atlas" | "pharmacopoeia" | "feed" | "cert">("atlas");
  const vaccines = props.livePharmacopoeia ?? SEED_VACCINES;
  const stats = props.liveStats;
  const isLive = !!props.liveStats;

  // v1.26.5 -- when user clicks a tab, scroll the body into view so the
  // content shift is obvious. Without this, in DEMO mode the user clicks
  // "Realtime Feed" / "Cert Ledger" and the new content lands BELOW the
  // fold; they think the tab didn't switch ("hang"). With scroll-on-click,
  // the active panel always pops into view.
  function selectTab(next: typeof tab): void {
    setTab(next);
    requestAnimationFrame(() => {
      try {
        const el = document.querySelector(".lab-body");
        if (el && "scrollIntoView" in el) {
          (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "start" });
        }
      } catch { /* best-effort */ }
    });
  }

  const totalCertified = useMemo(
    () => vaccines.filter((v) => v.efficacy?.signature && v.efficacy.signature.length > 0).length,
    [vaccines],
  );
  const avgF1 = useMemo(() => {
    const f1s = vaccines.map((v) => v.efficacy?.f1).filter((f): f is number => typeof f === "number");
    return f1s.length === 0 ? null : f1s.reduce((s, x) => s + x, 0) / f1s.length;
  }, [vaccines]);

  return (
    <div className="antivirus-lab">
      <div className="lab-header">
        <h2>💉 Mneme Antivirus Lab</h2>
        <p className="lab-tagline">
          The first MCP server in the world that ships a hallucination antiviral.
          {isLive ? <span className="lab-badge live">● LIVE — your repo</span> : <span className="lab-badge demo">◉ DEMO — synthetic seed data</span>}
        </p>
        {!isLive && (
          <p className="lab-hero">
            <strong>What this is:</strong> when an AI generates code, it sometimes invents
            functions, files, packages, or commit hashes that don't exist. Mneme catches
            those hallucinations BEFORE they merge — using HMAC-signed vaccines with
            measured precision/recall/F1.
            <br />
            <strong>How to use:</strong> run <code>mneme antivirus scan &lt;ai-draft.txt&gt;</code>
            from your terminal — every claim gets checked against your real git history.
            <br />
            <strong>Where the data below comes from:</strong> 8 seed strains from the
            built-in pharmacopoeia (no benchmarks yet — F1 shows "—"). Run
            <code> mneme antivirus benchmark</code> to populate real efficacy numbers.
          </p>
        )}
        <div className="lab-summary-strip">
          <div className="lab-stat"><div className="lab-stat-num">{SEED_STRAINS.length}</div><div className="lab-stat-label">strains catalogued</div></div>
          <div className="lab-stat"><div className="lab-stat-num">{vaccines.length}</div><div className="lab-stat-label">vaccines registered</div></div>
          <div className="lab-stat"><div className="lab-stat-num">{totalCertified}</div><div className="lab-stat-label">certified</div></div>
          <div className="lab-stat"><div className="lab-stat-num">{avgF1 == null ? "—" : avgF1.toFixed(2)}</div><div className="lab-stat-label">avg F1</div></div>
          {stats && (
            <>
              <div className="lab-stat"><div className="lab-stat-num">{stats.totalScans}</div><div className="lab-stat-label">scans</div></div>
              <div className="lab-stat"><div className="lab-stat-num">{stats.totalInfectionsCaught}</div><div className="lab-stat-label">caught</div></div>
            </>
          )}
        </div>
      </div>

      <nav className="lab-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "atlas"} className={tab === "atlas" ? "active" : ""} onClick={() => selectTab("atlas")}>🧬 Strain Atlas</button>
        <button role="tab" aria-selected={tab === "pharmacopoeia"} className={tab === "pharmacopoeia" ? "active" : ""} onClick={() => selectTab("pharmacopoeia")}>💉 Pharmacopoeia</button>
        <button role="tab" aria-selected={tab === "feed"} className={tab === "feed" ? "active" : ""} onClick={() => selectTab("feed")}>📡 Realtime Feed</button>
        <button role="tab" aria-selected={tab === "cert"} className={tab === "cert" ? "active" : ""} onClick={() => selectTab("cert")}>🛡 Cert Ledger</button>
      </nav>

      <div className="lab-body">
        {tab === "atlas" && (
          <div className="strain-atlas">
            {SEED_STRAINS.map((s) => (
              <div key={s.id} className={`strain-card sev-${s.severity}`}>
                <div className="strain-head">
                  <span className="strain-sev">sev {s.severity}</span>
                  <span className="strain-id">{s.id}</span>
                </div>
                <div className="strain-name"><em>{s.scientificName}</em> — {s.commonName}</div>
                <div className="strain-pathogenesis">{s.pathogenesis}</div>
              </div>
            ))}
          </div>
        )}

        {tab === "pharmacopoeia" && (
          <div className="pharmacopoeia">
            {vaccines.map((v) => {
              const f1 = v.efficacy?.f1;
              const pct = f1 == null ? 0 : Math.round(f1 * 100);
              return (
                <div key={`${v.id}-${v.version}`} className="vaccine-row">
                  <div className="vaccine-id">{v.id} <span className="vaccine-ver">v{v.version}</span></div>
                  <div className="vaccine-strain">→ {v.strain}</div>
                  <div className="vaccine-bar-wrap">
                    <div className="vaccine-bar" style={{ width: `${pct}%` }} />
                    <div className="vaccine-bar-label">{f1 == null ? "uncertified" : `F1 ${f1.toFixed(2)}`}</div>
                  </div>
                  <div className="vaccine-counts">
                    {v.efficacy
                      ? `TP ${v.efficacy.tp} · FP ${v.efficacy.fp} · TN ${v.efficacy.tn} · FN ${v.efficacy.fn}`
                      : "no benchmark yet"}
                  </div>
                  <div className="vaccine-source">src={v.source}</div>
                </div>
              );
            })}
          </div>
        )}

        {tab === "feed" && (
          <div className="realtime-feed">
            <h3 className="lab-tab-title">📡 Realtime Feed — what live infection-catches look like</h3>
            {!stats || stats.recentScans.length === 0 ? (
              <div className="lab-empty-rich">
                <p className="lab-empty-headline">
                  {isLive
                    ? "No scans yet on this repo."
                    : "DEMO mode — this panel is empty because no real scans have run."}
                </p>
                <p className="lab-empty-sub">
                  When you run <code>mneme antivirus scan ai-draft.txt</code>, this feed lights up
                  with one row per AI claim that got checked, and a per-strain catch counter on the
                  left. Live mode looks like this:
                </p>
                <pre className="lab-empty-mock">{`Per-strain catches
  citatio_viridis      4    2026-05-10 14:23:01
  api_phantasma        2    2026-05-10 14:01:18
  depends_imaginarium  1    2026-05-10 13:55:42

Recent scans
  14:23:01   137 claims    4 caught    312ms
  14:01:18    89 claims    2 caught    198ms
  13:55:42    52 claims    1 caught    140ms`}</pre>
                <p className="lab-empty-sub">
                  Beehive analogy: each strain row is a cell in the hive. Catches are bees returning
                  with pollen the colony can study. The Cert Ledger (next tab) is the queen's record
                  of every certified vaccine.
                </p>
              </div>
            ) : (
              <>
                <div className="feed-by-strain">
                  <h3>Per-strain catches</h3>
                  {Object.entries(stats.byStrain).map(([id, slot]) => (
                    <div key={id} className="feed-strain-row">
                      <span className="feed-strain-name">{id}</span>
                      <span className="feed-strain-count">{slot.caught}</span>
                      <span className="feed-strain-last">{slot.lastCaughtAt ? new Date(slot.lastCaughtAt).toLocaleString() : "never"}</span>
                    </div>
                  ))}
                </div>
                <div className="feed-recent">
                  <h3>Recent scans</h3>
                  {stats.recentScans.slice().reverse().map((s) => (
                    <div key={s.scanId} className="feed-scan-row">
                      <span className="feed-scan-when">{new Date(s.ranAt).toLocaleTimeString()}</span>
                      <span className="feed-scan-claims">{s.claimsExamined} claims</span>
                      <span className="feed-scan-infections">{s.infections} caught</span>
                      <span className="feed-scan-time">{s.totalMs}ms</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {tab === "cert" && (
          <div className="cert-ledger">
            <h3 className="lab-tab-title">🛡 Cert Ledger — HMAC-signed vaccine efficacy proofs</h3>
            <p className="cert-intro">
              Every certified vaccine carries an HMAC-SHA256 signature over its
              benchmark result. Anyone can recompute the HMAC from
              <code> (vaccine_id, version, ranAt, totalCases, tp, tn, fp, fn) </code>
              keyed by the repo's <code>.mneme/antivirus/.bench-secret</code>.
              {!isLive && (
                <span className="cert-demo-callout">
                  &nbsp;<strong>DEMO mode:</strong> the table below shows seed vaccines with no
                  benchmark yet (signature column = "uncertified"). Run
                  <code> mneme antivirus benchmark</code> to populate real HMAC signatures.
                </span>
              )}
            </p>
            <table className="cert-table">
              <thead>
                <tr><th>Vaccine</th><th>Ran at</th><th>F1</th><th>Cases</th><th>Signature (first 16)</th></tr>
              </thead>
              <tbody>
                {vaccines.map((v) => (
                  <tr key={`${v.id}-${v.version}`}>
                    <td>{v.id}</td>
                    <td>{v.efficacy?.ranAt ? new Date(v.efficacy.ranAt).toLocaleString() : "—"}</td>
                    <td>{v.efficacy?.f1 == null ? "—" : v.efficacy.f1.toFixed(2)}</td>
                    <td>{v.efficacy ? v.efficacy.tp + v.efficacy.tn + v.efficacy.fp + v.efficacy.fn : "—"}</td>
                    <td className="cert-sig">{v.efficacy?.signature ? `${v.efficacy.signature.slice(0, 16)}…` : "uncertified"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="cert-footnote">
              No vaccine is shown as 100% efficacy unless every benchmark case passed -- honest measurement is the contract.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
