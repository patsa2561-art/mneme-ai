/**
 * WisdomDrawer — left-side collapsible accordion that hosts the three
 * "below the canvas" panels (GraphWisdom, LiveWisdom, Limits) so users
 * see them without scrolling. Closed by default as a vertical tab on
 * the left edge; expanded as a 360-px-wide column scrollable inside.
 *
 * Discoverability rules baked in:
 *   - When closed, a GLOWING violet pill on the left edge reads
 *     "📚 Wisdom · 3 panels — click to open" so the user cannot miss
 *     that content lives there.
 *   - When opened, panels are stacked + INDIVIDUALLY collapsible inside.
 *   - Default: closed for ecosystems / dna / scrubber views, OPEN for
 *     the graph view (where the wisdom is most actionable).
 */

import { useState, type ReactNode } from "react";

interface Props {
  /** Visual cue for the closed state — count of panels available. */
  panelCount: number;
  /** Initial state — graph view opens it; other views start closed. */
  defaultOpen?: boolean;
  children: ReactNode;
}

export function WisdomDrawer({ panelCount, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <aside className={`wisdom-drawer ${open ? "is-open" : "is-closed"}`} aria-label="Wisdom panels">
      {open ? (
        <>
          <header className="wisdom-drawer-head">
            <h2>
              <span className="wisdom-drawer-glyph" aria-hidden>📚</span>
              Wisdom
              <span className="wisdom-drawer-count">{panelCount} panel{panelCount === 1 ? "" : "s"}</span>
            </h2>
            <button
              type="button"
              className="wisdom-drawer-toggle"
              onClick={() => setOpen(false)}
              aria-label="Collapse wisdom panel"
              title="Collapse"
            >
              ◀
            </button>
          </header>
          <div className="wisdom-drawer-body">{children}</div>
        </>
      ) : (
        <button
          type="button"
          className="wisdom-drawer-tab"
          onClick={() => setOpen(true)}
          aria-label={`Open wisdom panel — ${panelCount} panels available`}
          title="Click to expand wisdom"
        >
          <span className="wisdom-drawer-tab-glyph" aria-hidden>📚</span>
          <span className="wisdom-drawer-tab-text">
            Wisdom · {panelCount} panel{panelCount === 1 ? "" : "s"}
          </span>
          <span className="wisdom-drawer-tab-arrow" aria-hidden>▶</span>
        </button>
      )}
    </aside>
  );
}

/** Inner accordion item — used by callers to wrap each panel for
 *  individual collapse inside the drawer. */
interface AccordionProps {
  title: string;
  defaultOpen?: boolean;
  glyph?: string;
  children: ReactNode;
}

export function WisdomAccordion({ title, defaultOpen = true, glyph, children }: AccordionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`wisdom-accordion ${open ? "is-open" : "is-closed"}`}>
      <button
        type="button"
        className="wisdom-accordion-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="wisdom-accordion-arrow" aria-hidden>{open ? "▼" : "▶"}</span>
        {glyph && <span className="wisdom-accordion-glyph" aria-hidden>{glyph}</span>}
        <span className="wisdom-accordion-title">{title}</span>
      </button>
      {open && <div className="wisdom-accordion-body">{children}</div>}
    </section>
  );
}
