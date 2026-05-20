/**
 * v2.19.84 — WORLD AI PULSE dashboard view.
 *
 * Rotating Canvas-2D globe + live blip animations + vendor leaderboard
 * + topic heatmap. Pulls live events from the Mneme bridge at
 * /v1/pulse/aggregate; falls back to synthetic stream when no bridge
 * is reachable (so the demo page on GitHub Pages still feels alive).
 *
 * NO Three.js — zero new bundle weight. Pure Canvas 2D with
 * orthographic projection of timezone centroids onto a rotating sphere.
 * Continents are stylised graticule rings (cyber-polygraph aesthetic
 * rather than photoreal Earth).
 */

import { useEffect, useMemo, useRef, useState } from "react";

// Approximate centroid lat/lon for each IANA timezone we emit from the
// userscript. NOT precise locations — coarse-by-design for privacy.
const TIMEZONE_CENTROIDS: Record<string, { lat: number; lon: number; label: string }> = {
  "America/Los_Angeles": { lat: 34.0, lon: -118.2, label: "Los Angeles" },
  "America/New_York":    { lat: 40.7, lon:  -74.0, label: "New York"    },
  "America/Chicago":     { lat: 41.9, lon:  -87.6, label: "Chicago"     },
  "America/Sao_Paulo":   { lat: -23.5,lon:  -46.6, label: "São Paulo"   },
  "Europe/London":       { lat: 51.5, lon:   -0.1, label: "London"      },
  "Europe/Berlin":       { lat: 52.5, lon:   13.4, label: "Berlin"      },
  "Europe/Paris":        { lat: 48.9, lon:    2.4, label: "Paris"       },
  "Europe/Madrid":       { lat: 40.4, lon:   -3.7, label: "Madrid"      },
  "Europe/Moscow":       { lat: 55.8, lon:   37.6, label: "Moscow"      },
  "Africa/Lagos":        { lat:  6.5, lon:    3.4, label: "Lagos"       },
  "Africa/Johannesburg": { lat:-26.2, lon:   28.0, label: "Johannesburg"},
  "Asia/Bangkok":        { lat: 13.8, lon:  100.5, label: "Bangkok"     },
  "Asia/Singapore":      { lat:  1.3, lon:  103.8, label: "Singapore"   },
  "Asia/Tokyo":          { lat: 35.7, lon:  139.7, label: "Tokyo"       },
  "Asia/Shanghai":       { lat: 31.2, lon:  121.5, label: "Shanghai"    },
  "Asia/Kolkata":        { lat: 22.6, lon:   88.4, label: "Kolkata"     },
  "Asia/Dubai":          { lat: 25.3, lon:   55.3, label: "Dubai"       },
  "Australia/Sydney":    { lat:-33.9, lon:  151.2, label: "Sydney"      },
};

// Simplified continent outlines — each is an array of [lat, lon] points
// drawn as a closed polygon on the sphere. ~50 vertices total, hand-picked
// for shape recognition without the 100KB+ of Natural Earth GeoJSON.
const CONTINENTS: Array<{ name: string; path: Array<[number, number]> }> = [
  { name: "Eurasia", path: [
    [70,-10],[68, 30],[60, 60],[55, 80],[50,110],[55,140],[45,140],
    [35,140],[25,120],[15,108],[10, 95],[20, 80],[15, 70],[25, 60],
    [30, 50],[35, 30],[36, 14],[43,  9],[48, -5],[55,  0],
  ]},
  { name: "Africa", path: [
    [36,-10],[30, 10],[15, 38],[ 0, 42],[-10,40],[-20,32],[-30,28],
    [-34,20],[-22,16],[-10, 8],[ 5, -6],[15,-17],[25,-15],
  ]},
  { name: "N. America", path: [
    [70,-160],[70,-100],[70, -60],[60, -55],[50, -60],[40, -75],
    [30, -82],[25,-100],[20,-105],[28,-115],[40,-125],[55,-135],
    [65,-150],
  ]},
  { name: "S. America", path: [
    [12, -72],[ 0, -50],[-15,-40],[-25,-45],[-35,-58],[-45,-70],
    [-55,-72],[-40,-75],[-25,-80],[-10,-79],[ 5, -78],
  ]},
  { name: "Australia", path: [
    [-12,130],[-13,143],[-25,153],[-35,150],[-38,140],[-35,125],
    [-22,115],[-15,122],
  ]},
];

