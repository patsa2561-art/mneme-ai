/**
 * VACCINE CDN PULSE INTEGRATION (v1.43.0 — Demon Stage 1.1).
 *
 * Renders one tiny line into the pulse output so the AI agent + the
 * user see at a glance: which pharmacopoeia version is active, how
 * fresh it is, and whether the last refresh succeeded. The pulse line
 * is silent (returns "") when no CDN configured + no active bundle —
 * so users who never opt in to vaccine-CDN see no extra noise.
 */

import { PharmacopoeiaCDN } from "./cdn_client.js";

function humanAge(ms: number | null): string {
  if (ms == null) return "?";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

export function renderPharmacopoeiaBlock(repoRoot: string): string {
  const cdn = new PharmacopoeiaCDN({ repoRoot });
  const s = cdn.status();
  if (!s.active) return "";   // no bundle yet → no pulse line

  const v = s.active.version;
  const age = humanAge(s.ageMs);
  const verifiedGlyph = s.verified ? "✓" : "○";
  let line = `[PHARMACOPOEIA] v${v} active (${age} old) ${verifiedGlyph} ${s.verified ? "verified" : "unsigned"}`;
  if (s.lastRefreshOutcome === "verify-failed") line += " ⚠ last refresh failed signature check";
  else if (s.lastRefreshOutcome === "stale-version") line += " ⚠ CDN tried to downgrade us — rejected";
  else if (s.lastRefreshOutcome === "fetch-failed") line += " ⚠ last fetch failed (cdn unreachable)";
  return line;
}
