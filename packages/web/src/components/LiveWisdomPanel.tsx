/**
 * LiveWisdomPanel — surfaces the 5 Mneme metric proxies (HKD / REI / KAH
 * / TWS / PCS) computed in-browser from the live commit window. Honest
 * framing: every metric carries a "proxy of …" line so a viewer never
 * confuses live numbers for full-CLI numbers.
 *
 * Renders only when `_liveMode` is true. Otherwise the dashboard falls
 * back to the full metric values from the JSON file.
 */

import { useMemo } from "react";
import type { NervousSystemData } from "../types";
import { computeLiveWisdom } from "../lib/liveWisdom";

interface Props {
  data: NervousSystemData;
}

function fmtRange(window: NervousSystemData["_liveDataWindow"]): string {
  if (!window) return "no file detail in window";
  const f = new Date(window.from).toISOString().slice(0, 10);
  const t = new Date(window.to).toISOString().slice(0, 10);
  return `${f} → ${t}`;
}

export function LiveWisdomPanel({ data }: Props) {
  const metrics = useMemo(() => computeLiveWisdom(data), [data]);
  if (!data._liveMode) return null;

  return (
    <section className="live-wisdom" aria-label="Live wisdom metrics">
      <header className="live-wisdom-head">
        <h3>
          <span className="live-wisdom-glyph" aria-hidden>⚛</span>
          Live wisdom — Mneme metrics computed from your real repo
        </h3>
        <div className="live-wisdom-window">
          {data._liveDataWindow ? (
            <>
              <b>{data._liveDataWindow.commits}</b> commits w/ file detail ·{" "}
              <b>{data._liveDataWindow.totalFetched}</b> commits read total ·{" "}
              <span className="live-wisdom-range">{fmtRange(data._liveDataWindow)}</span>
            </>
          ) : (
            <>
              <b>{data.meta.totalCommits}</b> commits read · file detail unavailable
            </>
          )}
        </div>
      </header>

      <div className="live-wisdom-grid">
        {metrics.map((m) => (
          <div
            key={m.code}
            className={`live-wisdom-card ${m.value == null ? "is-na" : ""}`}
            title={m.caveat}
          >
            <div className="live-wisdom-code">{m.code}</div>
            <div className="live-wisdom-value">
              {m.value == null ? "—" : m.value}
              {m.value != null && m.suffix && (
                <span className="live-wisdom-suffix">{m.suffix}</span>
              )}
            </div>
            <div className="live-wisdom-label">{m.label}</div>
            <div className="live-wisdom-explain">{m.explain}</div>
          </div>
        ))}
      </div>

      <footer className="live-wisdom-foot">
        These five numbers are <b>proxies</b> of Mneme's full metrics
        (HKD · TWS · CVR · HRR · REI · KAH · PCS) — computed from the
        commit data the API exposes. The full metrics require Mneme's
        HMAC-chained audit log + regret extraction + Constitutional Gate
        + atrophy time-series. Have your AI agent run{" "}
        <code>mneme index &amp;&amp; mneme nervous-system --json</code> for
        the unredacted version.
      </footer>
    </section>
  );
}
