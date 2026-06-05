/**
 * `mneme heartbeat` (v2.198.0) — the self-MAINTAINING pulse (the honest "self-evolving" core).
 *
 * A safe, signed 24/7 maintenance cycle the daemon runs on idle. Each beat the system:
 *   1. METAMORPHOSES memory (geo: old+idle raw → signed abstract → axiom — wisdom accrues, raw purged)
 *   2. RE-VERIFIES every signed ledger OFFLINE (attest · always-warm · geo chains) — tamper alarm
 *   3. CONSOLIDATES (counts the axioms newly crystallised this beat)
 *   4. SIGNS an evolution snapshot (a tamper-evident record of what changed)
 *
 * ★HONEST + SAFE (DIAKRISIS on "autonomous evolution"): it self-MAINTAINS, self-VERIFIES,
 * self-CONSOLIDATES — it does NOT rewrite its own security rules and it does NOT kill any
 * host runtime. Auto-modifying one's own guardrails unsupervised is exactly the anti-pattern
 * Mneme's soul (and Anthropic) warn against; rule changes stay human/agent-gated.
 */
import type { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { geo, commitAttest, awarm, notary, cortex } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }
const readJsonl = <T>(p: string): T[] => existsSync(p) ? readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) as T; } catch { return null; } }).filter(Boolean) as T[] : [];
const readJson = <T>(p: string, fallback: T): T => { try { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) as T : fallback; } catch { return fallback; } };

export interface HeartbeatReport {
  ranAt: number;
  geo: { rawBefore: number; rawAfter: number; axioms: number; reclaimedBytes: number };
  cortexFed: number;
  verify: { attest: boolean; warm: boolean; geo: boolean; allOk: boolean };
  evolutionHash: string;
}

/** Ingest the REAL shared memory (cortex active facts) into geo so it metamorphoses with
 *  age — old cortex memory dissolves to signed abstract→axiom + purges its raw. Deduped. */
function feedGeoFromCortex(cwd: string): number {
  const cp = join(cwd, ".mneme", "cortex", "store.json");
  if (!existsSync(cp)) return 0;
  let store: { entries?: unknown[] }; try { store = JSON.parse(readFileSync(cp, "utf8")); } catch { return 0; }
  if (!store || !Array.isArray(store.entries)) return 0;
  const gp = join(cwd, ".mneme", "geo", "state.json");
  let g = readJson<geo.GeoState>(gp, geo.emptyGeo());
  const have = new Set(g.cells.map((c) => c.id));
  let added = 0;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const active = cortex.activeView(store as any) as Map<string, { key: string; value: string; at?: number }>;
    for (const e of active.values()) {
      const id = `cortex:${e.key}`;
      if (have.has(id) || !e.value) continue;
      g = geo.seedRaw(g, { id, raw: String(e.value), ts: Number(e.at) || Date.now() });
      have.add(id); added++;
    }
  } catch { /* */ }
  if (added) { try { mkdirSync(join(cwd, ".mneme", "geo"), { recursive: true }); writeFileSync(gp, JSON.stringify(g), "utf8"); } catch { /* */ } }
  return added;
}

/** Run ONE self-maintenance beat. Total + idempotent + safe (no rule rewrite, no kill). */
export function runHeartbeat(cwd: string, now = Date.now()): HeartbeatReport {
  // 0) FEED geo from the REAL shared memory (cortex) so it recycles actual memory
  const cortexFed = feedGeoFromCortex(cwd);
  // 1) METAMORPHOSE memory (geo)
  const gp = join(cwd, ".mneme", "geo", "state.json");
  const gBefore = geo.geoStats(readJson<geo.GeoState>(gp, geo.emptyGeo()));
  const gAfter = geo.metamorphose(cwd, readJson<geo.GeoState>(gp, geo.emptyGeo()), now, {});
  try { mkdirSync(join(cwd, ".mneme", "geo"), { recursive: true }); writeFileSync(gp, JSON.stringify(gAfter), "utf8"); } catch { /* */ }
  const gStats = geo.geoStats(gAfter);

  // 2) RE-VERIFY every signed ledger OFFLINE
  const attestChain = readJsonl<commitAttest.AttestEntry>(join(cwd, ".mneme", "attest", "chain.jsonl"));
  const attestOk = attestChain.length === 0 || commitAttest.verifyAttestChain(attestChain).ok;
  const warmEvents = readJsonl<awarm.WarmEvent>(join(cwd, ".mneme", "awarm", "events.jsonl"));
  const warmOk = warmEvents.length === 0 || awarm.verifyEventChain(warmEvents).ok;
  const geoOk = geo.verifyGeo(gAfter).ok;
  const allOk = attestOk && warmOk && geoOk;

  // 3+4) CONSOLIDATE + SIGN an evolution snapshot (tamper-evident record of the beat)
  const report: Omit<HeartbeatReport, "evolutionHash"> = {
    ranAt: now,
    geo: { rawBefore: gBefore.raw, rawAfter: gStats.raw, axioms: gStats.axiom, reclaimedBytes: gStats.rawBytesReclaimed },
    cortexFed,
    verify: { attest: attestOk, warm: warmOk, geo: geoOk, allOk },
  };
  let evolutionHash = "";
  try {
    const receipt = notary.issueReceipt(cwd, { kind: "claim-verdict", subject: `heartbeat:${now}`, payload: report, includePayload: true, issuedAt: now }) as { receiptId?: string };
    evolutionHash = receipt.receiptId ?? "";
    mkdirSync(join(cwd, ".mneme", "heartbeat"), { recursive: true });
    writeFileSync(join(cwd, ".mneme", "heartbeat", "snapshot.json"), JSON.stringify({ ...report, receipt }, null, 2), "utf8");
  } catch { /* best-effort */ }
  return { ...report, evolutionHash };
}

export function registerHeartbeatCommands(program: Command): void {
  const h = program.command("upkeep").description("💓 SELF-MAINTAINING PULSE — one safe, signed maintenance beat: metamorphose memory + re-verify every ledger + sign an evolution snapshot. The daemon runs this on idle. (It self-maintains, NOT self-rewrites-its-rules.)");
  h.command("run", { isDefault: true }).description("Run one beat now.").action(() => {
    const r = runHeartbeat(process.cwd());
    out(`💓 beat · ${r.cortexFed} cortex memories ingested · geo raw ${r.geo.rawBefore}→${r.geo.rawAfter} · ${r.geo.axioms} axiom(s) · ${r.geo.reclaimedBytes}b reclaimed`);
    out(`   ledgers verified: attest ${r.verify.attest ? "✓" : "✗"} · warm ${r.verify.warm ? "✓" : "✗"} · geo ${r.verify.geo ? "✓" : "✗"}${r.verify.allOk ? "" : "  ⚠ TAMPER/DRIFT — investigate"}`);
    out(`   signed evolution snapshot: ${r.evolutionHash.slice(0, 16) || "(unsigned)"}`);
  });
  h.command("status").description("Read the last signed evolution snapshot.").action(() => {
    const snap = readJson<{ ranAt?: number; verify?: { allOk?: boolean }; geo?: { axioms?: number } } | null>(join(process.cwd(), ".mneme", "heartbeat", "snapshot.json"), null);
    if (!snap) { out("no heartbeat yet — `mneme heartbeat` to run one (the daemon runs it on idle)."); return; }
    out(`💓 last beat ${snap.ranAt ? new Date(snap.ranAt).toISOString() : "?"} · ledgers ${snap.verify?.allOk ? "all verified ✓" : "⚠ issue"} · ${snap.geo?.axioms ?? 0} axiom(s) of wisdom`);
  });
}
