import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NervousSystemData, PassportData, ViewMode } from "./types";
import { Header } from "./components/Header";
import { TimeScrubber } from "./components/TimeScrubber";
import { NervousSystemView } from "./components/NervousSystemView";
import { AtrophyHeatmap } from "./components/AtrophyHeatmap";
import { InfluenceLadder } from "./components/InfluenceLadder";
import { EcosystemsView } from "./components/EcosystemsView";
import { DnaView } from "./components/DnaView";
import { ScrubberView } from "./components/ScrubberView";
import { AntivirusLabView } from "./components/AntivirusLabView";
import { RetrievalLabView } from "./components/RetrievalLabView";
import { AiPolygraphView } from "./components/AiPolygraphView";
import { WorldPulseView } from "./components/WorldPulseView";
import { DemonStackView } from "./components/DemonStackView";
import { DetailPanel } from "./components/DetailPanel";
// LimitsPanel + LiveWisdomPanel moved into MetricsTopBar (v1.19.3).
import { GraphWisdomPanel } from "./components/GraphWisdomPanel";
import { WisdomDrawer, WisdomAccordion } from "./components/WisdomDrawer";
import { MetricsTopBar } from "./components/MetricsTopBar";
import { LoadDialog } from "./components/LoadDialog";
import { WelcomeOverlay } from "./components/WelcomeOverlay";
import { ToastStack, type Toast } from "./components/Toast";
import { ViewExplainer } from "./components/ViewExplainer";
import { ReadmePage } from "./components/ReadmePage";
import { computeTimeBounds, scrubData } from "./lib/scrub";

// v1.26.2: per-view "what's new since v1.24" callouts shown inside the
// ViewExplainer strip, so users can see the latest features without
// hunting through the changelog.
const VIEW_CALLOUTS: Partial<Record<ViewMode, string[]>> = {
  ecosystems: [
    "v1.25.0 GraphRAG: file-to-community detection picks the right MCP tool slice for your query",
    "v1.25.1 Late-chunking embedder (MNEME_LATE_CHUNKING=1) for cross-chunk context",
  ],
  antivirus: [
    "v1.24.0 ANTIVIRUS: world's first MCP server with hallucination antiviral",
    "v1.24.1 Vaccine bug fixed; HMAC-signed efficacy benchmarks",
  ],
  retrieval: [
    "v1.25.0 UCB1 multi-armed bandit picks best retrieval config per query",
    "v1.25.1 Cross-encoder reranker + HyDE + multi-embedder + warmup",
    "v1.25.2 Pulse + hooks installer (and v1.26.1 fixed broken Claude Code hook schema)",
  ],
  graph: [
    "v1.26.0 12-path autonomy bridge: Mneme can now reach you outside the AI client",
  ],
};

const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "") + "/";

function readOnboarded(): boolean {
  try {
    return window.localStorage.getItem("mneme-onboarded") === "true";
  } catch {
    return false;
  }
}

function readShowReadme(): boolean {
  // v2.15.2: README landing is the default for ALL visitors — no more
  // sticky opt-out. Power users opt into the dashboard via #dashboard
  // hash; the choice is per-session not per-machine. This fixes a bug
  // where a one-time "Launch dashboard" click in v2.14 stuck users on
  // the dashboard even after we shipped a much better README in v2.15.
  try {
    // v2.19.79 — accept ANY known view-hash as a bypass-README signal.
    // Pre-fix only "#dashboard" worked, which meant deep-links like
    // "#polygraph" silently dropped the user on the README + the new
    // view was unreachable without an extra click.
    const VIEW_HASHES = new Set([
      "#dashboard",
      "#demon", "#graph", "#atrophy", "#influence",
      "#ecosystems", "#dna", "#scrubber",
      "#antivirus", "#retrieval", "#polygraph", "#pulse",
    ]);
    if (VIEW_HASHES.has(window.location.hash)) return false;
    // Clean up the legacy v2.14 sticky preference so users get the new
    // README the first time they visit after the upgrade.
    window.localStorage.removeItem("mneme-show-readme");
    return true;
  } catch { return true; }
}

