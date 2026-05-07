import { useCallback, useRef, useState } from "react";
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
  const fileRef = useRef<HTMLInputElement | null>(null);

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
      <div className="dialog-panel">
        <div className="dialog-head">
          <h2>Load nervous-system data</h2>
          <button className="dialog-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <p className="dialog-blurb">
          100% local. Files stay in your browser — no upload, no telemetry.
        </p>

        <div className="load-grid">
          <button className="load-card" onClick={loadDemo} disabled={busy}>
            <div className="load-card-glyph">▶</div>
            <div className="load-card-title">Try the demo</div>
            <div className="load-card-blurb">Pre-computed dataset. No setup.</div>
          </button>

          <div
            className={`load-card drop ${dragging ? "drag-over" : ""}`}
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
            onClick={() => fileRef.current?.click()}
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
            <div className="load-card-glyph">⤓</div>
            <div className="load-card-title">Drop a file</div>
            <div className="load-card-blurb">
              <code>mneme nervous-system --json</code>
            </div>
          </div>

          <div className="load-card url">
            <div className="load-card-glyph">⌘</div>
            <div className="load-card-title">From URL</div>
            <input
              className="load-url-input"
              placeholder="https://…/nervous-system.json"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void loadUrl();
              }}
            />
            <button className="btn-primary small" onClick={loadUrl} disabled={!url || busy}>
              fetch
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
