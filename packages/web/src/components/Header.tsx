import type { ViewMode } from "../types";
import { fmtDate } from "../lib/scrub";

interface HeaderProps {
  repoName: string;
  generatedAt: string | null;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  onLoadClick: () => void;
  synthetic: boolean;
}

const VIEWS: Array<{ id: ViewMode; label: string; symbol: string; hint: string }> = [
  { id: "graph", label: "Nervous System", symbol: "✦", hint: "Force-directed graph of authors and latent collaboration" },
  { id: "atrophy", label: "Atrophy", symbol: "⏳", hint: "Files × authors knowledge heatmap" },
  { id: "influence", label: "Influence", symbol: "♛", hint: "PageRank ladder of cultural alphas" },
];

export function Header({
  repoName,
  generatedAt,
  view,
  onViewChange,
  onLoadClick,
  synthetic,
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
        <button className="btn-ghost" onClick={onLoadClick} title="Load demo, drop a file, or paste a URL">
          Load
        </button>
        <a
          className="btn-ghost"
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
