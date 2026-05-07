import { useEffect, useRef, useState } from "react";

interface Props {
  onDemo: () => void;
  onDropFile: () => void;
  onClose: () => void;
}

const PANELS = ["what", "try", "yours"] as const;
type Panel = (typeof PANELS)[number];

export function WelcomeOverlay({ onDemo, onDropFile, onClose }: Props) {
  const [panel, setPanel] = useState<Panel>("what");
  const [dontShow, setDontShow] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstFocusRef = useRef<HTMLButtonElement | null>(null);

  // ESC closes; basic focus trap on Tab.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        commit(onClose);
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
    firstFocusRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = (action: () => void) => {
    if (dontShow) {
      try {
        window.localStorage.setItem("mneme-onboarded", "true");
      } catch {
        // ignore — private mode etc.
      }
    }
    action();
  };

  const handleDemo = () => commit(onDemo);
  const handleDrop = () => commit(onDropFile);
  const handleClose = () => commit(onClose);

  const idx = PANELS.indexOf(panel);
  const isLast = idx === PANELS.length - 1;
  const next = () => setPanel(PANELS[Math.min(PANELS.length - 1, idx + 1)]!);
  const prev = () => setPanel(PANELS[Math.max(0, idx - 1)]!);

  return (
    <div
      className="welcome-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="welcome-panel" ref={dialogRef}>
        <button
          className="welcome-close"
          onClick={handleClose}
          aria-label="Close welcome"
        >
          ×
        </button>

        <div className="welcome-progress" aria-hidden>
          {PANELS.map((p, i) => (
            <span
              key={p}
              className={`welcome-pip ${i <= idx ? "active" : ""}`}
            />
          ))}
        </div>

        {panel === "what" && (
          <div className="welcome-pane">
            <div className="welcome-glyph">μνήμη</div>
            <h2 id="welcome-title" className="welcome-title">
              The memory layer for your codebase.
            </h2>
            <p className="welcome-lead">
              This dashboard reveals the patterns hiding under your{" "}
              <code>git log</code>:
            </p>
            <ul className="welcome-bullets">
              <li>
                <span className="welcome-bullet-glyph">🧠</span>
                <div>
                  <b>Invisible teams</b>
                  <span>who actually collaborates, by code — not by Slack</span>
                </div>
              </li>
              <li>
                <span className="welcome-bullet-glyph">⏳</span>
                <div>
                  <b>Knowledge atrophy</b>
                  <span>files only one person remembers</span>
                </div>
              </li>
              <li>
                <span className="welcome-bullet-glyph">👑</span>
                <div>
                  <b>Cultural alphas</b>
                  <span>the people the rest of the team learns from</span>
                </div>
              </li>
            </ul>
          </div>
        )}

        {panel === "try" && (
          <div className="welcome-pane">
            <div className="welcome-eyebrow">30 seconds</div>
            <h2 className="welcome-title">Try it now.</h2>
            <ol className="welcome-steps">
              <li>
                <span className="welcome-step-num">1</span>
                <div>
                  <b>Drag the time scrubber</b> at the top to rewind your team's
                  history and watch the graph rebuild itself.
                </div>
              </li>
              <li>
                <span className="welcome-step-num">2</span>
                <div>
                  <b>Click any node</b> in the graph to open that engineer's
                  full passport — knowledge mass, expertise, atrophy.
                </div>
              </li>
              <li>
                <span className="welcome-step-num">3</span>
                <div>
                  <b>Switch views</b> — Nervous System ↔ Atrophy ↔ Influence —
                  using the tabs in the header.
                </div>
              </li>
            </ol>
          </div>
        )}

        {panel === "yours" && (
          <div className="welcome-pane">
            <div className="welcome-eyebrow">Your repo</div>
            <h2 className="welcome-title">Use your own data.</h2>
            <p className="welcome-lead">
              In any repo Mneme has indexed, run:
            </p>
            <pre className="welcome-code">
              <code>mneme nervous-system --json &gt; my-team.json</code>
            </pre>
            <p className="welcome-lead">
              Then <b>drag-drop <code>my-team.json</code> onto this page</b> —
              or click <b>Load my repo</b> in the header. Your file is parsed
              in this browser tab.{" "}
              <span className="welcome-strong">
                Mneme never receives, stores, or transmits it.
              </span>
            </p>
            <div className="welcome-tip">
              <span aria-hidden>💡</span>
              <span>
                Don't have Mneme yet?{" "}
                <code>npm install -g mneme-ai &amp;&amp; mneme index</code> —
                90 seconds for a 5K-commit repo.
              </span>
            </div>
          </div>
        )}

        <div className="welcome-foot">
          <label className="welcome-dontshow">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
            />
            <span>Don't show this again</span>
          </label>

          <div className="welcome-nav">
            {idx > 0 && (
              <button className="btn-ghost" onClick={prev}>
                ← Back
              </button>
            )}
            {!isLast ? (
              <button
                ref={firstFocusRef}
                className="btn-primary"
                onClick={next}
              >
                Next →
              </button>
            ) : (
              <button
                ref={firstFocusRef}
                className="btn-primary welcome-cta"
                onClick={handleDemo}
              >
                🎬 Show me the demo
              </button>
            )}
          </div>
        </div>

        <button className="welcome-skip" onClick={handleDrop}>
          I've used Mneme before — just let me drop a file
        </button>
      </div>
    </div>
  );
}
