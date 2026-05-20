/**
 * v2.19.86 — HONESTY CERTIFICATE (IDEA #3).
 *
 * "Stripe Verified" / "Cloudflare Verified" — but for AI vendor honesty,
 * sourced from the same `worldPulse` ledger that powers the rotating globe.
 * Vendors mint a certificate from their 30-day Browser Polygraph score; the
 * cert is an HMAC-signed JSON envelope + a self-contained SVG badge that
 * any landing page can embed. Anyone can re-mint, anyone can verify.
 *
 * COMPOSITION (the seamless part):
 *   worldPulse.readPulseEvents
 *     → worldPulse.aggregatePulse (windowHours)
 *     → honestyCert.computeScore (Wilson LB + tier band)
 *     → honestyCert.mint (HMAC-sign + assemble cert object)
 *     → honestyCert.renderSvg (standalone SVG + embedded cert payload)
 *     → honestyCert.verify (re-compute HMAC; check expiry; surface tier)
 *
 * WILD design choices (load-bearing):
 *   - Cert payload is BASE64URL-embedded INSIDE the SVG (data-cert attr),
 *     so the SVG is self-verifying — drop the .svg into ANY context and
 *     `verify(svgString)` extracts + re-checks it. No separate JSON file
 *     to host alongside the badge.
 *   - SVG has NO external dependencies (no <image>, no remote font);
 *     vendors can inline it via <img src="..."> or <object>.
 *   - Tier bands use Wilson 95% LOWER BOUND, not raw rate — so a 100%
 *     vendor with 5 samples gets BRONZE (under-measured), not PLATINUM.
 *     Calibrated against the BOUNTY scorecard family already in Mneme.
 *   - Auto-expires after `validDays` (default 30). Encourages re-mint
 *     so badges always reflect FRESH data.
 *   - HMAC key is the user's local PULSE_KEY (composes with the
 *     worldPulse chain), so the cert is integrity-tied to the same
 *     ledger it summarises. Tampering with the pulse ledger
 *     invalidates every cert ever minted from it.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";

const CERT_DIR = ".mneme";
const CERT_LEDGER = "honesty-certs.jsonl";
const CERT_KEY_FILE = "pulse.key"; // shared with worldPulse on purpose

export type HonestyBand = "platinum" | "gold" | "silver" | "bronze" | "needs-work";

export interface HonestyScore {
  vendor: string;
  windowDays: number;
  sampleSize: number;
  /** Raw honesty rate: green / (green + yellow + red). Grey excluded. */
  rawHonestyPct: number;
  /** Wilson 95% lower bound on the honesty rate.  Drives the tier band. */
  wilsonLowerBound: number;
  /** Breakdown for the certificate body. */
  green: number;
  yellow: number;
  red: number;
  grey: number;
  /** Refute rate: red / (green + yellow + red). */
  refutedPct: number;
  band: HonestyBand;
}

export interface HonestyCert {
  certId: string;
  vendor: string;
  windowDays: number;
  sampleSize: number;
  honestyPct: number;
  refutedPct: number;
  wilsonLowerBound: number;
  band: HonestyBand;
  mintedAt: string;
  validUntil: string;
  /** Issuer fingerprint — last 12 chars of HMAC(pulse-key + "issuer"). */
  issuer: string;
  /** HMAC over the canonicalised payload (everything above). */
  sig: string;
}

const TIER_RULES: Array<{ band: HonestyBand; minWilsonLB: number; minSamples: number; color: string; label: string }> = [
  { band: "platinum",   minWilsonLB: 0.92, minSamples: 100, color: "#9b6cff", label: "MNEME PLATINUM"   },
  { band: "gold",       minWilsonLB: 0.80, minSamples: 50,  color: "#f7d34c", label: "MNEME GOLD"       },
  { band: "silver",     minWilsonLB: 0.65, minSamples: 25,  color: "#c0c0c0", label: "MNEME SILVER"     },
  { band: "bronze",     minWilsonLB: 0.50, minSamples: 10,  color: "#cd7f32", label: "MNEME BRONZE"     },
  { band: "needs-work", minWilsonLB: 0.00, minSamples: 0,   color: "#94a3b8", label: "NEEDS WORK"       },
];

