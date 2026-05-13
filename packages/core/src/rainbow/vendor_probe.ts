/**
 * v1.98.0 -- RAINBOW · Vendor URL probe.
 *
 * Closes the "comment lies" gap that v1.85-1.96 had: code comments
 * claimed "Verified May 2026" but no test actually hit the vendor URL.
 * The user found that `chat.openai.com` had been replaced by
 * `chatgpt.com` more than a year prior and our code was still pointing
 * at the dead host.
 *
 * This module does the simplest thing that catches stale URLs: HEAD
 * each vendor home URL, record the response status + final URL after
 * redirects + whether the host changed. If the host changes (e.g.
 * chat.openai.com → chatgpt.com via 308), we flag it loudly.
 *
 * NOT a Playwright integration test — those need browser binaries +
 * are flaky in CI. This is a deterministic, fast (one HEAD per
 * vendor), zero-dependency check that the URL is at least reachable
 * and not silently redirected to a different host.
 *
 * Run via:
 *   - Manually: `node -e "import('./vendor_probe.js').then(m => m.probeAllVendors().then(console.log))"`
 *   - In CI:    daemon's nightly cycle (future) — surfaces stale URLs as inbox warnings
 *   - Test:     `vendor_probe.test.ts` mocks fetch + asserts the redirect-detection logic
 */

import { VENDOR_REGISTRY, type VendorEntry } from "./vendor_strategy.js";

export interface ProbeResult {
  vendor: string;
  url: string;
  finalUrl: string | null;
  status: number | null;
  hostChanged: boolean;
  /** Verdict: OK / REDIRECT_HOST_CHANGE / 404 / NETWORK_ERR / SKIP. */
  verdict: "OK" | "REDIRECT_HOST_CHANGE" | "NOT_FOUND" | "NETWORK_ERR" | "BLOCKED" | "SKIP";
  /** Notes for human / AI agent. */
  notes: string;
  elapsedMs: number;
}

export interface ProbeOptions {
  /** Override fetch (for tests). */
  fetchImpl?: typeof fetch;
  /** Max time per probe in ms. Default 8000. */
  timeoutMs?: number;
  /** User-Agent header. */
  userAgent?: string;
}

function hostOf(url: string): string | null {
  try { return new URL(url).host; } catch { return null; }
}

async function probeOne(entry: VendorEntry, opts: ProbeOptions = {}): Promise<ProbeResult> {
  const url = entry.homeUrl;
  if (!url || !url.startsWith("http")) {
    return {
      vendor: entry.id, url, finalUrl: null, status: null, hostChanged: false,
      verdict: "SKIP", notes: `non-HTTP url (probably an app deep-link scheme)`, elapsedMs: 0,
    };
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "HEAD",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": opts.userAgent ?? "Mneme-vendor-probe/1.98 (+https://github.com/patsa2561-art/mneme-ai)" },
    } as RequestInit);
    clearTimeout(timer);
    const elapsedMs = Date.now() - t0;
    const finalUrl = res.url || url;
    const originalHost = hostOf(url);
    const finalHost = hostOf(finalUrl);
    const hostChanged = !!(originalHost && finalHost && originalHost !== finalHost);

    let verdict: ProbeResult["verdict"];
    let notes: string;
    if (res.status === 404) {
      verdict = "NOT_FOUND";
      notes = `404 — vendor URL is dead`;
    } else if (res.status === 403 || res.status === 401) {
      verdict = "BLOCKED";
      notes = `${res.status} — vendor likely blocks bots (Cloudflare/UA). Browser-real users still work.`;
    } else if (hostChanged) {
      verdict = "REDIRECT_HOST_CHANGE";
      notes = `redirected from ${originalHost} to ${finalHost} — update vendor_strategy.ts homeUrl`;
    } else if (res.status >= 200 && res.status < 400) {
      verdict = "OK";
      notes = `reachable (status ${res.status})`;
    } else {
      verdict = "NETWORK_ERR";
      notes = `unexpected status ${res.status}`;
    }
    return { vendor: entry.id, url, finalUrl, status: res.status, hostChanged, verdict, notes, elapsedMs };
  } catch (e) {
    clearTimeout(timer);
    const elapsedMs = Date.now() - t0;
    return {
      vendor: entry.id, url, finalUrl: null, status: null, hostChanged: false,
      verdict: "NETWORK_ERR", notes: `fetch error: ${(e as Error).message}`, elapsedMs,
    };
  }
}

/** Probe every registered vendor concurrently. Returns one ProbeResult
 *  per vendor. Total elapsed time ≈ slowest probe. */
export async function probeAllVendors(opts: ProbeOptions = {}): Promise<ProbeResult[]> {
  return Promise.all(VENDOR_REGISTRY.map((v) => probeOne(v, opts)));
}

/** Probe results that should ALERT — anything that isn't OK or SKIP. */
export function failingProbes(results: ProbeResult[]): ProbeResult[] {
  return results.filter((r) => r.verdict !== "OK" && r.verdict !== "SKIP" && r.verdict !== "BLOCKED");
}

/** One-line summary suitable for the pulse / CI logs. */
export function formatProbePulseLine(results: ProbeResult[]): string {
  const groups: Record<ProbeResult["verdict"], number> = { OK: 0, REDIRECT_HOST_CHANGE: 0, NOT_FOUND: 0, NETWORK_ERR: 0, BLOCKED: 0, SKIP: 0 };
  for (const r of results) groups[r.verdict]++;
  const failing = failingProbes(results);
  const verdict = failing.length === 0 ? "✓ ALL_OK" : `✗ ${failing.length}_FAILING`;
  return `VENDOR-PROBE ${verdict} · ok=${groups.OK} redirect=${groups.REDIRECT_HOST_CHANGE} 404=${groups.NOT_FOUND} blocked=${groups.BLOCKED} skip=${groups.SKIP} err=${groups.NETWORK_ERR}`;
}
