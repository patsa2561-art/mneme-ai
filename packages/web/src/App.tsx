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
import { DetailPanel } from "./components/DetailPanel";
import { LimitsPanel } from "./components/LimitsPanel";
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
  const playStartedRef = useRef<number>(0);
  const playOriginRef = useRef<number>(0);

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
  useEffect(() => {
    if (!playing || !bounds) return;
    let frame = 0;
    const total = 12_000;
    const start = performance.now();
    playStartedRef.current = start;
    playOriginRef.current = bounds.min;
    const tick = (now: number) => {
      const elapsed = now - start;
      const pct = Math.min(1, elapsed / total);
      const t = bounds.min + (bounds.max - bounds.min) * pct;
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

      <main className="app-main">
        <section className="app-canvas" aria-label={`${view} view`}>
          {view === "ecosystems" ? (
            <EcosystemsView />
          ) : view === "dna" ? (
            <DnaView />
          ) : view === "scrubber" ? (
            <ScrubberView />
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

      <LimitsPanel limits={scrubbed?.limits ?? raw?.limits ?? []} />

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
        Try the synthetic demo, drop a file from{" "}
        <code>mneme nervous-system --json</code>, or paste a JSON URL.
        Everything is parsed in your browser — nothing is uploaded.
      </p>
      <button className="btn-primary" onClick={onLoadClick}>
        📥 Load my repo
      </button>
    </div>
  );
}
