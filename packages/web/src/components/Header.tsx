import type { ViewMode } from "../types";
import { fmtDate } from "../lib/scrub";
import { FontSizePicker } from "./FontSizePicker";

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

// v1.26.2: hints rewritten in PLAIN ENGLISH (1-line, no jargon) so a
// non-engineer can understand what each menu is in under 5 seconds.
// The full multi-line explanation lives in <ViewExplainer/> below the
// header.
const VIEWS: Array<{ id: ViewMode; label: string; symbol: string; hint: string }> = [
  { id: "graph",      label: "Nervous System", symbol: "✦",   hint: "Map of who knows what in your repo." },
  { id: "atrophy",    label: "Atrophy",        symbol: "⏳",  hint: "Files where the original author is gone or hasn't touched it in a long time." },
  { id: "influence",  label: "Influence",      symbol: "♛",   hint: "Who actually moves the codebase — ranked by code still alive in HEAD." },
  { id: "ecosystems", label: "Ecosystems",     symbol: "🧬",  hint: "Frameworks/libraries your repo uses — and the MCP tools Mneme spawns for each." },
  { id: "dna",        label: "Code Search",    symbol: "🎯",  hint: "Search code by meaning, not keywords (16-strand DNA engine)." },
  { id: "scrubber",   label: "Scrubber",       symbol: "🧼",  hint: "Live prompt-injection defence — paste hostile text, watch it get neutralised." },
  { id: "antivirus",  label: "Antivirus Lab",  symbol: "💉",  hint: "Catches AI hallucinations (phantom commits, ghost functions, fake packages) before they merge." },
  { id: "retrieval",  label: "Retrieval Lab",  symbol: "🧪",  hint: "Self-tuning RAG — Mneme tries multiple search configs and picks the best one for your repo." },
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
        {synthetic && (
          <span
            className="synthetic-pill"
            title="This is seed/synthetic data, NOT your repo. Click 'Load my repo' to render real numbers."
          >
            ◉ DEMO DATA — not your repo
          </span>
        )}
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
        <FontSizePicker />
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