type Verdict = "green" | "yellow" | "red" | "grey";

interface PulseEvent {
  ts: number;
  vendor: string;
  color: Verdict;
  regionTimezone?: string;
  topicHash?: string;
}

interface PulseAggregate {
  total: number;
  byColor: Record<Verdict, number>;
  byVendor: Record<string, { total: number; green: number; yellow: number; red: number; grey: number }>;
  byHour: Array<{ hour: string; count: number }>;
  byRegion: Record<string, number>;
  topTopics: Array<{ hash: string; count: number }>;
  freshestTs: number | null;
  windowHours: number;
  synthetic?: boolean;
}

interface Blip {
  lat: number;
  lon: number;
  color: Verdict;
  bornAt: number;
  vendor: string;
}

const COLOR_HEX: Record<Verdict, string> = {
  green:  "#3fb950",
  yellow: "#f7d34c",
  red:    "#ff5b5b",
  grey:   "#6e7681",
};

function projectToSphere(lat: number, lon: number, rotationDeg: number, cx: number, cy: number, r: number) {
  const lonR = ((lon + rotationDeg + 540) % 360 - 180) * Math.PI / 180;
  const latR = lat * Math.PI / 180;
  const x = Math.cos(latR) * Math.sin(lonR);
  const y = Math.sin(latR);
  const z = Math.cos(latR) * Math.cos(lonR);
  // Orthographic: visible only when z >= 0
  return { x: cx + x * r, y: cy - y * r, z };
}

function makeSyntheticEvents(): PulseEvent[] {
  // Browser fallback synthetic stream — must match the shape of the
  // server-side one in core.worldPulse so the dashboard renders the
  // same way whether the bridge is alive or not.
  const VENDORS = ["claude-ai", "chatgpt", "gemini", "copilot", "deepseek", "qwen"];
  const ZONES = Object.keys(TIMEZONE_CENTROIDS);
  const W: Array<[Verdict, number]> = [["green", 60], ["yellow", 25], ["red", 12], ["grey", 3]];
  const totalW = W.reduce((s, [, w]) => s + w, 0);
  const out: PulseEvent[] = [];
  const now = Date.now();
  for (let i = 0; i < 240; i++) {
    let r = Math.random() * totalW; let c: Verdict = "green";
    for (const [color, w] of W) { r -= w; if (r <= 0) { c = color; break; } }
    out.push({
      ts: now - Math.floor(Math.random() * 60 * 60_000),
      vendor: VENDORS[Math.floor(Math.random() * VENDORS.length)]!,
      color: c,
      regionTimezone: ZONES[Math.floor(Math.random() * ZONES.length)],
      topicHash: Math.floor(Math.random() * 16).toString(16).padStart(6, "0"),
    });
  }
  return out.sort((a, b) => b.ts - a.ts);
}

