import { useCallback, useEffect, useRef, useState } from "react";
import type { NervousSystemData } from "../types";

interface Props {
  base: string;
  onClose: () => void;
  onLoaded: (data: NervousSystemData, source: string) => void;
  onError: (msg: string) => void;
}

export function LoadDialog({ base, onClose, onLoaded, onError }: Props) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // ESC to close + simple focus trap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button,[href],input,[tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const loadDemo = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`${base}demo.json`, { cache: "no-cache" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as NervousSystemData;
      onLoaded(data, "demo");
    } catch (e) {
      onError(`Demo failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [base, onLoaded, onError]);

  const loadFile = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const text = await file.text();
        const data = JSON.parse(text) as NervousSystemData;
        if (!data.meta || !Array.isArray(data.passports)) {
          throw new Error("not a nervous-system JSON (missing meta/passports)");
        }
        onLoaded(data, file.name);
      } catch (e) {
        onError(`Could not parse ${file.name}: ${(e as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [onLoaded, onError],
  );

  const loadUrl = useCallback(async () => {
    if (!url) return;
    setBusy(true);
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as NervousSystemData;
      onLoaded(data, url);
    } catch (e) {
      onError(`URL fetch failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [url, onLoaded, onError]);

  return (
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Load data"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-panel load-dialog" ref={dialogRef}>
        <div className="dialog-head">
          <div>
            <h2>Load data</h2>
            <p className="dialog-blurb">
              Three ways in. Pick whichever fits.
            </p>
          </div>
          <button className="dialog-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="load-howto">
          <details>
            <summary>🤔 First time here? — how to get a JSON of your own repo</summary>
            <div className="load-howto-body">
              <p>From your repo (one-time setup):</p>
              <pre>{`# 1. Install Mneme globally
npm install -g mneme-ai

# 2. In your repo
cd /path/to/your-repo
mneme init
mneme index   # ~90s for a 5k-commit repo

# 3. Export the dashboard data as JSON
mneme nervous-system --json > my-repo.json

# 4. Drop my-repo.json into the tile below`}</pre>
              <p className="load-howto-note">
                <strong>Privacy:</strong> the JSON is generated locally — nothing is uploaded.
                When you drop it here, it's parsed in this browser tab and never leaves your machine.
              </p>
            </div>
          </details>
        </div>

        <div className="load-grid">
          {/* Tile 1 — demo */}
          <button
            type="button"
            className="load-tile"
            onClick={loadDemo}
            disabled={busy}
          >
            <div className="load-tile-glyph" aria-hidden>🎬</div>
            <div className="load-tile-title">Try the demo</div>
            <div className="load-tile-desc">
              Synthetic 7-author team. See what the dashboard can do — no setup.
            </div>
            <div className="load-tile-cta">Show demo →</div>
          </button>

          {/* Tile 2 — drop file */}
          <div
            className={`load-tile drop ${dragging ? "drag-over" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files[0];
              if (f) void loadFile(f);
            }}
          >
            <input
              type="file"
              accept=".json,application/json"
              hidden
              ref={fileRef}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadFile(f);
              }}
            />
            <div className="load-tile-glyph" aria-hidden>📥</div>
            <div className="load-tile-title">Drop my JSON file</div>
            <div className="load-tile-desc">
              JSON exported from <code>mneme nervous-system --json</code>.
              <br/>
              <span className="load-tile-hint">↑ Don't have one? Open the help above.</span>
            </div>
            <div className="load-tile-cta">
              {dragging ? "Drop to load…" : "Browse files…"}
            </div>
          </div>

          {/* Tile 3 — url */}
          <div
            className={`load-tile url ${showUrl ? "expanded" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => setShowUrl(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setShowUrl(true);
              }
            }}
          >
            <div className="load-tile-glyph" aria-hidden>🔗</div>
            <div className="load-tile-title">Load from URL</div>
            <div className="load-tile-desc">
              Paste a publicly hosted JSON URL.
            </div>
            {showUrl ? (
              <div className="load-tile-urlrow" onClick={(e) => e.stopPropagation()}>
                <input
                  className="load-url-input"
                  placeholder="https://…/nervous-system.json"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void loadUrl();
                  }}
                  autoFocus
                />
                <button
                  className="btn-primary small"
                  onClick={loadUrl}
                  disabled={!url || busy}
                >
                  Load
                </button>
              </div>
            ) : (
              <div className="load-tile-cta">Paste URL →</div>
            )}
          </div>
        </div>

        <p className="load-privacy">
          🔒 Your file is parsed in this browser tab.{" "}
          <b>Mneme never receives, stores, or transmits it.</b>
        </p>
      </div>
    </div>
  );
}
