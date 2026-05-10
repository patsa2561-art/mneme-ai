/**
 * FontSizePicker -- 4 buttons (S / M / L / XL) that scale every text
 * size in the dashboard. Persists to localStorage so the user's choice
 * survives reload.
 *
 * The mechanism: we set `data-fontsize` on the document element and
 * global.css declares matching :root[data-fontsize="L"] { font-size: ... }
 * rules. This way every existing rem/em-based size scales automatically
 * and we don't have to touch a thousand component CSS lines.
 */

import { useEffect, useState } from "react";

type Size = "S" | "M" | "L" | "XL";

const SIZES: Array<{ id: Size; px: number; label: string; tip: string }> = [
  { id: "S",  px: 13, label: "S",  tip: "Small (13px) — fits more on screen" },
  { id: "M",  px: 16, label: "M",  tip: "Medium (16px) — default, comfortable read" },
  { id: "L",  px: 18, label: "L",  tip: "Large (18px) — easier read at distance" },
  { id: "XL", px: 21, label: "XL", tip: "Extra large (21px) — accessibility / projector" },
];

const STORAGE_KEY = "mneme-fontsize";

function readSaved(): Size {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "S" || v === "M" || v === "L" || v === "XL") return v;
  } catch {
    // ignore
  }
  return "M";
}

function applySize(size: Size): void {
  const px = SIZES.find((s) => s.id === size)?.px ?? 16;
  document.documentElement.dataset["fontsize"] = size;
  document.documentElement.style.setProperty("--root-font-size", `${px}px`);
}

export function FontSizePicker() {
  const [size, setSize] = useState<Size>(() => readSaved());

  useEffect(() => {
    applySize(size);
    try { window.localStorage.setItem(STORAGE_KEY, size); } catch { /* ignore */ }
  }, [size]);

  return (
    <div className="font-size-picker" role="group" aria-label="Text size">
      <span className="fsp-prefix" aria-hidden>Aa</span>
      {SIZES.map((s) => (
        <button
          key={s.id}
          className={`fsp-btn ${size === s.id ? "active" : ""}`}
          title={s.tip}
          aria-label={`Set text size to ${s.tip}`}
          aria-pressed={size === s.id}
          onClick={() => setSize(s.id)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
