import { useMemo, useState } from "react";
import type { NervousSystemData } from "../types";

interface Props {
  data: NervousSystemData;
  selectedEmail: string | null;
  onSelect: (email: string) => void;
}

export function InfluenceLadder({ data, selectedEmail, onSelect }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const ladder = useMemo(() => {
    const max = Math.max(0, ...data.alphas.map((a) => a.pageRank));
    return data.alphas.map((a) => ({
      ...a,
      pct: max > 0 ? a.pageRank / max : 0,
    }));
  }, [data.alphas]);

  if (ladder.length === 0) {
    return (
      <div className="ladder-empty">
        <p>No influence rankings at this moment in time.</p>
        <p className="ladder-empty-hint">
          Either the codebase has no detected pattern adoption yet, or
          you've scrubbed before any reusable shapes existed.
        </p>
      </div>
    );
  }

  return (
    <div className="ladder-container">
      <h3 className="ladder-title">Cultural alphas — by PageRank</h3>
      <p className="ladder-blurb">
        Influence is volume-independent. A 5-commit author whose patterns get
        adopted by 12 others outranks a 500-commit author whose code never
        gets re-used.
      </p>
      <div className="ladder-list">
        {ladder.map((a) => {
          const sel = a.email.toLowerCase() === (selectedEmail ?? "").toLowerCase();
          const open = expanded === a.email;
          return (
            <div key={a.email} className={`ladder-row ${sel ? "selected" : ""}`}>
              <div
                className="ladder-row-head"
                onClick={() => onSelect(a.email)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onSelect(a.email);
                }}
              >
                <div className="ladder-rank">#{a.rank}</div>
                <div className="ladder-name">
                  <div className="ladder-name-text">{a.name}</div>
                  <div className="ladder-email">{a.email}</div>
                </div>
                <div className="ladder-bar-wrap">
                  <div className="ladder-bar" style={{ width: `${a.pct * 100}%` }} />
                  <div className="ladder-bar-value">PR {a.pageRank.toFixed(3)}</div>
                </div>
                <button
                  className="ladder-expand"
                  aria-expanded={open}
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded(open ? null : a.email);
                  }}
                >
                  {open ? "−" : "+"}
                </button>
              </div>
              {open && (
                <div className="ladder-detail">
                  <div className="ladder-stat">
                    <span>originated patterns adopted</span>
                    <b>{a.originatedShapesAdopted}</b>
                  </div>
                  <div className="ladder-stat">
                    <span>adoptions by others</span>
                    <b>{a.adoptionsByOthers}</b>
                  </div>
                  <div className="ladder-stat">
                    <span>unique adopters</span>
                    <b>{a.uniqueAdopters}</b>
                  </div>
                  {a.topShape && (
                    <div className="ladder-stat full">
                      <span>top pattern</span>
                      <b>
                        <code>{a.topShape.kind}</code>{" "}
                        <span className="muted">{a.topShape.name}/{a.topShape.arity}</span>{" "}
                        — {a.topShape.adoptions}× adopted
                      </b>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
