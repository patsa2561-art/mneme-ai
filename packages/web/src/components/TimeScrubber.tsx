import { useCallback, useEffect, useMemo, useRef } from "react";
import type { TimeBounds } from "../lib/scrub";
import { fmtDate } from "../lib/scrub";

interface Props {
  bounds: TimeBounds | null;
  value: number;
  onChange: (t: number) => void;
  playing: boolean;
  onPlayToggle: () => void;
}

/**
 * The Time Scrubber — the headline innovation.
 *
 * Drag to rewind. Click any point on the rail to jump. Arrow keys nudge.
 * Smoothness is the whole point: we route every input through `requestAnimationFrame`,
 * never write to React state more than once per frame, and use CSS transforms
 * (no layout thrash) for the moving parts.
 */
export function TimeScrubber({ bounds, value, onChange, playing, onPlayToggle }: Props) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const pendingRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const flushPending = useCallback(() => {
    if (pendingRef.current !== null) {
      onChange(pendingRef.current);
      pendingRef.current = null;
    }
    rafRef.current = null;
  }, [onChange]);

  const schedule = useCallback(
    (t: number) => {
      pendingRef.current = t;
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(flushPending);
      }
    },
    [flushPending],
  );

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const pct = useMemo(() => {
    if (!bounds) return 1;
    const span = bounds.max - bounds.min;
    if (span <= 0) return 1;
    return Math.max(0, Math.min(1, (value - bounds.min) / span));
  }, [bounds, value]);

  const handlePointer = useCallback(
    (clientX: number) => {
      if (!bounds || !railRef.current) return;
      const rect = railRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      schedule(bounds.min + (bounds.max - bounds.min) * ratio);
    },
    [bounds, schedule],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      draggingRef.current = true;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      handlePointer(e.clientX);
    },
    [handlePointer],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      handlePointer(e.clientX);
    },
    [handlePointer],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      draggingRef.current = false;
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    },
    [],
  );

  const onKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!bounds) return;
      const span = bounds.max - bounds.min;
      const step = e.shiftKey ? span / 20 : span / 200;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        schedule(Math.max(bounds.min, value - step));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        schedule(Math.min(bounds.max, value + step));
      } else if (e.key === "Home") {
        e.preventDefault();
        schedule(bounds.min);
      } else if (e.key === "End") {
        e.preventDefault();
        schedule(bounds.max);
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        onPlayToggle();
      }
    },
    [bounds, value, schedule, onPlayToggle],
  );

  if (!bounds) {
    return (
      <div className="scrubber empty">
        <span className="scrubber-empty-label">no temporal data — load a JSON to enable the time machine</span>
      </div>
    );
  }

  // Tick marks at quartiles for orientation.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((q) => ({
    pct: q,
    label: fmtDate(bounds.min + (bounds.max - bounds.min) * q),
  }));

  return (
    <div className="scrubber">
      <button
        className={`play-btn ${playing ? "playing" : ""}`}
        onClick={onPlayToggle}
        aria-label={playing ? "Pause" : "Play"}
        title={playing ? "Pause" : "Play 12-second timelapse"}
      >
        {playing ? "❚❚" : "▶"}
      </button>

      <div className="scrubber-stage">
        <div
          className="scrubber-rail"
          ref={railRef}
          role="slider"
          tabIndex={0}
          aria-valuemin={bounds.min}
          aria-valuemax={bounds.max}
          aria-valuenow={Math.round(value)}
          aria-valuetext={fmtDate(value)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKey}
        >
          <div className="scrubber-track" />
          <div className="scrubber-fill" style={{ transform: `scaleX(${pct})` }} />
          <div className="scrubber-handle" style={{ transform: `translateX(${pct * 100}%) translateX(-50%)` }}>
            <div className="scrubber-handle-dot" />
            <div className="scrubber-handle-pulse" />
            <div className="scrubber-handle-tooltip">{fmtDate(value)}</div>
          </div>
          {ticks.map((t, i) => (
            <div key={i} className="scrubber-tick" style={{ left: `${t.pct * 100}%` }}>
              <div className="scrubber-tick-mark" />
              {(i === 0 || i === 4) && (
                <div className="scrubber-tick-label">{t.label}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="scrubber-meta" aria-hidden>
        <span className="scrubber-now">{fmtDate(value)}</span>
      </div>
    </div>
  );
}
