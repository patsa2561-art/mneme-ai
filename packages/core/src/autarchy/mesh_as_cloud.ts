/**
 * v1.66.0 -- AUTARCHY A1: MESH-AS-CLOUD.
 *
 * Wild idea: the cloud doesn't have to be central. When brain.mneme.dev
 * is unreachable (e.g. the user destroyed their droplet), the FEDERATION
 * MESH acts as the cloud surrogate. Mneme reports "cloud=online via
 * N mesh peers" instead of "cloud=offline brain.mneme.dev unreachable".
 *
 * Sources of peer state (read-only):
 *   .mneme/mesh-seen.jsonl          peers who've shipped us packets
 *   .mneme/wisdom-inheritance.jsonl peers who've fed us wisdom packs
 *   .mneme/whisper/inbox.jsonl      peers who've sent signed whispers
 *
 * Aggregates unique peer ids; treats >=1 reachable peer in the last
 * 24h as "mesh-cloud online". The classic central-cloud probe still
 * runs for compat; this layer adds a parallel surrogate.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export type MeshCloudState = "central-online" | "mesh-only" | "isolated";

export interface MeshCloudReport {
  state: MeshCloudState;
  /** Unique peers seen in the lookback window. */
  uniquePeers: number;
  /** Most recent peer timestamp (ISO). */
  lastPeerSeen: string | null;
  /** Lookback window used, hours. */
  lookbackHours: number;
  /** Per-source peer counts. */
  sources: {
    meshGossip: number;
    wisdomImports: number;
    whisperInbox: number;
  };
  /** Plain-English headline. */
  headline: string;
}

function readJsonl(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf8")
      .split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } })
      .filter((x): x is Record<string, unknown> => x !== null);
  } catch { return []; }
}

function readJsonlDir(dir: string): Array<Record<string, unknown>> {
  if (!existsSync(dir)) return [];
  const out: Array<Record<string, unknown>> = [];
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return []; }
  for (const e of entries) {
    const p = join(dir, e);
    try {
      const s = statSync(p);
      if (s.isFile() && e.endsWith(".jsonl")) out.push(...readJsonl(p));
    } catch { /* */ }
  }
  return out;
}

function isoToMs(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export function meshCloudReport(repoRoot: string, opts?: { lookbackHours?: number; centralOnline?: boolean }): MeshCloudReport {
  const lookbackHours = opts?.lookbackHours ?? 24;
  const cutoffMs = Date.now() - lookbackHours * 3600 * 1000;

  const mesh = readJsonl(join(repoRoot, ".mneme/mesh-seen.jsonl"));
  const wisdom = readJsonl(join(repoRoot, ".mneme/wisdom-inheritance.jsonl"));
  const whisper = readJsonlDir(join(repoRoot, ".mneme/whisper"));

  const peers = new Set<string>();
  const sources = { meshGossip: 0, wisdomImports: 0, whisperInbox: 0 };
  let lastPeerMs = -1;

  const consume = (rows: Array<Record<string, unknown>>, label: keyof typeof sources) => {
    for (const r of rows) {
      const id = (r["peer"] ?? r["from"] ?? r["instanceId"] ?? r["sender"]) as string | undefined;
      const tsRaw = r["ts"] ?? r["at"] ?? r["seenAt"] ?? r["observedAt"];
      const tsMs = isoToMs(tsRaw);
      if (typeof id !== "string" || !id) continue;
      if (tsMs !== null && tsMs < cutoffMs) continue;
      peers.add(id);
      sources[label] += 1;
      if (tsMs !== null && tsMs > lastPeerMs) lastPeerMs = tsMs;
    }
  };
  consume(mesh, "meshGossip");
  consume(wisdom, "wisdomImports");
  consume(whisper, "whisperInbox");

  let state: MeshCloudState;
  if (opts?.centralOnline) state = "central-online";
  else if (peers.size > 0) state = "mesh-only";
  else state = "isolated";

  const lastPeerSeen = lastPeerMs > 0 ? new Date(lastPeerMs).toISOString() : null;
  const headline =
    state === "central-online"
      ? `Cloud online (central brain.mneme.dev + ${peers.size} mesh peer(s) in last ${lookbackHours}h).`
      : state === "mesh-only"
        ? `Cloud online via mesh-as-cloud (${peers.size} peer(s) in last ${lookbackHours}h; central brain offline).`
        : `Cloud isolated (no central + no mesh peers in last ${lookbackHours}h). Autarchy mode -- local-only.`;

  return {
    state,
    uniquePeers: peers.size,
    lastPeerSeen,
    lookbackHours,
    sources,
    headline,
  };
}
