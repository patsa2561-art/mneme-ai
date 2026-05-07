import { useState } from "react";

interface Props {
  limits: string[];
}

export function LimitsPanel({ limits }: Props) {
  const [open, setOpen] = useState(false);
  if (limits.length === 0) return null;
  return (
    <details
      className={`limits-panel ${open ? "open" : ""}`}
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>
        <span className="limits-glyph">i</span>
        Honest limits — what this dashboard cannot tell you
      </summary>
      <ul>
        {limits.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </details>
  );
}
