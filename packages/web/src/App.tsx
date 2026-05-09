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
import { DetailPanel } from "./components/DetailPanel";
// LimitsPanel + LiveWisdomPanel moved into MetricsTopBar (v1.19.3).
import { GraphWisdomPanel } from "./components/GraphWisdomPanel";
import { WisdomDrawer, WisdomAccordion } from "./components/WisdomDrawer";
import { MetricsTopBar } from "./components/MetricsTopBar";
import { LoadDialog } from "./components/LoadDialog";
import { WelcomeOverlay } from "./components/WelcomeOverlay";
import { ToastStack, type Toast } from "./components/Toast";
import { computeTimeBounds, scrubData } from "./lib/scrub";

const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "") + "/";

function readOnboarded(): boolean {
  try {
    return window.localStorage.getItem("mneme-onboarded") === "true";
  } catch {
    return false;
  }
}

export function App() {
  const [raw, setRaw] = useState<NervousSystemData | null>(null);
  const [scrubT, setScrubT] = useState<number>(Date.now());
  const [view, setView] = useState<ViewMode>("graph");
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
          {view === "ecosystems" ? (
            <EcosystemsView data={raw ?? null} />
          ) : view === "dna" ? (
            <DnaView data={raw ?? null} />
          ) : view === "scrubber" ? (
            <ScrubberView />
          ) : view === "antivirus" ? (
            <AntivirusLabView />
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

        <aside className="app-detail" aria-label="Detail panel">
          <DetailPanel
            passport={selectedPassport}
            fallbackData={scrubbed}
            onClose={() => setSelectedEmail(null)}
          />
        </aside>
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
