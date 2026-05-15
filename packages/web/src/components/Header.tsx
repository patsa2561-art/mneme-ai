import { useState } from "react";
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
//
// v2.15.2: views are grouped into 4 categories so the nav doesn't
// overwhelm first-time visitors. Customer feedback: "9 tabs is too many,
// I don't know what to click." Solution: 4 group pills + the active tab
// inside each group exposed inline. Power users can still jump anywhere
// via the View dropdown next to the group pill.
const VIEWS: Array<{ id: ViewMode; label: string; symbol: string; hint: string; group: ViewGroup }> = [
  // Overview
  { id: "demon",      label: "Demon Stack",    symbol: "🛡️",  hint: "World's first prevent-before MCP. Live PRECOG firewall + all 6 protocols (v1.65-v1.70).", group: "overview" },
  // Memory
  { id: "graph",      label: "Nervous System", symbol: "✦",   hint: "Who is the expert on X? Map who knows what in your repo from real git history.", group: "memory" },
  { id: "dna",        label: "Code Search",    symbol: "🎯",  hint: "I know what I want but not the keyword. Meaning-based search (16-strand DNA).", group: "memory" },
  { id: "ecosystems", label: "Ecosystems",     symbol: "🧬",  hint: "Which MCP tools should I install? Mneme picks tools by libraries your repo actually uses.", group: "memory" },
  { id: "influence",  label: "Influence",      symbol: "♛",   hint: "Who really moves this codebase? Ranked by code still alive in HEAD, not commit count.", group: "memory" },
  // Labs
  { id: "scrubber",   label: "Scrubber",       symbol: "🧼",  hint: "Prompt injection in pasted content. Paste hostile text, watch it get neutralised live.", group: "labs" },
  { id: "antivirus",  label: "Antivirus Lab",  symbol: "💉",  hint: "AI fabricates commits / functions / packages. Catches 8 hallucination strains before merge.", group: "labs" },
  { id: "retrieval",  label: "Retrieval Lab",  symbol: "🧪",  hint: "RAG quality varies. Mneme tries multiple search configs and picks the best per repo.", group: "labs" },
  // History
  { id: "atrophy",    label: "Atrophy",        symbol: "⏳",  hint: "Bus factor / orphaned code. Files where the original author left or hasn't touched in months.", group: "history" },
];

type ViewGroup = "overview" | "memory" | "labs" | "history";

const GROUPS: Array<{ id: ViewGroup; label: string; symbol: string; hint: string }> = [
  { id: "overview",  label: "Overview",  symbol: "🛡️", hint: "Demon Stack — world-first prevent-before MCP layer." },
  { id: "memory",    label: "Memory",    symbol: "🧠", hint: "Nervous System / Code Search / Ecosystems / Influence." },
  { id: "labs",      label: "Labs",      symbol: "🧪", hint: "Scrubber / Antivirus / Retrieval — interactive demos." },
  { id: "history",   label: "History",   symbol: "⏳", hint: "Atrophy heatmap — knowledge decay over time." },
];