function buildAggregateFromEvents(events: PulseEvent[], windowHours: number, synthetic: boolean): PulseAggregate {
  const cutoff = Date.now() - windowHours * 3600_000;
  const inWin = events.filter((e) => e.ts >= cutoff);
  const agg: PulseAggregate = {
    total: inWin.length,
    byColor: { green: 0, yellow: 0, red: 0, grey: 0 },
    byVendor: {},
    byHour: [],
    byRegion: {},
    topTopics: [],
    freshestTs: inWin.length > 0 ? Math.max(...inWin.map((e) => e.ts)) : null,
    windowHours,
    synthetic,
  };
  const hourBuckets = new Map<string, number>();
  const topicBuckets = new Map<string, number>();
  for (const e of inWin) {
    agg.byColor[e.color] += 1;
    if (!agg.byVendor[e.vendor]) agg.byVendor[e.vendor] = { total: 0, green: 0, yellow: 0, red: 0, grey: 0 };
    agg.byVendor[e.vendor]!.total += 1;
    agg.byVendor[e.vendor]![e.color] += 1;
    if (e.regionTimezone) agg.byRegion[e.regionTimezone] = (agg.byRegion[e.regionTimezone] ?? 0) + 1;
    const hourKey = new Date(e.ts).toISOString().slice(0, 13) + ":00";
    hourBuckets.set(hourKey, (hourBuckets.get(hourKey) ?? 0) + 1);
    if (e.topicHash) topicBuckets.set(e.topicHash, (topicBuckets.get(e.topicHash) ?? 0) + 1);
  }
  agg.byHour = [...hourBuckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([h, c]) => ({ hour: h, count: c }));
  agg.topTopics = [...topicBuckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([h, c]) => ({ hash: h, count: c }));
  return agg;
}

