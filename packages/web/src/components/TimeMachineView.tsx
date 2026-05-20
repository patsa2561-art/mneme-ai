/**
 * v2.19.86 — TIME-MACHINE POLYGRAPH dashboard (IDEA #4).
 *
 * Honesty-over-time per vendor.  Pulls the pulse aggregate from the
 * local bridge's /v1/polygraph/timeline route (or falls back to a
 * browser-side bucketing pass when the bridge is unreachable so the
 * GitHub Pages demo still renders).
 *
 * Zero new ledger; reads the same `pulse.jsonl` that powers the World
 * Pulse globe — every Browser Polygraph dot already records (ts,
 * vendor, color) since v2.19.84.
 */

import { useEffect, useMemo, useState } from "react";

interface TimelineBucket {
  bucketStart: string;
  total: number;
  green: number; yellow: number; red: number; grey: number;
  honestyPct: number | null;
}

interface TimelineSeries {
  vendor: string;
  windowDays: number;
  bucketHours: number;
  buckets: TimelineBucket[];
  minHonesty: number | null;
  maxHonesty: number | null;
  drift: number | null;
  meanHonesty: number | null;
}

const VENDOR_OPTIONS = ["claude-ai", "chatgpt", "gemini", "copilot", "deepseek", "qwen"] as const;