function groupOf(id: ViewMode): ViewGroup {
  return VIEWS.find((v) => v.id === id)?.group ?? "overview";
}

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

      <nav className="view-tabs" role="tablist" aria-label="Views" style={{ flexWrap: "wrap", gap: 6 }}>
        {/* v2.15.2: 4 group pills first; clicking a group jumps to its
            default view + reveals sub-views inline. Reduces 9 confusing
            tabs to 4 + an opt-in detail row. */}
        {GROUPS.map((g) => {
          const inThisGroup = groupOf(view) === g.id;
          const groupViews = VIEWS.filter((v) => v.group === g.id);
          return (
            <div key={g.id} style={{ display: "inline-flex", alignItems: "center" }}>
              <button
                role="tab"
                aria-selected={inThisGroup}
                title={g.hint}
                className={`view-tab ${inThisGroup ? "active" : ""}`}
                onClick={() => {
                  // Jump to first view of this group (or stay if already there)
                  if (!inThisGroup && groupViews[0]) onViewChange(groupViews[0].id);
                }}
              >
                <span aria-hidden className="view-tab-glyph">{g.symbol}</span>
                <span className="view-tab-label">{g.label}</span>
                {groupViews.length > 1 && <span style={{ opacity: 0.5, marginLeft: 6, fontSize: "0.8em" }}>({groupViews.length})</span>}
              </button>
              {/* Inline sub-pills for the active group only */}
              {inThisGroup && groupViews.length > 1 && (
                <span style={{ display: "inline-flex", gap: 4, marginLeft: 8, paddingLeft: 8, borderLeft: "1px solid rgba(255,255,255,0.15)" }}>
                  {groupViews.map((v) => (
                    <button
                      key={v.id}
                      role="tab"
                      aria-selected={view === v.id}
                      title={v.hint}
                      onClick={() => onViewChange(v.id)}
                      style={{
                        background: view === v.id ? "rgba(243, 128, 32, 0.2)" : "transparent",
                        color: view === v.id ? "#f7d34c" : "#9ba1a6",
                        border: view === v.id ? "1px solid #f38020" : "1px solid transparent",
                        borderRadius: 6,
                        padding: "4px 10px",
                        fontSize: "0.85em",
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {v.symbol} {v.label}
                    </button>
                  ))}
                </span>
              )}
            </div>
          );
        })}
        {/* "Back to README" escape hatch */}
        <button
          onClick={() => { window.location.hash = ""; window.location.reload(); }}
          title="Back to the clean landing page"
          style={{
            background: "transparent", border: "1px solid #3a3a4a",
            color: "#79c0ff", borderRadius: 6, padding: "6px 12px",
            fontSize: "0.85em", cursor: "pointer", marginLeft: 8, fontFamily: "inherit",
          }}
        >
          ← README
        </button>
      </nav>

      <div className="header-actions">
        <FontSizePicker />
        {/* v2.17.1: TH/EN toggle (shared localStorage key with ReadmePage) */}
        <DashboardLangToggle />
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

// v2.17.1: TH/EN toggle for the dashboard. Reads/writes the same
// `mneme-lang` localStorage key as the ReadmePage so the user's
// language preference is consistent across landing + dashboard.
function DashboardLangToggle() {
  const [lang, setLang] = useState<"en" | "th">(() => {
    try {
      const v = localStorage.getItem("mneme-lang");
      if (v === "th" || v === "en") return v;
      return /^th/i.test(navigator.language || "") ? "th" : "en";
    } catch { return "en"; }
  });
  function set(next: "en" | "th") {
    setLang(next);
    try {
      localStorage.setItem("mneme-lang", next);
      // The dashboard views are mostly English-only today; setting the
      // key still makes the README + AI banner respect the choice.
      // Reload so any view that reads the key on mount picks it up.
      window.dispatchEvent(new CustomEvent("mneme-lang-change", { detail: next }));
    } catch {}
  }
  const baseStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.05)",
    color: "#a1a1aa",
    border: "1px solid rgba(255,255,255,0.1)",
    padding: "4px 10px",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: "0.8em",
    fontFamily: "inherit",
    fontWeight: 600,
    letterSpacing: "0.05em",
  };
  const activeStyle: React.CSSProperties = {
    ...baseStyle,
    background: "linear-gradient(135deg, #f38020 0%, #ec4899 100%)",
    color: "#0a0a0e",
    border: "1px solid transparent",
  };
  return (
    <div style={{ display: "inline-flex", gap: 4, marginRight: 8 }} title="Switch language (TH/EN). Saved to localStorage.">
      <button onClick={() => set("en")} style={lang === "en" ? activeStyle : baseStyle} aria-pressed={lang === "en"}>EN</button>
      <button onClick={() => set("th")} style={lang === "th" ? activeStyle : baseStyle} aria-pressed={lang === "th"}>TH</button>
    </div>
  );
}