/** v2.19.79 — pick the initial view from the URL hash so deep-links
 *  like `#polygraph` land the user on the right tab instead of the
 *  default "demon" view.  Falls back to "demon" for unknown hashes. */
function initialViewFromHash(): ViewMode {
  try {
    const h = (window.location.hash || "").replace(/^#/, "").trim();
    const known: readonly ViewMode[] = [
      "demon", "graph", "atrophy", "influence",
      "ecosystems", "dna", "scrubber",
      "antivirus", "retrieval", "polygraph", "pulse",
    ];
    if ((known as readonly string[]).includes(h)) return h as ViewMode;
    return "demon";
  } catch { return "demon"; }
}

export function App() {
  const [raw, setRaw] = useState<NervousSystemData | null>(null);
  const [scrubT, setScrubT] = useState<number>(Date.now());
  // v2.14: README first; dashboard is the deep-dive escape hatch.
  const [showReadme, setShowReadme] = useState<boolean>(() => readShowReadme());
  // v1.70 -- default to "demon" (the headline new view) so first-time
  // visitors see PRECOG firewall + protocol stack before anything else.
  const [view, setView] = useState<ViewMode>(() => initialViewFromHash());
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [loadOpen, setLoadOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState<boolean>(() => !readOnboarded());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [highlightFile, setHighlightFile] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  // scrubTRef mirrors scrubT — read by the play loop so resume can start
  // from the current pause position without listing scrubT in the effect's
  // deps (which would re-run the loop on every tick).
  const scrubTRef = useRef<number>(scrubT);
  scrubTRef.current = scrubT;

  // v2.19.79 — hashchange listener so deep-links like #polygraph
  // work AFTER initial mount too (e.g. clicking the README hero CTA
  // that sets window.location.hash + then expects the dashboard to
  // navigate).  Without this, the hash changed but the view state
  // stayed pinned to its initial value, leaving the user on the
  // wrong tab after the README→dashboard handoff.
  useEffect(() => {
    function onHashChange(): void {
      const next = initialViewFromHash();
      setView(next);
      // If the user navigated to a known view-hash from the README
      // landing, also flip out of the README so they actually see it.
      const h = (window.location.hash || "").replace(/^#/, "").trim();
      if (h && h !== "readme") setShowReadme(false);
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // ─── load demo on first render ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const url = `${BASE}demo.json`;
        const res = await fetch(url, { cache: "no-cache" });
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
        const data = (await res.json()) as NervousSystemData;
        if (!cancelled) {
          setRaw(data);
          setScrubT(Date.now());
          pushToast(setToasts, {
            kind: "info",
            text: data._demo_synthetic
              ? "Loaded the synthetic demo. Drop your own JSON to render a real repo."
              : "Loaded the bundled demo.",
          });
        }
      } catch {
        // first-load failure is fine — the user can still drop a file
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── time bounds ──────────────────────────────────────────────────────
  const bounds = useMemo(() => computeTimeBounds(raw), [raw]);

  // Keep scrubT pinned to the latest bound when data changes.
  useEffect(() => {
    if (bounds) setScrubT(bounds.max);
  }, [bounds?.min, bounds?.max]);

  // ─── play / animate ───────────────────────────────────────────────────
  // 12-second timelapse spans the FULL repo window. When the user pauses
  // mid-play and presses ▶ again, resume from the current scrub position
  // and play out only the remaining slice — preserving the same overall
  // pace so a quick pause+resume looks continuous, and a resume from 80%
  // through finishes in 2.4s (not another full 12s).
  useEffect(() => {
    if (!playing || !bounds) return;
    const span = bounds.max - bounds.min;
    if (span <= 0) return;
    const FULL_DURATION_MS = 12_000;
    const origin = scrubTRef.current;
    // If we paused at (or past) the end, restart from the beginning.
    const fromMs = origin >= bounds.max ? bounds.min : origin;
    const remaining = bounds.max - fromMs;
    const duration = FULL_DURATION_MS * (remaining / span);
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const elapsed = now - start;
      const pct = Math.min(1, elapsed / duration);
      const t = fromMs + remaining * pct;
      setScrubT(t);
      if (pct < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        setPlaying(false);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, bounds?.min, bounds?.max]);

  // ─── derive what the views actually see (the "scrubbed" data) ─────────
  const scrubbed = useMemo(() => {
    if (!raw || !bounds) return null;
    return scrubData(raw, scrubT);
  }, [raw, scrubT, bounds]);

  const selectedPassport = useMemo<PassportData | null>(() => {
    if (!scrubbed || !selectedEmail) return null;
    return (
      scrubbed.passports.find(
        (p) => p.identity.email.toLowerCase() === selectedEmail.toLowerCase(),
      ) ?? null
    );
  }, [scrubbed, selectedEmail]);

  // ─── handlers ─────────────────────────────────────────────────────────
  const handleLoaded = useCallback((data: NervousSystemData, source: string) => {
    setRaw(data);
    setSelectedEmail(null);
    setHighlightFile(null);
    pushToast(setToasts, {
      kind: "success",
      text: `Loaded ${source} — ${data.meta.totalAuthors} authors · ${data.meta.totalCommits} commits.`,
    });
    setLoadOpen(false);
  }, []);

  const handleLoadError = useCallback((err: string) => {
    pushToast(setToasts, { kind: "error", text: err });
  }, []);

  // v2.15.2: README is the default. Dashboard is per-session via #dashboard
  // hash — no sticky preference (avoids the v2.14 bug where one click stuck
  // the user on the dashboard forever).
  if (showReadme) {
    return (
      <ReadmePage
        onLaunchDashboard={() => {
          try { window.location.hash = "#dashboard"; } catch {}
          setShowReadme(false);
        }}
      />
    );
  }

  return (
    <div className="app-root">
      <Header
        repoName={raw?.meta.repoName ?? "—"}
        generatedAt={raw?.meta.generatedAt ?? null}
        view={view}
        onViewChange={setView}
        onLoadClick={() => setLoadOpen(true)}
        onHelpClick={() => setWelcomeOpen(true)}
        synthetic={!!raw?._demo_synthetic}
        liveMode={!!raw?._liveMode}
        liveSource={raw?._liveSource}
        onReturnHome={() => {
          // v2.19.79 — click the logo to leave the dashboard +
          // return to the README front door.  Clear the deep-link
          // hash so a subsequent refresh lands on the README too.
          try { window.location.hash = ""; } catch { /* */ }
          setShowReadme(true);
        }}
      />

      {view === "graph" && (
        <TimeScrubber
          bounds={bounds}
          value={scrubT}
          onChange={setScrubT}
          playing={playing}
          onPlayToggle={() => setPlaying((p) => !p)}
        />
      )}

      {/* v1.26.2 — always-visible plain-English explanation of the
          active view, with prominent DEMO/LIVE indicator. Mounted above
          the metrics strip so users see "what is this menu" first. */}
      <ViewExplainer
        view={view}
        synthetic={!!raw?._demo_synthetic}
        liveMode={!!raw?._liveMode}
        liveSource={raw?._liveSource}
        callouts={VIEW_CALLOUTS[view]}
      />

      {/* v1.19.3 — Live metrics + caveats in a horizontal strip ABOVE the
          main content. Always visible, no scroll, no drawer to open. */}
      {raw && (
        <MetricsTopBar
          data={raw}
          limits={scrubbed?.limits ?? raw.limits ?? []}
        />
      )}

      <main className="app-main">
        {/* v1.19.1 — wisdom panel for the GRAPH lives in a left-side drawer
            (graph-only; live metrics + limits moved to MetricsTopBar above). */}
        {(() => {
          const showGraphWisdom = view === "graph" && scrubbed;
          if (!showGraphWisdom) return null;
          return (
            <WisdomDrawer panelCount={1} defaultOpen>
              <WisdomAccordion title="Why the graph looks like this" glyph="⌬" defaultOpen>
                <GraphWisdomPanel data={scrubbed} />
              </WisdomAccordion>
            </WisdomDrawer>
          );
        })()}
        <section className="app-canvas" aria-label={`${view} view`}>
          {view === "demon" ? (
            <DemonStackView />
          ) : view === "ecosystems" ? (
            <EcosystemsView
              data={raw ?? null}
              syntheticRepo={!!raw?._demo_synthetic}
              liveMode={!!raw?._liveMode}
              liveSource={raw?._liveSource}
            />
          ) : view === "dna" ? (
            <DnaView data={raw ?? null} />
          ) : view === "scrubber" ? (
            <ScrubberView />
          ) : view === "antivirus" ? (
            <AntivirusLabView
              syntheticRepo={!!raw?._demo_synthetic}
              liveMode={!!raw?._liveMode}
              liveSource={raw?._liveSource}
            />
          ) : view === "retrieval" ? (
            <RetrievalLabView
              syntheticRepo={!!raw?._demo_synthetic}
              liveMode={!!raw?._liveMode}
              liveSource={raw?._liveSource}
            />
          ) : view === "polygraph" ? (
            <AiPolygraphView />
          ) : view === "pulse" ? (
            <WorldPulseView />
          ) : !scrubbed ? (
            <EmptyState onLoadClick={() => setLoadOpen(true)} />
          ) : view === "graph" ? (
            <NervousSystemView
              data={scrubbed}
              selectedEmail={selectedEmail}
              onSelect={setSelectedEmail}
            />
          ) : view === "atrophy" ? (
            <AtrophyHeatmap
              data={scrubbed}
              highlightFile={highlightFile}
              onHighlightFile={setHighlightFile}
              onSelectAuthor={setSelectedEmail}
            />
          ) : (
            <InfluenceLadder
              data={scrubbed}
              selectedEmail={selectedEmail}
              onSelect={setSelectedEmail}
            />
          )}
        </section>

        {/* v1.27.1 -- the right-side detail panel only makes sense for
            views that have a "selected entity" (graph / atrophy / influence).
            Full-content lab views (antivirus / retrieval / ecosystems /
            scrubber / dna) get the full canvas width so dense tables and
            scatter plots aren't squished into a narrow column. */}
        {view !== "demon" && view !== "antivirus" && view !== "retrieval" && view !== "ecosystems" && view !== "scrubber" && view !== "dna" && (
          <aside className="app-detail" aria-label="Detail panel">
            <DetailPanel
              passport={selectedPassport}
              fallbackData={scrubbed}
              onClose={() => setSelectedEmail(null)}
            />
          </aside>
        )}
      </main>

      {/* Wisdom panels now live inside the left-side WisdomDrawer (above). */}

      {loadOpen && (
        <LoadDialog
          base={BASE}
          onClose={() => setLoadOpen(false)}
          onLoaded={handleLoaded}
          onError={handleLoadError}
        />
      )}

      {welcomeOpen && (
        <WelcomeOverlay
          onDemo={() => setWelcomeOpen(false)}
          onDropFile={() => {
            setWelcomeOpen(false);
            setLoadOpen(true);
          }}
          onClose={() => setWelcomeOpen(false)}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={(id) => removeToast(setToasts, id)} />
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────

function pushToast(
  set: React.Dispatch<React.SetStateAction<Toast[]>>,
  t: Omit<Toast, "id">,
): void {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  set((prev) => [...prev, { ...t, id }]);
  window.setTimeout(() => removeToast(set, id), 5000);
}

function removeToast(
  set: React.Dispatch<React.SetStateAction<Toast[]>>,
  id: string,
): void {
  set((prev) => prev.filter((t) => t.id !== id));
}

function EmptyState({ onLoadClick }: { onLoadClick: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-glyph">μ</div>
      <h2>Pick a way in.</h2>
      <p>
        Paste a public GitHub or GitLab repo URL · try the synthetic demo · or
        drop a <code>nervous-system.json</code> dumped by your AI agent. Everything
        is parsed in your browser — nothing is uploaded.
      </p>
      <button className="btn-primary" onClick={onLoadClick}>
        📥 Load a repo
      </button>
    </div>
  );
}