export function WorldPulseView(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [aggregate, setAggregate] = useState<PulseAggregate | null>(null);
  const [bridgeAlive, setBridgeAlive] = useState<boolean>(false);
  const [bridgeUrl, setBridgeUrl] = useState<string | null>(null);
  const [rotation, setRotation] = useState<number>(0);
  const [dragging, setDragging] = useState<boolean>(false);
  const dragStateRef = useRef<{ startX: number; startRot: number }>({ startX: 0, startRot: 0 });
  const blipsRef = useRef<Blip[]>([]);
  // v2.19.86 — Mint Cert modal state.
  const [mintingVendor, setMintingVendor] = useState<string | null>(null);
  const [mintResult, setMintResult] = useState<{ svg: string; certId: string; band: string; honestyPct: number; sampleSize: number } | null>(null);

  const lang = useMemo<"en" | "th">(() => {
    try { const v = localStorage.getItem("mneme-lang"); if (v === "th" || v === "en") return v; return /^th/i.test(navigator.language || "") ? "th" : "en"; }
    catch { return "en"; }
  }, []);

  // ── Data fetch: try the local bridge ladder; fall back to synthetic ──
  useEffect(() => {
    let cancelled = false;
    let interval: number | null = null;

    async function probeBridge(): Promise<string | null> {
      // Try .mneme/bridge.json beacon via well-known relative path? We're
      // in the browser, no filesystem. Just probe the ladder directly.
      for (let i = 0; i < 10; i++) {
        const url = `http://127.0.0.1:${17741 + i}`;
        try {
          const res = await fetch(url + "/v1/ping", { signal: AbortSignal.timeout(400) });
          if (res.ok) return url;
        } catch {}
      }
      return null;
    }

    async function refresh() {
      const bridge = await probeBridge();
      if (cancelled) return;
      setBridgeAlive(!!bridge);
      setBridgeUrl(bridge);
      if (bridge) {
        try {
          const res = await fetch(bridge + "/v1/pulse/aggregate?windowHours=24&includeSynthetic=true", {
            signal: AbortSignal.timeout(1500),
          });
          if (res.ok) {
            const agg = await res.json() as PulseAggregate;
            if (!cancelled) setAggregate(agg);
            return;
          }
        } catch {}
      }
      // Fallback: synthetic stream so the demo on GitHub Pages stays alive.
      const synth = makeSyntheticEvents();
      if (!cancelled) {
        setAggregate(buildAggregateFromEvents(synth, 24, true));
      }
    }
    refresh();
    interval = window.setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
    };
  }, []);

  // ── Blip emitter: each refresh, take fresh events and spawn blips ──
  useEffect(() => {
    if (!aggregate) return;
    // Spawn ~one blip per region every refresh weighted by region count.
    const total = Object.values(aggregate.byRegion).reduce((s, n) => s + n, 0) || 1;
    const newBlips: Blip[] = [];
    for (const [zone, count] of Object.entries(aggregate.byRegion)) {
      const c = TIMEZONE_CENTROIDS[zone];
      if (!c) continue;
      // 1-3 blips per region per refresh, scaled by share.
      const share = count / total;
      const n = Math.max(1, Math.round(share * 8));
      for (let i = 0; i < n; i++) {
        // Pick a colour weighted by overall byColor distribution.
        const r = Math.random() * aggregate.total;
        const cum = aggregate.byColor;
        let color: Verdict = "green";
        let acc = cum.green;
        if (r > acc) { color = "yellow"; acc += cum.yellow; }
        if (r > acc) { color = "red";    acc += cum.red; }
        if (r > acc) { color = "grey"; }
        // Jitter the centroid slightly so blips don't all stack.
        newBlips.push({
          lat: c.lat + (Math.random() - 0.5) * 6,
          lon: c.lon + (Math.random() - 0.5) * 6,
          color,
          bornAt: Date.now() - Math.floor(Math.random() * 1200),
          vendor: "synthetic",
        });
      }
    }
    blipsRef.current = [...blipsRef.current, ...newBlips].slice(-220); // keep last 220
  }, [aggregate]);

  // ── Globe render loop ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2;
      const r = Math.min(W, H) * 0.42;

      // Auto-rotate when not dragging.
      const rot = rotation;

      // Backdrop: subtle radial glow simulating space haze.
      const bg = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 1.4);
      bg.addColorStop(0, "rgba(243, 128, 32, 0.06)");
      bg.addColorStop(1, "rgba(10, 10, 14, 0)");
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.4, 0, Math.PI * 2); ctx.fill();

      // Sphere body: dark with a faint shaded gradient.
      const sphereGrad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
      sphereGrad.addColorStop(0, "#1a1a22");
      sphereGrad.addColorStop(1, "#08080c");
      ctx.fillStyle = sphereGrad;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(243, 128, 32, 0.55)";
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Graticule: lat every 30°, lon every 30°.
      ctx.strokeStyle = "rgba(243, 128, 32, 0.12)";
      ctx.lineWidth = 0.7;
      // Latitudes
      for (let lat = -60; lat <= 60; lat += 30) {
        ctx.beginPath();
        let started = false;
        for (let lon = -180; lon <= 180; lon += 4) {
          const p = projectToSphere(lat, lon, rot, cx, cy, r);
          if (p.z < 0) { started = false; continue; }
          if (!started) { ctx.moveTo(p.x, p.y); started = true; }
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
      // Longitudes
      for (let lon = -180; lon < 180; lon += 30) {
        ctx.beginPath();
        let started = false;
        for (let lat = -90; lat <= 90; lat += 4) {
          const p = projectToSphere(lat, lon, rot, cx, cy, r);
          if (p.z < 0) { started = false; continue; }
          if (!started) { ctx.moveTo(p.x, p.y); started = true; }
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }

      // Continent outlines.
      ctx.strokeStyle = "rgba(243, 128, 32, 0.75)";
      ctx.lineWidth = 1.4;
      for (const cont of CONTINENTS) {
        ctx.beginPath();
        let started = false;
        for (const [lat, lon] of cont.path) {
          const p = projectToSphere(lat, lon, rot, cx, cy, r);
          if (p.z < 0) { started = false; continue; }
          if (!started) { ctx.moveTo(p.x, p.y); started = true; }
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }

      // Blips: expanding rings with fade. Cull when on back of globe.
      const now = Date.now();
      const live: Blip[] = [];
      for (const b of blipsRef.current) {
        const age = now - b.bornAt;
        if (age > 2400) continue;  // expire after 2.4s
        live.push(b);
        const p = projectToSphere(b.lat, b.lon, rot, cx, cy, r);
        if (p.z < 0) continue;
        const t = age / 2400;
        const radius = 2 + t * 18;
        const alpha = 1 - t;
        const hex = COLOR_HEX[b.color];
        ctx.strokeStyle = hex + Math.floor(alpha * 255).toString(16).padStart(2, "0");
        ctx.lineWidth = 2 - t * 1.6;
        ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.stroke();
        // Solid center dot
        if (t < 0.4) {
          ctx.fillStyle = hex;
          ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2); ctx.fill();
        }
      }
      blipsRef.current = live;

      // City labels — only zones that have events in this aggregate.
      if (aggregate) {
        ctx.fillStyle = "rgba(247, 211, 76, 0.7)";
        ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
        for (const zone of Object.keys(aggregate.byRegion)) {
          const c = TIMEZONE_CENTROIDS[zone];
          if (!c) continue;
          const p = projectToSphere(c.lat, c.lon, rot, cx, cy, r);
          if (p.z < 0.2) continue;
          ctx.fillText(c.label, p.x + 8, p.y - 4);
        }
      }
    };

    let raf = 0;
    let lastTick = performance.now();
    const tick = (t: number) => {
      const dt = t - lastTick;
      lastTick = t;
      if (!dragging) setRotation((prev) => (prev + dt * 0.012) % 360);
      draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [aggregate, dragging, rotation]);

  const totalCaught = aggregate ? aggregate.byColor.red + aggregate.byColor.yellow : 0;
  const totalConfirmed = aggregate ? aggregate.byColor.green : 0;
  const topVendors = aggregate
    ? Object.entries(aggregate.byVendor)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 6)
    : [];

  // v2.19.86 — Mint Honesty Certificate via bridge.
  async function mintCertFor(vendor: string) {
    if (!bridgeUrl) {
      alert(lang === "th"
        ? "ต้องรัน `mneme bridge` ก่อน (หรือใช้ `mneme polygraph autosetup`) เพื่อ mint cert จากเครื่องของคุณ"
        : "Bridge offline — run `mneme bridge` (or `mneme polygraph autosetup`) first to mint the cert from your local pulse ledger.");
      return;
    }
    setMintingVendor(vendor);
    setMintResult(null);
    try {
      const res = await fetch(bridgeUrl + "/v1/honesty/mint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor, windowDays: 30, validDays: 30 }),
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json() as { ok: boolean; cert?: { certId: string; band: string; honestyPct: number; sampleSize: number }; svg?: string };
      if (data.ok && data.cert && data.svg) {
        setMintResult({
          svg: data.svg,
          certId: data.cert.certId,
          band: data.cert.band,
          honestyPct: data.cert.honestyPct,
          sampleSize: data.cert.sampleSize,
        });
      }
    } catch (e) {
      alert("Mint failed: " + (e as Error).message);
      setMintingVendor(null);
    }
  }

  function copyToClipboard(s: string) {
    try { navigator.clipboard.writeText(s); } catch {}
  }

  function downloadSvg(svg: string, vendor: string) {
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `mneme-cert-${vendor}.svg`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    setDragging(true);
    dragStateRef.current = { startX: e.clientX, startRot: rotation };
  }
  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!dragging) return;
    const dx = e.clientX - dragStateRef.current.startX;
    setRotation((dragStateRef.current.startRot + dx * 0.6) % 360);
  }
  function onMouseUp() { setDragging(false); }

  return (
    <div style={{ padding: "20px 18px 40px", color: "#e6e6e6", maxWidth: 1280, margin: "0 auto" }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: "#fff", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 30 }}>🌍</span>
          {lang === "th" ? "World AI Pulse" : "World AI Pulse"}
          <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: 999, background: bridgeAlive ? "#34d399" : "#94a3b8", color: bridgeAlive ? "#022c22" : "#0f172a", fontWeight: 700 }}>
            {bridgeAlive ? "LIVE" : "DEMO"}
          </span>
        </h1>
        <p style={{ margin: "8px 0 0 0", color: "#9ba1a6", fontSize: 13, lineHeight: 1.6, maxWidth: 820 }}>
          {lang === "th"
            ? "ทุกๆ จุดสีบนลูกโลกคือ Browser Polygraph จับคำตอบของ AI ในเบราว์เซอร์ของผู้ใช้ — เขียวคือยืนยัน, แดงคือ refute, เหลืองคือมีหลักฐานปนกัน. ไม่มีการเก็บข้อความคำถามหรือคำตอบใดๆ — เฉพาะสี + vendor + IANA timezone (anonymous)."
            : "Every blip is a Browser Polygraph verdict from a user's AI chat — green = confirmed, red = refuted, yellow = mixed evidence. No question text, no answer text, no IP — only color + vendor + IANA timezone, anonymous by design."}
        </p>
        {aggregate?.synthetic && (
          <p style={{ margin: "8px 0 0 0", padding: "8px 12px", borderRadius: 6, background: "rgba(148,163,184,0.10)", border: "1px solid rgba(148,163,184,0.3)", color: "#cbd5e1", fontSize: 12 }}>
            {lang === "th"
              ? <><strong>DEMO MODE</strong> — bridge ยังไม่ทำงาน. ติดตั้ง Mneme + รัน <code style={{ background: "rgba(0,0,0,0.4)", padding: "1px 6px", borderRadius: 3 }}>mneme polygraph autosetup</code> เพื่อให้ globe นี้ pulse จากข้อมูลจริงของคุณเอง</>
              : <><strong>DEMO MODE</strong> — no Mneme bridge detected. Install Mneme and run <code style={{ background: "rgba(0,0,0,0.4)", padding: "1px 6px", borderRadius: 3 }}>mneme polygraph autosetup</code> to see this globe pulse with YOUR real verdicts.</>}
          </p>
        )}
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gap: 24, alignItems: "stretch" }}>
        {/* GLOBE */}
        <section style={{ position: "relative", aspectRatio: "1 / 1", maxHeight: 640, background: "#0a0a0e", borderRadius: 14, border: "1px solid rgba(243,128,32,0.30)", overflow: "hidden" }}>
          <canvas
            ref={canvasRef}
            style={{ width: "100%", height: "100%", display: "block", cursor: dragging ? "grabbing" : "grab" }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          />
          {/* Counter overlay */}
          <div style={{ position: "absolute", top: 14, left: 14, color: "#9ba1a6", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11, lineHeight: 1.6, background: "rgba(0,0,0,0.55)", padding: "8px 12px", borderRadius: 6, border: "1px solid rgba(243,128,32,0.30)" }}>
            <div style={{ color: "#fff", fontWeight: 700, marginBottom: 4 }}>{aggregate?.windowHours ?? 24}H WINDOW</div>
            <div>● green : {aggregate?.byColor.green ?? 0}</div>
            <div>● yellow: {aggregate?.byColor.yellow ?? 0}</div>
            <div>● red   : {aggregate?.byColor.red ?? 0}</div>
            <div style={{ marginTop: 4, color: "#666" }}>total: {aggregate?.total ?? 0}</div>
          </div>
        </section>

        {/* SIDE PANEL */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* HALLUCINATIONS CAUGHT */}
          <div style={{ padding: 18, borderRadius: 12, background: "linear-gradient(135deg, rgba(255,91,91,0.10), rgba(99,102,241,0.06))", border: "1px solid rgba(255,91,91,0.35)" }}>
            <div style={{ fontSize: 11, color: "#fca5a5", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
              {lang === "th" ? "ที่ Mneme จับได้ (24 ชม)" : "Mneme caught (24h)"}
            </div>
            <div style={{ fontSize: 38, fontWeight: 800, color: "#fff", lineHeight: 1.1 }}>{totalCaught.toLocaleString()}</div>
            <div style={{ fontSize: 12, color: "#fca5a5", marginTop: 4 }}>
              {lang === "th" ? `ยืนยันเพิ่ม ${totalConfirmed.toLocaleString()} ประโยค` : `+${totalConfirmed.toLocaleString()} confirmed`}
            </div>
          </div>

          {/* LEADERBOARD */}
          <div style={{ padding: 16, borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontSize: 11, color: "#9ba1a6", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>
              {lang === "th" ? "Vendor honesty leaderboard" : "Vendor honesty leaderboard"}
            </div>
            {topVendors.length === 0 && (
              <div style={{ fontSize: 12, color: "#666" }}>{lang === "th" ? "ยังไม่มีข้อมูล" : "no data yet"}</div>
            )}
            {topVendors.map(([vendor, stats]) => {
              const honestyPct = stats.total > 0 ? Math.round((stats.green / stats.total) * 100) : 0;
              const refutePct = stats.total > 0 ? Math.round((stats.red / stats.total) * 100) : 0;
              return (
                <div key={vendor} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4, alignItems: "center" }}>
                    <span style={{ color: "#fff", fontWeight: 600 }}>{vendor}</span>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ color: "#9ba1a6", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11 }}>{stats.total}</span>
                      {bridgeAlive && stats.total > 0 && (
                        <button
                          onClick={() => mintCertFor(vendor)}
                          title={lang === "th" ? "ออก Mneme Honesty Certificate สำหรับ vendor นี้" : "Mint Mneme Honesty Certificate for this vendor"}
                          style={{
                            background: "linear-gradient(135deg, #f7d34c, #f38020)",
                            color: "#0a0a0e", border: 0,
                            padding: "2px 8px", borderRadius: 4, fontSize: 10,
                            fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                          }}
                        >🏆 Mint cert</button>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "rgba(255,255,255,0.04)" }}>
                    <div style={{ width: `${honestyPct}%`, background: "#3fb950" }} />
                    <div style={{ width: `${(stats.yellow / Math.max(1, stats.total)) * 100}%`, background: "#f7d34c" }} />
                    <div style={{ width: `${refutePct}%`, background: "#ff5b5b" }} />
                  </div>
                  <div style={{ fontSize: 10, color: "#666", marginTop: 2, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                    {honestyPct}% trustworthy · {refutePct}% refuted
                  </div>
                </div>
              );
            })}
          </div>

          {/* TOPIC HEATMAP */}
          {aggregate && aggregate.topTopics.length > 0 && (
            <div style={{ padding: 16, borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ fontSize: 11, color: "#9ba1a6", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>
                {lang === "th" ? "หัวข้อยอดฮิต (topic clusters)" : "Hot topics (clustered)"}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
                {aggregate.topTopics.map((t, idx) => {
                  const intensity = Math.min(1, t.count / Math.max(1, aggregate.topTopics[0]!.count));
                  return (
                    <div key={t.hash} title={`${t.hash} — ${t.count} hits`} style={{
                      aspectRatio: "1 / 1",
                      borderRadius: 4,
                      background: `rgba(243, 128, 32, ${0.18 + intensity * 0.6})`,
                      border: "1px solid rgba(243, 128, 32, 0.40)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      fontSize: 10, color: idx < 3 ? "#fff" : "#fed7aa",
                    }}>{t.count}</div>
                  );
                })}
              </div>
              <div style={{ fontSize: 10, color: "#666", marginTop: 6 }}>
                {lang === "th"
                  ? "แต่ละ cell คือ topic hash (6 bytes) — ความเข้มสีคือจำนวน hit. ไม่มีข้อความ"
                  : "Each cell is a 6-byte topic hash — colour intensity = hit count. No sentence text."}
              </div>
            </div>
          )}

          {/* JOIN THE GLOBAL PULSE (opt-in, ROADMAP placeholder) */}
          <div style={{ padding: 14, borderRadius: 10, background: "rgba(99,102,241,0.06)", border: "1px dashed rgba(99,102,241,0.40)" }}>
            <div style={{ fontSize: 11, color: "#c7d2fe", fontWeight: 600, marginBottom: 4 }}>
              🌐 {lang === "th" ? "Join the global pulse" : "Join the global pulse"} <span style={{ color: "#94a3b8", fontWeight: 400, marginLeft: 6 }}>(ROADMAP)</span>
            </div>
            <div style={{ fontSize: 11, color: "#a5b4fc", lineHeight: 1.5 }}>
              {lang === "th"
                ? "Opt-in กับ public collector — ส่งเฉพาะ color + vendor + timezone (anonymous, NEVER claim text) เพื่อเข้าร่วม leaderboard ทั่วโลก. รุ่นหน้าจะมาพร้อม Cloudflare Worker registry."
                : "Opt in to a public collector — sends color + vendor + timezone only (anonymous, NEVER claim text) to power the global leaderboard. Ships next with a Cloudflare Worker registry."}
            </div>
          </div>
        </aside>
      </div>

      {/* v2.19.86 — Mint Cert modal. Shows the embedded SVG + copy / download. */}
      {mintingVendor && (
        <div
          onClick={() => { setMintingVendor(null); setMintResult(null); }}
          style={{ position: "fixed", inset: 0, zIndex: 99999, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 640, width: "100%", background: "#0a0a0e", border: "1px solid rgba(243,128,32,0.4)", borderRadius: 12, padding: 24, color: "#e6e6e6" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#f7d34c" }}>
                🏆 {lang === "th" ? `Mneme Honesty Certificate — ${mintingVendor}` : `Mneme Honesty Certificate — ${mintingVendor}`}
              </h2>
              <span style={{ cursor: "pointer", color: "#9ba1a6", fontSize: 20 }} onClick={() => { setMintingVendor(null); setMintResult(null); }}>✕</span>
            </div>
            {!mintResult ? (
              <div style={{ padding: 24, textAlign: "center", color: "#9ba1a6" }}>
                {lang === "th" ? "กำลังสร้าง certificate..." : "Minting…"}
              </div>
            ) : (
              <>
                <div style={{ background: "#1a1a22", borderRadius: 8, padding: 14, marginBottom: 12 }} dangerouslySetInnerHTML={{ __html: mintResult.svg }} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12, color: "#9ba1a6", marginBottom: 14, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                  <div>tier: <span style={{ color: "#fff" }}>{mintResult.band.toUpperCase()}</span></div>
                  <div>cert: <span style={{ color: "#fff" }}>{mintResult.certId}</span></div>
                  <div>honesty: <span style={{ color: "#fff" }}>{(mintResult.honestyPct * 100).toFixed(1)}%</span></div>
                  <div>samples: <span style={{ color: "#fff" }}>{mintResult.sampleSize}</span></div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => downloadSvg(mintResult.svg, mintingVendor)} style={{ background: "#f38020", color: "#0a0a0e", border: 0, padding: "8px 14px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                    ⬇ {lang === "th" ? "ดาวน์โหลด SVG" : "Download SVG"}
                  </button>
                  <button onClick={() => copyToClipboard(mintResult.svg)} style={{ background: "rgba(255,255,255,0.06)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", padding: "8px 14px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                    📋 {lang === "th" ? "คัดลอก SVG" : "Copy SVG"}
                  </button>
                  <button onClick={() => copyToClipboard(`<img src="data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(mintResult.svg)))}" alt="Mneme Honesty Certificate" />`)} style={{ background: "rgba(255,255,255,0.06)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", padding: "8px 14px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                    🔗 {lang === "th" ? "คัดลอก embed code" : "Copy embed code"}
                  </button>
                </div>
                <p style={{ marginTop: 14, fontSize: 11, color: "#9ba1a6", lineHeight: 1.5 }}>
                  {lang === "th"
                    ? <>SVG นี้มี cert payload ฝังอยู่ใน <code style={{ background: "rgba(0,0,0,0.4)", padding: "1px 5px", borderRadius: 3 }}>data-cert</code> attribute. ใครก็ verify ได้ด้วย <code style={{ background: "rgba(0,0,0,0.4)", padding: "1px 5px", borderRadius: 3 }}>mneme cert verify --svg cert.svg</code> (ถ้า key เดียวกัน)</>
                    : <>The SVG embeds the cert payload in its <code style={{ background: "rgba(0,0,0,0.4)", padding: "1px 5px", borderRadius: 3 }}>data-cert</code> attribute. Anyone with the same pulse key can re-verify via <code style={{ background: "rgba(0,0,0,0.4)", padding: "1px 5px", borderRadius: 3 }}>mneme cert verify --svg cert.svg</code></>}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