export function TimeMachineView(): JSX.Element {
  const [vendor, setVendor] = useState<string>("claude-ai");
  const [windowDays, setWindowDays] = useState<number>(30);
  const [series, setSeries] = useState<TimelineSeries | null>(null);
  const [bridgeAlive, setBridgeAlive] = useState<boolean>(false);

  const lang = useMemo<"en" | "th">(() => {
    try { const v = localStorage.getItem("mneme-lang"); if (v === "th" || v === "en") return v;
      return /^th/i.test(navigator.language || "") ? "th" : "en"; } catch { return "en"; }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function probeBridge(): Promise<string | null> {
      for (let i = 0; i < 10; i++) {
        const url = `http://127.0.0.1:${17741 + i}`;
        try {
          const res = await fetch(url + "/v1/ping", { signal: AbortSignal.timeout(400) });
          if (res.ok) return url;
        } catch {}
      }
      return null;
    }

    async function load() {
      const bridge = await probeBridge();
      if (cancelled) return;
      setBridgeAlive(!!bridge);
      if (bridge) {
        try {
          const res = await fetch(`${bridge}/v1/polygraph/timeline?vendor=${encodeURIComponent(vendor)}&windowDays=${windowDays}&bucketHours=24`, {
            signal: AbortSignal.timeout(2000),
          });
          if (res.ok) {
            const data = await res.json() as TimelineSeries;
            if (!cancelled) setSeries(data);
            return;
          }
        } catch {}
      }
      // Fallback: synthesize a demo series so the UI doesn't go blank.
      if (!cancelled) setSeries(synthSeries(vendor, windowDays));
    }
    load();
    return () => { cancelled = true; };
  }, [vendor, windowDays]);

  const chart = useMemo(() => series ? renderLineChart(series) : null, [series]);

  return (
    <div style={{ padding: "20px 18px 40px", color: "#e6e6e6", maxWidth: 1280, margin: "0 auto" }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#fff", display: "flex", alignItems: "center", gap: 10 }}>
          🕰️ {lang === "th" ? "Time-Machine Polygraph" : "Time-Machine Polygraph"}
          <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 999, background: bridgeAlive ? "#34d399" : "#94a3b8", color: bridgeAlive ? "#022c22" : "#0f172a", fontWeight: 700 }}>
            {bridgeAlive ? "LIVE" : "DEMO"}
          </span>
        </h1>
        <p style={{ margin: "6px 0 0 0", color: "#9ba1a6", fontSize: 13, lineHeight: 1.6, maxWidth: 820 }}>
          {lang === "th"
            ? "AI honest มากขึ้นไหมตามเวลา? ดู honesty score ของ vendor แต่ละตัวเดินเป็นเส้น day by day. มาจาก pulse.jsonl เดียวกับ World Pulse — ไม่มี ledger ใหม่."
            : "Is the AI getting more honest over time? Per-vendor honesty score day-by-day. Reads the same pulse.jsonl that powers the World Pulse globe — no new ledger."}
        </p>
      </header>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#9ba1a6" }}>
          {lang === "th" ? "Vendor" : "Vendor"}:
          <select value={vendor} onChange={(e) => setVendor(e.target.value)} style={{ background: "#1a1a22", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6, padding: "4px 8px", fontFamily: "inherit" }}>
            {VENDOR_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#9ba1a6" }}>
          {lang === "th" ? "Window" : "Window"}:
          <select value={windowDays} onChange={(e) => setWindowDays(parseInt(e.target.value, 10))} style={{ background: "#1a1a22", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6, padding: "4px 8px", fontFamily: "inherit" }}>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
      </div>

      <section style={{ padding: 20, background: "#0a0a0e", borderRadius: 12, border: "1px solid rgba(243,128,32,0.30)" }}>
        {series && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 18, fontSize: 12 }}>
            <Stat label={lang === "th" ? "ค่าเฉลี่ย" : "Mean"} value={series.meanHonesty != null ? `${(series.meanHonesty * 100).toFixed(1)}%` : "—"} />
            <Stat label={lang === "th" ? "ต่ำสุด" : "Min"} value={series.minHonesty != null ? `${(series.minHonesty * 100).toFixed(0)}%` : "—"} />
            <Stat label={lang === "th" ? "สูงสุด" : "Max"} value={series.maxHonesty != null ? `${(series.maxHonesty * 100).toFixed(0)}%` : "—"} />
            <Stat
              label={lang === "th" ? "Drift" : "Drift"}
              value={series.drift != null ? `${series.drift > 0 ? "↑" : series.drift < 0 ? "↓" : "→"} ${(series.drift * 100).toFixed(1)}%` : "—"}
              color={series.drift != null ? (series.drift > 0.05 ? "#3fb950" : series.drift < -0.05 ? "#ff5b5b" : "#f7d34c") : undefined}
            />
          </div>
        )}
        {chart}
      </section>

      <p style={{ marginTop: 14, fontSize: 11, color: "#9ba1a6", lineHeight: 1.6 }}>
        {lang === "th"
          ? <>เส้นสีเขียว = honesty (green / (green + yellow + red)) ต่อ bucket. จุดที่ขาดหายคือไม่มี event ใน bucket นั้น. CLI: <code style={{ background: "rgba(0,0,0,0.4)", padding: "1px 5px", borderRadius: 3 }}>mneme polygraph timeline --vendor {vendor} --window-days {windowDays}</code></>
          : <>Green line = honesty (green / (green + yellow + red)) per bucket. Gaps = no events that bucket. CLI: <code style={{ background: "rgba(0,0,0,0.4)", padding: "1px 5px", borderRadius: 3 }}>mneme polygraph timeline --vendor {vendor} --window-days {windowDays}</code></>}
      </p>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", padding: 12, borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)" }}>
      <div style={{ color: "#9ba1a6", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{label}</div>
      <div style={{ color: color ?? "#fff", fontSize: 20, fontWeight: 700, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{value}</div>
    </div>
  );
}

function renderLineChart(series: TimelineSeries): JSX.Element {
  const W = 1180, H = 280, padL = 40, padR = 20, padT = 20, padB = 32;
  const cw = W - padL - padR, ch = H - padT - padB;
  const n = series.buckets.length;
  const stepX = n > 1 ? cw / (n - 1) : cw;
  const points = series.buckets
    .map((b, i) => ({ i, b, x: padL + i * stepX, y: b.honestyPct == null ? null : padT + ch * (1 - b.honestyPct) }))
    .filter((p) => p.y !== null) as Array<{ i: number; b: TimelineBucket; x: number; y: number }>;
  const pathD = points.length > 1
    ? "M " + points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ")
    : "";
  // Background grid (4 horizontal lines at 0/25/50/75/100%).
  const gridLines: JSX.Element[] = [];
  for (let pct = 0; pct <= 100; pct += 25) {
    const y = padT + ch * (1 - pct / 100);
    gridLines.push(<line key={`g${pct}`} x1={padL} y1={y} x2={W - padR} y2={y} stroke="rgba(243,128,32,0.12)" strokeWidth={1} />);
    gridLines.push(<text key={`gl${pct}`} x={padL - 6} y={y + 3} textAnchor="end" fill="#6e7681" fontSize={9} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">{pct}%</text>);
  }
  // X-axis labels (first / middle / last bucket dates).
  const xLabels: JSX.Element[] = [];
  if (n > 0) {
    const positions = [0, Math.floor(n / 2), n - 1];
    for (const i of positions) {
      const b = series.buckets[i]!;
      const x = padL + i * stepX;
      xLabels.push(<text key={`x${i}`} x={x} y={H - 10} textAnchor="middle" fill="#9ba1a6" fontSize={10} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">{b.bucketStart.slice(5, 10)}</text>);
    }
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {gridLines}
      {pathD && <path d={pathD} fill="none" stroke="#3fb950" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
      {points.map((p, i) => {
        const col = p.b.green / Math.max(1, p.b.green + p.b.yellow + p.b.red);
        const dotColor = col > 0.7 ? "#3fb950" : col > 0.4 ? "#f7d34c" : "#ff5b5b";
        return <circle key={i} cx={p.x} cy={p.y} r={3} fill={dotColor} />;
      })}
      {xLabels}
    </svg>
  );
}

// Browser-side fallback when bridge is unreachable.
function synthSeries(vendor: string, windowDays: number): TimelineSeries {
  const bucketHours = 24;
  const buckets: TimelineBucket[] = [];
  let cumGreen = 0, cumJudged = 0, minH: number | null = null, maxH: number | null = null;
  for (let day = 0; day < windowDays; day++) {
    const ts = Date.now() - (windowDays - 1 - day) * 24 * 3600_000;
    const total = 5 + Math.floor(Math.random() * 18);
    // Slight upward drift over time for the demo so the line has a story.
    const baseHonesty = 0.55 + (day / windowDays) * 0.18 + (Math.random() - 0.5) * 0.18;
    const honest = Math.max(0.1, Math.min(0.95, baseHonesty));
    const green = Math.round(total * honest);
    const red = Math.round(total * (1 - honest) * 0.4);
    const yellow = Math.max(0, total - green - red);
    const judged = green + yellow + red;
    const h = judged > 0 ? green / judged : null;
    if (h != null) {
      cumGreen += green; cumJudged += judged;
      if (minH == null || h < minH) minH = h;
      if (maxH == null || h > maxH) maxH = h;
    }
    buckets.push({
      bucketStart: new Date(Math.floor(ts / (bucketHours * 3600_000)) * bucketHours * 3600_000).toISOString(),
      total, green, yellow, red, grey: 0,
      honestyPct: h,
    });
  }
  const nonNull = buckets.filter((b) => b.honestyPct != null) as Array<TimelineBucket & { honestyPct: number }>;
  const drift = nonNull.length >= 2 ? nonNull[nonNull.length - 1]!.honestyPct - nonNull[0]!.honestyPct : null;
  return {
    vendor, windowDays, bucketHours, buckets,
    minHonesty: minH, maxHonesty: maxH, drift,
    meanHonesty: cumJudged > 0 ? cumGreen / cumJudged : null,
  };
}
