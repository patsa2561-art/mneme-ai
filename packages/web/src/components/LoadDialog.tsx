import { useCallback, useEffect, useRef, useState } from "react";
import type { NervousSystemData } from "../types";
import { fetchAndSynthesize, classifyUrl } from "../lib/gitFetch";

interface Props {
  base: string;
  onClose: () => void;
  onLoaded: (data: NervousSystemData, source: string) => void;
  onError: (msg: string) => void;
}

export function LoadDialog({ base, onClose, onLoaded, onError }: Props) {
  const [busy, setBusy] = useState(false);
  const [busyMsg, setBusyMsg] = useState<string>("");
  const [url, setUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // ESC + tab focus trap.
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
    setBusyMsg("Loading demo…");
    try {
      const res = await fetch(`${base}demo.json`, { cache: "no-cache" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as NervousSystemData;
      onLoaded(data, "demo");
    } catch (e) {
      onError(`Demo failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setBusyMsg("");
    }
  }, [base, onLoaded, onError]);

  const loadFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setBusyMsg(`Reading ${file.name}…`);
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
        setBusyMsg("");
      }
    },
    [onLoaded, onError],
  );

  const loadUrl = useCallback(async () => {
    if (!url) return;
    setBusy(true);
    setBusyMsg("Fetching…");
    try {
      const { data, source } = await fetchAndSynthesize(url, (msg) =>
        setBusyMsg(msg),
      );
      onLoaded(data, source);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
      setBusyMsg("");
    }
  }, [url, onLoaded, onError]);

  // Auto-detect what was pasted to render the right tile primary.
  const cls = url ? classifyUrl(url) : { kind: "unknown" as const };
  const urlKindLabel =
    cls.kind === "github"
      ? `→ Fetch ${cls.owner}/${cls.repo} from GitHub`
      : cls.kind === "gitlab"
      ? `→ Fetch ${cls.project} from GitLab`
      : cls.kind === "json"
      ? "→ Fetch JSON"
      : url
      ? "Paste a GitHub/GitLab repo URL"
      : "";

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
            <h2>Load a repo</h2>
            <p className="dialog-blurb">
              Paste any public GitHub / GitLab URL — or try the demo. Everything
              parses in this browser tab.
            </p>
          </div>
          <button className="dialog-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {/* PRIMARY — paste a repo URL */}
        <div className="load-primary">
          <label className="load-primary-label">
            🔗 Paste GitHub or GitLab repo URL
          </label>
          <div className="load-primary-row">
            <input
              className="load-primary-input"
              placeholder="https://github.com/owner/repo  ·  https://gitlab.com/group/project"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && cls.kind !== "unknown") void loadUrl();
              }}
              disabled={busy}
              autoFocus
            />
            <button
              className="btn-primary"
              onClick={loadUrl}
              disabled={!url || busy || cls.kind === "unknown"}
            >
              {busy ? "Loading…" : "Load repo →"}
            </button>
          </div>
          {urlKindLabel && (
            <div className={`load-primary-hint ${cls.kind === "unknown" ? "warn" : "ok"}`}>
              {urlKindLabel}
            </div>
          )}
          {busyMsg && <div className="load-primary-busy">⏳ {busyMsg}</div>}
        </div>

        <div className="load-divider"><span>or</span></div>

        {/* SECONDARY tiles */}
        <div className="load-grid load-grid-2">
          {/* Tile 1 — demo */}
          <button
            type="button"
            className="load-tile"
            onClick={loadDemo}
            disabled={busy}
          >
            <div className="load-tile-glyph" aria-hidden>🎬</div>
            <div className="load-tile-title">Try the synthetic demo</div>
            <div className="load-tile-desc">
              7-author team, hand-crafted. No setup, no API call.
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
            <div className="load-tile-title">Drop nervous-system JSON</div>
            <div className="load-tile-desc">
              The full-fidelity option. From <code>mneme nervous-system --json</code>.
            </div>
            <div className="load-tile-cta">
              {dragging ? "Drop to load…" : "Browse files…"}
            </div>
          </div>
        </div>

        <div className="load-howto">
          <details>
            <summary>💡 Want full-fidelity insight on a private repo?</summary>
            <div className="load-howto-body">
              <p>
                The URL path above uses the public GitHub / GitLab API — fast,
                but degraded (no file-level data). For the <strong>complete</strong>
                {" "}nervous system on any repo (including private), have your
                AI agent install Mneme and run it locally. <em>You don't type
                anything.</em>
              </p>
              <p className="load-howto-ask">Just say to your AI:</p>
              <pre>{`Install Mneme on this repo and dump the
nervous-system JSON so I can load it in
the dashboard at https://patsa2561-art.github.io/mneme-ai/`}</pre>
              <p>
                Your AI handles the install (one of: <code>npm install -g mneme-ai</code>,
                <code> npx mneme-ai</code>, or Docker), runs <code>mneme init && mneme index</code>,
                then <code>mneme nervous-system --json &gt; my-repo.json</code>. Drop
                that file into the second tile above.
              </p>
              <p className="load-howto-note">
                <strong>Privacy:</strong> JSON is generated on your machine.
                Dropped here it is parsed in this browser tab and never leaves it.
              </p>
            </div>
          </details>
        </div>

        <p className="load-privacy">
          🔒 GitHub/GitLab fetches go directly browser → API (no Mneme server).
          {" "}<b>Mneme never receives, stores, or proxies your data.</b>
        </p>
      </div>
    </div>
  );
}
