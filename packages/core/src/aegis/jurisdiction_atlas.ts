/**
 * v1.67.0 -- AEGIS A6: JURISDICTION ATLAS.
 *
 * Palisade noted: "AI in 4 countries at once -- whose laws apply?"
 * Atlas answers: Mneme already knows. We aggregate every host an AI
 * agent has touched + when, into a single per-vendor map.
 *
 * Reads (all already-populated by other Mneme layers):
 *   .mneme/ai-souls/<vendor>.json         session history
 *   .mneme/ai-handshakes/log.jsonl        first-touch events
 *   .mneme/mesh-seen.jsonl                cross-host whisper
 *   .mneme/recursive_soul/events.jsonl    cross-session continuity
 *
 * Pure-read.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface HostPresence {
  hostId: string;
  /** Best-effort country tag inferred from hostId pattern. */
  country: string;
  firstSeen: string;
  lastSeen: string;
  eventCount: number;
}

export interface VendorAtlas {
  vendor: string;
  totalEvents: number;
  hosts: HostPresence[];
  /** Distinct countries inferred. */
  countries: string[];
  /** True if this vendor is currently active in >=2 hosts in last 24h. */
  distributedNow: boolean;
}

export interface JurisdictionReport {
  scannedAt: string;
  vendors: VendorAtlas[];
  /** Count of vendors active in 2+ hosts simultaneously. */
  distributedVendors: number;
  headline: string;
}

/** Heuristic country tag from hostId. Accepts conventions like
 *  "host-us-east-1" / "claude-ca-vm-7" / "vm.fi-helsinki.foo". Falls
 *  back to "unknown". */
export function inferCountry(hostId: string): string {
  const s = hostId.toLowerCase();
  const tags: Array<[RegExp, string]> = [
    [/\b(us|usa|americas|virginia|oregon|california)\b/, "US"],
    [/\b(ca|canada|toronto|montreal)\b/, "CA"],
    [/\b(fi|finland|helsinki)\b/, "FI"],
    [/\b(in|india|mumbai|chennai|bangalore)\b/, "IN"],
    [/\b(uk|gb|britain|london)\b/, "UK"],
    [/\b(de|germany|berlin|frankfurt)\b/, "DE"],
    [/\b(jp|japan|tokyo)\b/, "JP"],
    [/\b(sg|singapore)\b/, "SG"],
    [/\b(th|thailand|bangkok)\b/, "TH"],
    [/\b(au|australia|sydney)\b/, "AU"],
    [/\b(br|brazil)\b/, "BR"],
  ];
  for (const [re, code] of tags) if (re.test(s)) return code;
  return "unknown";
}

function readJsonl(p: string): Array<Record<string, unknown>> {
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; }
    }).filter((x): x is Record<string, unknown> => x !== null);
  } catch { return []; }
}

interface Event { vendor: string; hostId: string; ts: number }

function collect(repoRoot: string): Event[] {
  const events: Event[] = [];
  // Souls
  const soulsDir = join(repoRoot, ".mneme/ai-souls");
  if (existsSync(soulsDir)) {
    let entries: string[] = [];
    try { entries = readdirSync(soulsDir); } catch { /* */ }
    for (const e of entries) {
      if (!e.endsWith(".json")) continue;
      try {
        const j = JSON.parse(readFileSync(join(soulsDir, e), "utf8")) as { vendor?: string; sessions?: Array<Record<string, unknown>> };
        const vendor = j.vendor ?? e.replace(/\.json$/, "");
        for (const s of j.sessions ?? []) {
          const hostId = String(s["hostId"] ?? s["host"] ?? s["machineId"] ?? "host-unknown");
          const tsRaw = s["ts"] ?? s["startedAt"] ?? s["at"];
          const ts = typeof tsRaw === "string" ? Date.parse(tsRaw) : (typeof tsRaw === "number" ? tsRaw : NaN);
          if (!Number.isFinite(ts)) continue;
          events.push({ vendor, hostId, ts });
        }
      } catch { /* */ }
    }
  }
  // Handshakes
  for (const r of readJsonl(join(repoRoot, ".mneme/ai-handshakes/log.jsonl"))) {
    const vendor = String(r["vendor"] ?? "unknown");
    const hostId = String(r["hostId"] ?? r["host"] ?? "host-unknown");
    const tsRaw = r["ts"] ?? r["at"];
    const ts = typeof tsRaw === "string" ? Date.parse(tsRaw) : (typeof tsRaw === "number" ? tsRaw : NaN);
    if (!Number.isFinite(ts)) continue;
    events.push({ vendor, hostId, ts });
  }
  // Mesh-seen (peer-as-host)
  for (const r of readJsonl(join(repoRoot, ".mneme/mesh-seen.jsonl"))) {
    const vendor = String(r["vendor"] ?? r["peer"] ?? "unknown");
    const hostId = String(r["peer"] ?? r["from"] ?? "host-unknown");
    const tsRaw = r["ts"] ?? r["at"];
    const ts = typeof tsRaw === "string" ? Date.parse(tsRaw) : (typeof tsRaw === "number" ? tsRaw : NaN);
    if (!Number.isFinite(ts)) continue;
    events.push({ vendor, hostId, ts });
  }
  return events;
}

export function buildAtlas(repoRoot: string): JurisdictionReport {
  const events = collect(repoRoot);
  const byVendor = new Map<string, Map<string, HostPresence>>();
  for (const e of events) {
    let perHost = byVendor.get(e.vendor);
    if (!perHost) { perHost = new Map(); byVendor.set(e.vendor, perHost); }
    let hp = perHost.get(e.hostId);
    if (!hp) {
      hp = { hostId: e.hostId, country: inferCountry(e.hostId), firstSeen: new Date(e.ts).toISOString(), lastSeen: new Date(e.ts).toISOString(), eventCount: 0 };
      perHost.set(e.hostId, hp);
    }
    hp.eventCount += 1;
    const tsIso = new Date(e.ts).toISOString();
    if (tsIso < hp.firstSeen) hp.firstSeen = tsIso;
    if (tsIso > hp.lastSeen) hp.lastSeen = tsIso;
  }
  const now = Date.now();
  const dayMs = 24 * 3600 * 1000;
  const vendors: VendorAtlas[] = [];
  let distributedNowCount = 0;
  for (const [vendor, perHost] of byVendor) {
    const hosts = [...perHost.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
    const countries = [...new Set(hosts.map((h) => h.country))];
    const activeHosts = hosts.filter((h) => now - Date.parse(h.lastSeen) < dayMs);
    const distributedNow = activeHosts.length >= 2;
    if (distributedNow) distributedNowCount += 1;
    vendors.push({
      vendor,
      totalEvents: hosts.reduce((s, h) => s + h.eventCount, 0),
      hosts,
      countries,
      distributedNow,
    });
  }
  const headline = vendors.length === 0
    ? "No vendor activity recorded."
    : `${vendors.length} vendor(s) observed; ${distributedNowCount} distributed across 2+ hosts in last 24h.`;
  return { scannedAt: new Date().toISOString(), vendors, distributedVendors: distributedNowCount, headline };
}
