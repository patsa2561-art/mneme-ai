/**
 * GraphWisdomPanel — explains why the graph looks the way it does.
 * Renders one large card per disconnected node, grounded in the author's
 * real commit dates / files / counts (no generic prose). Header surfaces
 * the actual repo-wide first push and latest push from git.
 *
 * Only mounted when the graph view is showing and there is something
 * worth explaining (isolated nodes or multiple components).
 */

import { useMemo } from "react";
import type { NervousSystemData } from "../types";
import {
  computeGraphWisdom,
  type IsolatedReason,
} from "../lib/graphWisdom";

interface Props {
  data: NervousSystemData;
}

const REASON_HINT: Record<IsolatedReason, { glyph: string; tone: string }> = {
  "file-island": { glyph: "🗺", tone: "warn" },
  "time-island": { glyph: "⏳", tone: "info" },
  "solo-day": { glyph: "📍", tone: "info" },
  "drive-by": { glyph: "✈", tone: "muted" },
  bot: { glyph: "🤖", tone: "muted" },
  "tool-account": { glyph: "🔑", tone: "muted" },
};

export function GraphWisdomPanel({ data }: Props) {
  const wisdom = useMemo(() => computeGraphWisdom(data), [data]);
  const hasIsolated = wisdom.isolated.length > 0;
  const hasMultipleComponents = wisdom.components.length > 1;
  if (!hasIsolated && !hasMultipleComponents) return null;

  return (
    <section className="graph-wisdom" aria-label="Graph structure explained">
      <header className="graph-wisdom-head">
        <h3>
          <span className="graph-wisdom-glyph" aria-hidden>
            ⌬
          </span>
          Why the graph looks like this
        </h3>
        <div className="graph-wisdom-window">
          {wisdom.repoFirstCommit && wisdom.repoLastCommit ? (
            <>
              real repo span ·{" "}
              <b>{wisdom.repoFirstCommit}</b> first push ·{" "}
              <b>{wisdom.repoLastCommit}</b> latest push ·{" "}
              <span className="graph-wisdom-range">
                {wisdom.repoSpanDays} day{wisdom.repoSpanDays === 1 ? "" : "s"}
              </span>
            </>
          ) : (
            <>no commit dates available</>
          )}
        </div>
      </header>

      <p className="graph-wisdom-headline">{wisdom.headline}</p>

      {wisdom.components.length > 1 && (
        <div className="graph-wisdom-components" aria-label="Disconnected components">
          {wisdom.components.map((c, i) => (
            <div key={i} className="graph-wisdom-component">
              <div className="graph-wisdom-comp-size">cluster #{i + 1}</div>
              <div className="graph-wisdom-comp-count">
                {c.size} member{c.size === 1 ? "" : "s"} · {c.edgeEvents} co-events
                {c.dominantTopic && (
                  <>
                    {" "}· top topic <b>{c.dominantTopic}</b>
                  </>
                )}
              </div>
              <div className="graph-wisdom-comp-members">
                {c.members.map((m) => m.name).join(" · ")}
              </div>
              {c.bridge && (
                <div className="graph-wisdom-comp-bridge">
                  bridge: <b>{c.bridge.name}</b> — removing them likely splits this cluster.
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {hasIsolated && (
        <div className="graph-wisdom-isolated" aria-label="Isolated nodes explained">
          {wisdom.isolated.map((iso) => {
            const hint = REASON_HINT[iso.reason];
            return (
              <article
                key={iso.email}
                className={`graph-wisdom-card tone-${hint.tone}`}
              >
                <header className="graph-wisdom-card-head">
                  <div className="graph-wisdom-card-glyph" aria-hidden>
                    {hint.glyph}
                  </div>
                  <div className="graph-wisdom-card-id">
                    <div className="graph-wisdom-card-name">{iso.name}</div>
                    <div className="graph-wisdom-card-email">{iso.email}</div>
                  </div>
                  <div className={`graph-wisdom-chip chip-${hint.tone}`}>
                    {iso.reasonLabel}
                  </div>
                </header>
                <p className="graph-wisdom-card-explain">{iso.explain}</p>
                <ul className="graph-wisdom-card-evidence">
                  {iso.evidence.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
                <div className="graph-wisdom-card-window">
                  active <b>{iso.fromDate}</b> → <b>{iso.toDate}</b> ·{" "}
                  {iso.commitCount} commit{iso.commitCount === 1 ? "" : "s"} ·{" "}
                  {iso.activeDays} active day{iso.activeDays === 1 ? "" : "s"}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <footer className="graph-wisdom-foot">
        Reasons computed live from your real git data — author windows,
        commit counts, and per-author file footprints. Live mode draws an
        edge only when two authors commit on the same calendar day; full
        Mneme also uses file co-edits and HMAC-chained provenance, so
        these isolations may collapse once you run{" "}
        <code>mneme index &amp;&amp; mneme nervous-system --json</code>.
      </footer>
    </section>
  );
}
