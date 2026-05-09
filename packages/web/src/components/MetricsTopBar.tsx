/**
 * MetricsTopBar — compact horizontal strip above the canvas that puts
 * LiveWisdom proxies + honest limits in ONE LINE so the user sees them
 * without scrolling. Replaces the bottom-stacked LiveWisdomPanel +
 * LimitsPanel layout.
 *
 * Each metric renders as a chip: CODE • value • short label. Hover or
 * click expands an info tooltip (handled via title attribute for now).
 */

import { useMemo, useState } from "react";
import type { NervousSystemData } from "../types";
import { computeLiveWisdom } from "../lib/liveWisdom";

interface Props {
  data: NervousSystemData;
  limits: string[];
}

export function MetricsTopBar({ data, limits }: Props) {
  const [expandedLimits, setExpandedLimits] = useState(false);
  const metrics = useMemo(() => (data._liveMode ? computeLiveWisdom(data) : []), [data]);
  const showMetrics = data._liveMode && metrics.length > 0;
  const showLimits = limits.length > 0;
  if (!showMetrics && !showLimits) return null;

  return (
    <div className="metrics-topbar" role="region" aria-label="Live metrics + caveats">
      {showMetrics && (
        <div className="metrics-topbar-row">
          <span className="metrics-topbar-glyph" aria-hidden>⚛</span>
          <span className="metrics-topbar-label">Live wisdom</span>
          {metrics.map((m) => (
            <div
              key={m.code}
              className={`metrics-topbar-chip ${m.value == null ? "is-na" : ""}`}
              title={`${m.label} — ${m.explain}\n\n${m.caveat}`}
            >
              <span className="metrics-topbar-code">{m.code}</span>
              <span className="metrics-topbar-value">
                {m.value == null ? "—" : m.value}
                {m.value != null && m.suffix && <span className="metrics-topbar-suffix">{m.suffix}</span>}
              </span>
              <span className="metrics-topbar-name">{m.label.replace(/^[A-Z]+\s*[·—]\s*/, "")}</span>
            </div>
          ))}
        </div>
      )}
      {showLimits && (
        <div className={`metrics-topbar-limits ${expandedLimits ? "is-expanded" : ""}`}>
          <button
            type="button"
            className="metrics-topbar-limits-toggle"
            onClick={() => setExpandedLimits((v) => !v)}
            aria-expanded={expandedLimits}
            aria-label={`${limits.length} honest limits — ${expandedLimits ? "collapse" : "expand"}`}
          >
            <span aria-hidden>ⓘ</span> {limits.length} caveat{limits.length === 1 ? "" : "s"} {expandedLimits ? "▲" : "▼"}
          </button>
          {expandedLimits && (
            <ul className="metrics-topbar-limits-list">
              {limits.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
