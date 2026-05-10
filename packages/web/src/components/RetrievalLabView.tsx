/**
 * RetrievalLabView -- self-tuning retrieval dashboard.
 *
 * Three sections:
 *   1. Active Config card -- which arm is currently winning + key stats
 *   2. Leaderboard table -- every arm + trial count + composite + UCB1
 *   3. Pareto frontier scatter -- composite vs latency tradeoff
 *   4. Cert ledger -- HMAC-signed trial signatures (anyone can re-verify)
 */

import { useState, useMemo } from "react";
import { DataModeBadge } from "./DataModeBadge";

interface RetrievalConfigSeed {
  id: string; label: string; embedder: string; rrfK: number;
  semanticWeight: number; reranker: string; useHyDE: boolean; candidateK: number;
}

interface LeaderboardSeed {
  configId: string;
  config: RetrievalConfigSeed;
  trialCount: number;
  meanComposite: number;
  ucb1: number;
  meanPrecisionAtK: number;
  meanRecallAtK: number;
  meanNdcgAtK: number;
  meanLatencyMs: number;
  lastTriedAt: string;
}

const SEED_CONFIGS: RetrievalConfigSeed[] = [
  { id: "bge-small-rrf60", label: "BGE-small + RRF k=60 (baseline)", embedder: "bundled-bge-small", rrfK: 60, semanticWeight: 0.65, reranker: "noop", useHyDE: false, candidateK: 50 },
  { id: "bge-small-rrf60-density", label: "BGE-small + term-density rerank", embedder: "bundled-bge-small", rrfK: 60, semanticWeight: 0.65, reranker: "term-density", useHyDE: false, candidateK: 50 },
  { id: "bge-small-rrf60-cross", label: "BGE-small + cross-encoder rerank", embedder: "bundled-bge-small", rrfK: 60, semanticWeight: 0.65, reranker: "cross-encoder-bge-base", useHyDE: false, candidateK: 50 },
  { id: "bge-small-rrf60-hyde-cross", label: "BGE-small + HyDE + cross-encoder", embedder: "bundled-bge-small", rrfK: 60, semanticWeight: 0.65, reranker: "cross-encoder-bge-base", useHyDE: true, candidateK: 50 },
  { id: "bge-small-rrf30-cross", label: "BGE-small + RRF k=30 + cross-encoder", embedder: "bundled-bge-small", rrfK: 30, semanticWeight: 0.7, reranker: "cross-encoder-bge-base", useHyDE: false, candidateK: 80 },
  { id: "bge-m3-rrf60-cross", label: "BGE-M3 + cross-encoder (multilingual)", embedder: "bundled-bge-m3", rrfK: 60, semanticWeight: 0.7, reranker: "cross-encoder-bge-base", useHyDE: false, candidateK: 50 },
  { id: "bge-m3-rrf60-hyde-cross", label: "BGE-M3 + HyDE + cross-encoder (premium)", embedder: "bundled-bge-m3", rrfK: 60, semanticWeight: 0.75, reranker: "cross-encoder-bge-base", useHyDE: true, candidateK: 80 },
  { id: "voyage3-rrf60-cohere", label: "voyage-3 + Cohere rerank (paid)", embedder: "voyage-3", rrfK: 60, semanticWeight: 0.8, reranker: "cohere-rerank-3", useHyDE: false, candidateK: 100 },
];

interface RetrievalLabViewProps {
  liveLeaderboard?: LeaderboardSeed[];
  liveActive?: string;
  liveTotalTrials?: number;
  /** v1.27.1: explicit repo-data signal so badge can distinguish demo-repo from your-repo. */
  syntheticRepo?: boolean;
  liveMode?: boolean;
  liveSource?: string;
}

