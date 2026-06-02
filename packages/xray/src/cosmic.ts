/**
 * COSMIC MONITOR — an ADDITIVE superpower for the existing cosmic-link server.
 *
 * The X-Ray server (which we control, isolated on its own port) periodically
 * pings the cosmic server and turns its liveness into something cosmic never
 * had: a MEASURED, SIGNED, offline-verifiable uptime record + a public badge +
 * a status page. We never touch the cosmic process — only observe it over
 * localhost. This is the "make cosmic cooler without breaking it" move:
 * capability added from the outside, zero risk to the running service.
 */
import { notary } from "@mneme-ai/core";
import { existsSync, appendFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface Sample { ts: number; ok: boolean; latencyMs: number }

export interface CosmicStatus {
  url: string;
  up: boolean;
  lastCheck: number | null;
  uptimePct: number;     // measured over the window from OUR probes
  checks: number;
  p50Ms: number;
  p95Ms: number;
  sinceTs: number | null;
  windowMs: number;
}

/** Pure: compute status from a sample set (so the math is unit-testable). */
export function computeStatus(samples: Sample[], url: string, now: number, windowMs: number): CosmicStatus {
  const win = samples.filter((s) => now - s.ts <= windowMs);
  const checks = win.length;
  const okN = win.filter((s) => s.ok).length;
  const lats = win.filter((s) => s.ok).map((s) => s.latencyMs).sort((a, b) => a - b);
  const q = (p: number) => (lats.length ? lats[Math.min(lats.length - 1, Math.floor(p * lats.length))] : 0);
  const last = samples.length ? samples[samples.length - 1] : null;
  return {
    url,
    up: last ? last.ok : false,
    lastCheck: last ? last.ts : null,
    uptimePct: checks ? Math.round((okN / checks) * 10000) / 100 : 0,
    checks,
    p50Ms: q(0.5),
    p95Ms: q(0.95),
    sinceTs: win.length ? win[0].ts : null,
    windowMs,
  };
}

export class CosmicMonitor {
  private samples: Sample[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly cap = 5760; // ~24h at 15s

  constructor(private readonly url: string, private readonly file: string | null = null) {
    if (file && existsSync(file)) {
      try {
        this.samples = readFileSync(file, "utf8").trim().split("\n").filter(Boolean).slice(-this.cap).map((l) => JSON.parse(l) as Sample);
      } catch { /* ignore corrupt history */ }
    }
  }

  async probe(): Promise<Sample> {
    const t0 = Date.now();
    let ok = false, latencyMs = 0;
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(this.url, { signal: ctrl.signal });
      clearTimeout(to);
      ok = res.status >= 200 && res.status < 500; // reachable + not a server error
      latencyMs = Date.now() - t0;
    } catch {
      latencyMs = Date.now() - t0;
      ok = false;
    }
    const s: Sample = { ts: Date.now(), ok, latencyMs };
    this.samples.push(s);
    if (this.samples.length > this.cap) this.samples.shift();
    if (this.file) {
      try {
        if (!existsSync(dirname(this.file))) mkdirSync(dirname(this.file), { recursive: true });
        appendFileSync(this.file, JSON.stringify(s) + "\n");
      } catch { /* best-effort persistence */ }
    }
    return s;
  }

  start(intervalMs = 15000): void {
    if (this.timer) return;
    void this.probe();
    this.timer = setInterval(() => { void this.probe(); }, intervalMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }
  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  status(windowMs = 24 * 60 * 60 * 1000): CosmicStatus {
    return computeStatus(this.samples, this.url, Date.now(), windowMs);
  }
}

const C_LABEL = "cosmic link";
function flatBadge(label: string, value: string, color: string): string {
  const lw = 7 + label.length * 6.2, vw = 12 + value.length * 6.2, w = Math.round(lw + vw), h = 20;
  const lm = Math.round(lw / 2), vm = Math.round(lw + vw / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" role="img" aria-label="${label}: ${value}">
<clipPath id="r"><rect width="${w}" height="${h}" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${Math.round(lw)}" height="${h}" fill="#0a0a0a"/><rect x="${Math.round(lw)}" width="${Math.round(vw)}" height="${h}" fill="${color}"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11">
<text x="${lm}" y="14">${label}</text><text x="${vm}" y="14" font-weight="bold">${value}</text></g></svg>`;
}

export function cosmicBadgeSvg(st: CosmicStatus): string {
  if (!st.up) return flatBadge(C_LABEL, "down", "#dc2626");
  const val = st.checks >= 5 ? `up ${st.uptimePct}%` : "up";
  const color = st.uptimePct >= 99 || st.checks < 5 ? "#16a34a" : st.uptimePct >= 95 ? "#65a30d" : "#d97706";
  return flatBadge(C_LABEL, val, color);
}

/** A signed, offline-verifiable liveness attestation. Anyone can verify with the
 *  embedded public key that Mneme observed cosmic with this uptime. */
export function signCosmicStatus(repoRoot: string, st: CosmicStatus): unknown {
  return notary.issueReceipt(repoRoot, {
    kind: "claim-verdict",
    subject: `cosmic-liveness:${st.url}`,
    payload: st,
    includePayload: true,
  });
}