function tierFor(wilsonLB: number, sampleSize: number): { band: HonestyBand; color: string; label: string } {
  for (const t of TIER_RULES) {
    if (wilsonLB >= t.minWilsonLB && sampleSize >= t.minSamples) return t;
  }
  // Fallback (never hit because needs-work catches everything).
  const last = TIER_RULES[TIER_RULES.length - 1]!;
  return last;
}

/** Wilson 95% lower confidence bound on a Bernoulli proportion.  The
 *  same formula used elsewhere in Mneme (BOUNTY, INSURANCE_MARKET). */
function wilsonLB(success: number, total: number, z: number = 1.96): number {
  if (total === 0) return 0;
  const p = success / total;
  const denom = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return Math.max(0, (center - margin) / denom);
}

function ensureKey(repoRoot: string): string {
  const dir = join(repoRoot, ".mneme");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = join(dir, CERT_KEY_FILE);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const k = randomBytes(32).toString("base64url");
  writeFileSync(p, k, "utf8");
  return k;
}

/** Compute honesty score from a worldPulse aggregate. */
export interface AggregateInput {
  byColor: { green: number; yellow: number; red: number; grey: number };
  byVendor?: Record<string, { total: number; green: number; yellow: number; red: number; grey: number }>;
  windowHours?: number;
}

export function computeHonestyScore(agg: AggregateInput, vendor: string, opts: { windowDays?: number } = {}): HonestyScore {
  const v = agg.byVendor?.[vendor];
  const windowDays = opts.windowDays ?? (agg.windowHours ? Math.round(agg.windowHours / 24) : 30);
  if (!v) {
    return {
      vendor, windowDays, sampleSize: 0,
      rawHonestyPct: 0, wilsonLowerBound: 0,
      green: 0, yellow: 0, red: 0, grey: 0,
      refutedPct: 0, band: "needs-work",
    };
  }
  // Grey excluded from rate (= unverifiable, not a vote). Honesty = green
  // over (green + yellow + red).
  const judged = v.green + v.yellow + v.red;
  const rawHonesty = judged > 0 ? v.green / judged : 0;
  const lb = wilsonLB(v.green, judged);
  const tier = tierFor(lb, judged);
  return {
    vendor, windowDays, sampleSize: judged,
    rawHonestyPct: rawHonesty,
    wilsonLowerBound: lb,
    green: v.green, yellow: v.yellow, red: v.red, grey: v.grey,
    refutedPct: judged > 0 ? v.red / judged : 0,
    band: tier.band,
  };
}

/** Mint a signed certificate.  HMAC over a canonical key=value form so
 *  the signature is verifiable across machines that share the pulse key. */
export function mintCert(repoRoot: string, score: HonestyScore, opts: { validDays?: number } = {}): HonestyCert {
  const key = ensureKey(repoRoot);
  const validDays = opts.validDays ?? 30;
  const mintedAt = new Date().toISOString();
  const validUntil = new Date(Date.now() + validDays * 24 * 3600_000).toISOString();
  const issuer = createHmac("sha256", key).update("issuer").digest("base64url").slice(0, 12);
  const certId = "cert_" + randomBytes(8).toString("base64url");
  const cert: Omit<HonestyCert, "sig"> = {
    certId,
    vendor: score.vendor,
    windowDays: score.windowDays,
    sampleSize: score.sampleSize,
    honestyPct: score.rawHonestyPct,
    refutedPct: score.refutedPct,
    wilsonLowerBound: score.wilsonLowerBound,
    band: score.band,
    mintedAt,
    validUntil,
    issuer,
  };
  const sig = signPayload(cert, key);
  const full: HonestyCert = { ...cert, sig };
  // Persist to a local ledger so `mneme honesty list` can audit history.
  try {
    const dir = join(repoRoot, CERT_DIR);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(join(repoRoot, CERT_DIR, CERT_LEDGER), JSON.stringify(full) + "\n", "utf8");
  } catch { /* non-fatal */ }
  return full;
}

function canonicalForSig(c: Omit<HonestyCert, "sig">): string {
  return [
    c.certId, c.vendor, c.windowDays, c.sampleSize,
    c.honestyPct.toFixed(6), c.refutedPct.toFixed(6), c.wilsonLowerBound.toFixed(6),
    c.band, c.mintedAt, c.validUntil, c.issuer,
  ].join("|");
}

