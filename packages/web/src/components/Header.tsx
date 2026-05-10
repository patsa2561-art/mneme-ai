import type { ViewMode } from "../types";
import { fmtDate } from "../lib/scrub";

interface HeaderProps {
  repoName: string;
  generatedAt: string | null;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  onLoadClick: () => void;
  onHelpClick: () => void;
  synthetic: boolean;
  liveMode?: boolean;
  liveSource?: string;
}

const VIEWS: Array<{ id: ViewMode; label: string; symbol: string; hint: string }> = [
  { id: "graph", label: "Nervous System", symbol: "✦", hint: "Force-directed graph of authors and latent collaboration" },
  { id: "atrophy", label: "Atrophy", symbol: "⏳", hint: "Files × authors knowledge heatmap" },
  { id: "influence", label: "Influence", symbol: "♛", hint: "PageRank ladder of cultural alphas" },
  { id: "ecosystems", label: "Ecosystems", symbol: "🧬", hint: "Per-repo MCP tools spawned by ecosystem detection" },
  { id: "dna", label: "Code Search (DNA)", symbol: "🎯", hint: "Ghost-Sniper Verifier — strict-mode 16-strand search" },
  { id: "scrubber", label: "Scrubber", symbol: "🧼", hint: "Live prompt-injection defence — paste hostile text, see scrubbed" },
  { id: "antivirus", label: "Antivirus Lab", symbol: "🧬", hint: "Mneme Vaccine Lab — strain atlas, pharmacopoeia, realtime infection feed" },
  { id: "retrieval", label: "Retrieval Lab", symbol: "🎯", hint: "Self-tuning RAG — UCB1 leaderboard, Pareto frontier, cross-encoder + HyDE + multi-embedder configs" },
];

export function Header({
  repoName,
  generatedAt,
  view,
  onViewChange,
  onLoadClick,
  onHelpClick,
  synthetic,
  liveMode,
  liveSource,
}: HeaderProps) {
  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-glyph">μνήμη</span>
        <span className="brand-sep">·</span>
        <span className="brand-name">Mneme</span>
        <span className="brand-tag">The Nervous System</span>
      </div>

      <div className="repo-meta" title={generatedAt ? `Generated ${generatedAt}` : ""}>
        <span className="repo-name">{repoName}</span>
        {generatedAt && (
          <span className="repo-stamp">
            generated {fmtDate(Date.parse(generatedAt))}
          </span>
        )}
        {synthetic && <span className="synthetic-pill">synthetic demo</span>}
        {liveMode && (
          <span
            className="live-pill"
            title={`Data fetched in-browser from the ${liveSource ?? "git"} REST API. File-level expertise + atrophy heatmap require the local CLI for full insight.`}
          >
            ● LIVE · {liveSource ?? "git"} API
          </span>
        )}
      </div>

      <nav className="view-tabs" role="tablist" aria-label="Views">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={view === v.id}
            title={v.hint}
            className={`view-tab ${view === v.id ? "active" : ""}`}
            onClick={() => onViewChange(v.id)}
          >
            <span aria-hidden className="view-tab-glyph">{v.symbol}</span>
            <span className="view-tab-label">{v.label}</span>
          </button>
        ))}
      </nav>

      <div className="header-actions">
        <a
          className="version-pill"
          href={`https://github.com/patsa2561-art/mneme-ai/releases/tag/v${__APP_VERSION__}`}
          target="_blank"
          rel="noopener"
          title={`Mneme dashboard v${__APP_VERSION__} — open release notes on GitHub`}
        >
          v{__APP_VERSION__}
        </a>
        <button
          className="btn-primary load-cta"
          onClick={onLoadClick}
          title="Load demo, drop a file, or paste a URL"
        >
          <span aria-hidden>📥</span> Load my repo
        </button>
        <button
          className="btn-ghost help-btn"
          onClick={onHelpClick}
          title="What is this? — show the welcome guide"
          aria-label="Show welcome guide"
        >
          ?
        </button>
        <a
          className="btn-ghost github-btn"
          href="https://github.com/patsa2561-art/mneme-ai"
          target="_blank"
          rel="noopener"
        >
          GitHub
        </a>
      </div>
    </header>
  );
}