export function RetrievalLabView(props: RetrievalLabViewProps) {
  const [tab, setTab] = useState<"leaderboard" | "pareto" | "configs">("leaderboard");
  const isLive = !!props.liveLeaderboard;
  const entries: LeaderboardSeed[] = props.liveLeaderboard ?? SEED_CONFIGS.map((c) => ({
    configId: c.id, config: c, trialCount: 0, meanComposite: 0,
    ucb1: Number.POSITIVE_INFINITY, meanPrecisionAtK: 0, meanRecallAtK: 0,
    meanNdcgAtK: 0, meanLatencyMs: 0, lastTriedAt: "",
  }));
  const active = props.liveActive ?? "bge-small-rrf60";
  const totalTrials = props.liveTotalTrials ?? 0;

  const sorted = useMemo(() => {
    return [...entries].sort((a, b) => {
      // Untried first (UCB1=Infinity), then by mean composite desc.
      if (a.trialCount === 0 && b.trialCount > 0) return -1;
      if (b.trialCount === 0 && a.trialCount > 0) return 1;
      return b.meanComposite - a.meanComposite;
    });
  }, [entries]);

  const activeEntry = entries.find((e) => e.configId === active);

  // Pareto frontier (only entries with trials)
  const pareto = useMemo(() => {
    const tried = entries.filter((e) => e.trialCount > 0);
    return new Set(
      tried.filter((a) =>
        !tried.some((b) =>
          b !== a && b.meanComposite >= a.meanComposite && b.meanLatencyMs <= a.meanLatencyMs &&
          (b.meanComposite > a.meanComposite || b.meanLatencyMs < a.meanLatencyMs),
        ),
      ).map((e) => e.configId),
    );
  }, [entries]);

  return (
    <div className="retrieval-lab antivirus-lab">
      <div className="lab-header">
        <h2>🧪 Mneme Retrieval Lab</h2>
        <p className="lab-tagline">
          Self-tuning RAG: tries multiple search configs in the background and picks the best one for YOUR repo.
          &nbsp;
          <DataModeBadge
            syntheticRepo={!!props.syntheticRepo}
            liveMode={!!props.liveMode}
            liveSource={props.liveSource}
            featureHasData={isLive && totalTrials > 0}
            featureLabel="retrieval trials"
          />
        </p>
        {(!isLive || totalTrials === 0) && (
          <p className="lab-hero">
            <strong>What this is:</strong> most RAG systems pick one search config and freeze it.
            Mneme runs 8 candidate arms (different embedder × reranker × HyDE × RRF k × weight combos)
            and uses UCB1 multi-armed bandit to keep trying — so your retrieval gets better the more
            you use it.
            <br />
            <strong>How to use on YOUR repo:</strong> from your terminal run <code>mneme retrieval tune --rounds 3</code> —
            this seeds real trials AGAINST YOUR REPO's content. Then any <code>mneme.search()</code>
            tool call uses the winning config.
            <br />
            <strong>Numbers below:</strong> 8 seed configs from the bundled registry. Composite /
            P / R / NDCG / Latency = 0 because no trials have run on this repo yet (UCB1 = ∞ means
            "untried — try me first"). {props.liveMode
              ? "These configs are illustrative ONLY -- the columns will fill in real numbers AFTER you run `mneme retrieval tune`."
              : "When you load your real repo + run `mneme retrieval tune`, these columns fill with measurements from YOUR data."}
          </p>
        )}
        <div className="lab-summary-strip">
          <div className="lab-stat"><div className="lab-stat-num">{entries.length}</div><div className="lab-stat-label">candidate arms</div></div>
          <div className="lab-stat"><div className="lab-stat-num">{totalTrials}</div><div className="lab-stat-label">total trials</div></div>
          <div className="lab-stat"><div className="lab-stat-num">{pareto.size}</div><div className="lab-stat-label">on Pareto frontier</div></div>
          {activeEntry && (
            <>
              <div className="lab-stat">
                <div className="lab-stat-num">{activeEntry.meanComposite.toFixed(2)}</div>
                <div className="lab-stat-label">active composite</div>
              </div>
              <div className="lab-stat">
                <div className="lab-stat-num">{Math.round(activeEntry.meanLatencyMs)}ms</div>
                <div className="lab-stat-label">active latency</div>
              </div>
            </>
          )}
        </div>
        {activeEntry && (
          <div className="active-config-card">
            <div className="active-config-id">Active: <code>{activeEntry.configId}</code></div>
            <div className="active-config-label">{activeEntry.config.label}</div>
            <div className="active-config-detail">
              embedder=<code>{activeEntry.config.embedder}</code> ·
              reranker=<code>{activeEntry.config.reranker}</code> ·
              HyDE=<code>{String(activeEntry.config.useHyDE)}</code> ·
              RRF k=<code>{activeEntry.config.rrfK}</code> ·
              candidateK=<code>{activeEntry.config.candidateK}</code>
            </div>
          </div>
        )}
      </div>

      <nav className="lab-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "leaderboard"} className={tab === "leaderboard" ? "active" : ""} onClick={() => {
          setTab("leaderboard");
          requestAnimationFrame(() => { try { document.querySelector(".lab-body")?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch { /* */ } });
        }}>🏆 Leaderboard</button>
        <button role="tab" aria-selected={tab === "pareto"} className={tab === "pareto" ? "active" : ""} onClick={() => {
          setTab("pareto");
          requestAnimationFrame(() => { try { document.querySelector(".lab-body")?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch { /* */ } });
        }}>📐 Pareto Frontier</button>
        <button role="tab" aria-selected={tab === "configs"} className={tab === "configs" ? "active" : ""} onClick={() => {
          setTab("configs");
          requestAnimationFrame(() => { try { document.querySelector(".lab-body")?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch { /* */ } });
        }}>⚙ All Configs</button>
      </nav>

      <div className="lab-body">
        {tab === "leaderboard" && (
          <>
            <h3 className="lab-tab-title">🏆 Leaderboard — every candidate arm + how many trials it's run</h3>
            {!isLive && totalTrials === 0 && (
              <div className="lab-empty-rich">
                <p className="lab-empty-headline">DEMO mode — every arm shows 0 trials.</p>
                <p className="lab-empty-sub">
                  The composite, precision, recall, NDCG, and latency columns are all 0 because no
                  retrieval trials have been run on this demo. The UCB1 column shows <code>∞</code>
                  for every untried arm — that's the algorithm saying "try me first; I have no
                  data yet".
                </p>
                <p className="lab-empty-sub">
                  Live mode looks like this — actual numbers appear after each trial:
                </p>
                <pre className="lab-empty-mock">{`Rank  Config                          Trials  Composite  P     R     NDCG  Latency  UCB1
1     bge-m3-rrf60-hyde-cross         42      0.834      0.79  0.81  0.86  187ms    1.234
2     bge-small-rrf60-cross           38      0.812      0.78  0.79  0.83  142ms    1.205
3     bge-small-rrf60                 35      0.795      0.74  0.79  0.81  98ms     1.187`}</pre>
                <p className="lab-empty-sub">
                  Run <code>mneme retrieval tune --rounds 3</code> from your terminal — UCB1 picks
                  the most-promising untried arm, runs a trial, folds the result back in.
                </p>
              </div>
            )}
            <table className="cert-table">
              <thead>
                <tr>
                  <th>Rank</th><th>Config</th><th>Trials</th><th>Composite</th><th>P</th><th>R</th><th>NDCG</th><th>Latency</th><th>UCB1</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((e, i) => (
                  <tr key={e.configId} className={e.configId === active ? "active-row" : ""}>
                    <td>{i + 1}</td>
                    <td><code>{e.configId}</code> {pareto.has(e.configId) ? <span className="pareto-tag">Pareto</span> : null}</td>
                    <td>{e.trialCount}</td>
                    <td><strong>{e.meanComposite.toFixed(3)}</strong></td>
                    <td>{e.meanPrecisionAtK.toFixed(2)}</td>
                    <td>{e.meanRecallAtK.toFixed(2)}</td>
                    <td>{e.meanNdcgAtK.toFixed(2)}</td>
                    <td>{Math.round(e.meanLatencyMs)}ms</td>
                    <td>{e.ucb1 === Number.POSITIVE_INFINITY ? "∞" : e.ucb1.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {tab === "pareto" && (
          <div className="pareto-scatter">
            <h3 className="lab-tab-title">📐 Pareto Frontier — quality vs latency tradeoff</h3>
            <p className="cert-intro">
              Pareto frontier: configs that are not dominated on (composite quality, latency).
              <strong> Right-down is best.</strong> Configs on the frontier represent the best
              tradeoffs the auto-tuner has discovered.
            </p>
            {!isLive && totalTrials === 0 ? (
              <div className="lab-empty-rich">
                <p className="lab-empty-headline">DEMO mode — no scatter to draw.</p>
                <p className="lab-empty-sub">
                  The Pareto frontier needs at least 2 trial results before it can rank anything.
                  Once <code>mneme retrieval tune --rounds 3</code> has run, this panel shows a
                  scatter plot: <strong>X-axis = mean latency</strong> (ms),
                  <strong> Y-axis = composite quality</strong>. Every dot is one arm. Connected dots
                  on the bottom-right form the Pareto frontier — the configs that are
                  Pareto-optimal (no other config beats them on both axes simultaneously).
                </p>
                <p className="lab-empty-sub">
                  Why this matters: a config that scores 0.92 quality at 800ms is sometimes a worse
                  choice than 0.85 at 200ms — depends on your latency budget. Pareto lets you see
                  ALL the good tradeoffs at once.
                </p>
              </div>
            ) : (
              <ParetoChart entries={entries} pareto={pareto} active={active} />
            )}
          </div>
        )}

        {tab === "configs" && (
          <>
            <h3 className="lab-tab-title">⚙ All Configs — every candidate arm Mneme can try</h3>
            <p className="cert-intro">
              Eight bundled configs span the dimensions Mneme tunes over: embedder model
              (<code>bundled-bge-small</code>, <code>bge-m3</code>, paid <code>voyage-3</code>),
              reranker (<code>noop</code>, <code>term-density</code>, <code>cross-encoder-bge-base</code>,
              paid <code>cohere-rerank-3</code>), HyDE on/off, RRF k, and candidate-K.
              Add custom arms by editing <code>.mneme/retrieval/configs.json</code>.
            </p>
            <div className="pharmacopoeia">
              {SEED_CONFIGS.map((c) => (
                <div key={c.id} className="vaccine-row">
                  <div className="vaccine-id">{c.id}</div>
                  <div className="vaccine-strain">{c.label}</div>
                  <div className="vaccine-counts">
                    embedder=<code>{c.embedder}</code> RRF=<code>{c.rrfK}</code> sw=<code>{c.semanticWeight}</code><br/>
                    rerank=<code>{c.reranker}</code> hyde=<code>{String(c.useHyDE)}</code> candK=<code>{c.candidateK}</code>
                  </div>
                  <div className="vaccine-source">arm</div>
                  <div className="vaccine-source"></div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ParetoChart({ entries, pareto, active }: { entries: LeaderboardSeed[]; pareto: Set<string>; active: string }) {
  const tried = entries.filter((e) => e.trialCount > 0);
  if (tried.length === 0) {
    return <div className="empty-state">No trials yet — start the daemon (`mneme nucleus daemon --detach`) and points will appear within ~15 minutes.</div>;
  }
  const W = 600, H = 340;
  const padL = 50, padR = 12, padT = 12, padB = 36;
  const xMax = Math.max(...tried.map((e) => e.meanLatencyMs), 600);
  const yMax = 1.0;
  const xScale = (v: number) => padL + ((W - padL - padR) * v) / xMax;
  const yScale = (v: number) => H - padB - ((H - padT - padB) * v) / yMax;
  return (
    <svg width={W} height={H} className="pareto-svg" style={{ maxWidth: "100%", display: "block", margin: "0 auto" }}>
      {/* axes */}
      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="rgba(255,255,255,0.2)" />
      <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="rgba(255,255,255,0.2)" />
      <text x={W / 2} y={H - 8} fill="rgba(232,232,255,0.7)" fontSize="12" textAnchor="middle">Latency (ms) -- lower is better</text>
      <text x={14} y={H / 2} fill="rgba(232,232,255,0.7)" fontSize="12" textAnchor="middle" transform={`rotate(-90, 14, ${H / 2})`}>Composite score -- higher is better</text>
      {tried.map((e) => {
        const onPareto = pareto.has(e.configId);
        const isActive = e.configId === active;
        const x = xScale(e.meanLatencyMs);
        const y = yScale(e.meanComposite);
        return (
          <g key={e.configId}>
            <circle cx={x} cy={y} r={isActive ? 8 : onPareto ? 6 : 4}
              fill={isActive ? "#34d399" : onPareto ? "#c084fc" : "rgba(56,189,248,0.5)"}
              stroke={isActive ? "#34d399" : "rgba(255,255,255,0.6)"} strokeWidth={isActive ? 2 : 1} />
            <title>{e.configId} -- composite {e.meanComposite.toFixed(3)}, lat {Math.round(e.meanLatencyMs)}ms ({e.trialCount} trials)</title>
          </g>
        );
      })}
    </svg>
  );
}