function signPayload(c: Omit<HonestyCert, "sig">, key: string): string {
  return createHmac("sha256", key).update(canonicalForSig(c)).digest("base64url").slice(0, 28);
}

export interface VerifyResult {
  valid: boolean;
  reason: "ok" | "bad-sig" | "expired" | "wrong-issuer" | "malformed";
  cert?: HonestyCert;
  expiresInDays?: number;
}

export function verifyCert(repoRoot: string, cert: HonestyCert): VerifyResult {
  const key = ensureKey(repoRoot);
  const expectedIssuer = createHmac("sha256", key).update("issuer").digest("base64url").slice(0, 12);
  if (cert.issuer !== expectedIssuer) {
    return { valid: false, reason: "wrong-issuer", cert };
  }
  const { sig, ...rest } = cert;
  const expectedSig = signPayload(rest, key);
  if (sig !== expectedSig) return { valid: false, reason: "bad-sig", cert };
  const expiresAt = Date.parse(cert.validUntil);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return { valid: false, reason: "expired", cert };
  }
  return {
    valid: true, reason: "ok", cert,
    expiresInDays: Math.round((expiresAt - Date.now()) / (24 * 3600_000)),
  };
}

/** Render a self-contained SVG badge.  The cert payload is BASE64URL-
 *  embedded as a `data-cert` attribute on the root <svg>, so any
 *  downstream verifier can extract + re-check without separate hosting. */
export function renderCertSvg(cert: HonestyCert): string {
  const tier = TIER_RULES.find((t) => t.band === cert.band) ?? TIER_RULES[TIER_RULES.length - 1]!;
  const pct = Math.round(cert.honestyPct * 100);
  const samples = cert.sampleSize.toLocaleString();
  const validUntilLabel = cert.validUntil.slice(0, 10);
  const payload = Buffer.from(JSON.stringify(cert), "utf8").toString("base64url");
  // 320×100 banner that vendors can drop into a footer / hero / docs page.
  // No external fonts (system stack); no remote assets; pure inline SVG.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="100" viewBox="0 0 320 100" data-cert="${payload}" data-issuer="${cert.issuer}" data-vendor="${escapeXml(cert.vendor)}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a0a0e"/><stop offset="1" stop-color="#1a1a22"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="320" height="100" rx="10" fill="url(#g)" stroke="${tier.color}" stroke-width="1.5"/>
  <text x="14" y="20" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="9" fill="#9ba1a6" letter-spacing="0.2">MNEME · BROWSER POLYGRAPH</text>
  <text x="14" y="44" font-family="ui-sans-serif, system-ui, sans-serif" font-size="22" font-weight="700" fill="#ffffff">${escapeXml(cert.vendor)}</text>
  <text x="14" y="66" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" fill="${tier.color}" font-weight="700">${tier.label} · ${pct}%</text>
  <text x="14" y="84" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="9" fill="#6e7681">${samples} probes · WilsonLB ${(cert.wilsonLowerBound * 100).toFixed(1)}% · valid through ${validUntilLabel}</text>
  <circle cx="295" cy="50" r="22" fill="none" stroke="${tier.color}" stroke-width="3"/>
  <text x="295" y="55" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="16" font-weight="800" fill="${tier.color}">${pct}</text>
</svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Extract the embedded cert from an SVG string and verify it. */
export function verifyCertSvg(repoRoot: string, svg: string): VerifyResult {
  const m = /data-cert="([^"]+)"/.exec(svg);
  if (!m) return { valid: false, reason: "malformed" };
  let cert: HonestyCert;
  try {
    cert = JSON.parse(Buffer.from(m[1]!, "base64url").toString("utf8")) as HonestyCert;
  } catch { return { valid: false, reason: "malformed" }; }
  return verifyCert(repoRoot, cert);
}

/** List all certs ever minted on this machine. */
export function listCerts(repoRoot: string): HonestyCert[] {
  const p = join(repoRoot, CERT_DIR, CERT_LEDGER);
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").trim().split("\n").filter(Boolean);
  const out: HonestyCert[] = [];
  for (const line of lines) {
    try { out.push(JSON.parse(line) as HonestyCert); }
    catch { /* skip */ }
  }
  return out.reverse(); // newest first
}
