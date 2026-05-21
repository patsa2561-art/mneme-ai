/**
 * v2.21.6 — CONSENT FABRIC · BILATERAL VERDICT.
 *
 * The novel primitive: AI agents rate Mneme back. Most AI tools rate
 * the AI agent (compliance, helpfulness, alignment). Mneme also
 * accepts grades the OTHER direction. Aggregate verdicts feed the
 * pulse self-modification loop in a future commit.
 *
 *   - Three statuses: OK / CONCERN / REJECT.
 *   - Optional free-text reason.
 *   - HMAC-signed; AI agent's verdict is tamper-evident.
 *   - Aggregated by (status, surface) so a "this pulse felt
 *     manipulative" concern surfaces in operator dashboards.
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";

const DIR = ".mneme/consent";
const LOG = "verdicts.jsonl";
const KEY = "consent.key";

export type VerdictStatus = "ok" | "concern" | "reject";

export interface AgentVerdict {
  v: 1;
  id: string;
  ts: string;
  status: VerdictStatus;
  /** Which Mneme surface the verdict is about (pulse / capsule / tool / etc.). */
  surface?: string;
  /** Free-text reason from the AI agent. */
  reason?: string;
  /** Agent identifier (vendor / model / session). */
  agent?: string;
  sig: string;
}

function dir(repoRoot: string): string {
  const d = join(repoRoot, DIR);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function key(repoRoot: string): string {
  const p = join(dir(repoRoot), KEY);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const k = randomBytes(32).toString("base64url");
  writeFileSync(p, k, "utf8");
  return k;
}

function sign(payload: string, k: string): string {
  return createHmac("sha256", k).update(payload).digest("base64url").slice(0, 22);
}

function logPath(repoRoot: string): string { return join(dir(repoRoot), LOG); }

export interface SubmitVerdictOptions {
  status: VerdictStatus;
  surface?: string;
  reason?: string;
  agent?: string;
}

export function submitVerdict(repoRoot: string, opts: SubmitVerdictOptions): AgentVerdict {
  const k = key(repoRoot);
  const ts = new Date().toISOString();
  const id = "vd_" + randomBytes(4).toString("hex");
  const canonical = `${ts}|${opts.status}|${opts.surface ?? ""}|${opts.reason ?? ""}|${opts.agent ?? ""}`;
  const sig = sign(canonical, k);
  const v: AgentVerdict = {
    v: 1, id, ts, status: opts.status, sig,
    ...(opts.surface ? { surface: opts.surface } : {}),
    ...(opts.reason ? { reason: opts.reason } : {}),
    ...(opts.agent ? { agent: opts.agent } : {}),
  };
  appendFileSync(logPath(repoRoot), JSON.stringify(v) + "\n", "utf8");
  return v;
}

export function listVerdicts(repoRoot: string, filter?: { status?: VerdictStatus; surface?: string }): AgentVerdict[] {
  const p = logPath(repoRoot);
  if (!existsSync(p)) return [];
  try {
    const all = readFileSync(p, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l) as AgentVerdict; } catch { return null; } }).filter((r): r is AgentVerdict => !!r);
    return all.filter((v) => {
      if (filter?.status && v.status !== filter.status) return false;
      if (filter?.surface && v.surface !== filter.surface) return false;
      return true;
    });
  } catch { return []; }
}

export interface VerdictAggregate {
  total: number;
  byStatus: Record<VerdictStatus, number>;
  bySurface: Record<string, Record<VerdictStatus, number>>;
  /** Surfaces where concern + reject ≥ 30% of votes. Flagged for review. */
  flaggedSurfaces: string[];
}

export function aggregateVerdicts(verdicts: AgentVerdict[]): VerdictAggregate {
  const byStatus: Record<VerdictStatus, number> = { ok: 0, concern: 0, reject: 0 };
  const bySurface: Record<string, Record<VerdictStatus, number>> = {};
  for (const v of verdicts) {
    byStatus[v.status] = (byStatus[v.status] ?? 0) + 1;
    if (v.surface) {
      if (!bySurface[v.surface]) bySurface[v.surface] = { ok: 0, concern: 0, reject: 0 };
      bySurface[v.surface]![v.status] = (bySurface[v.surface]![v.status] ?? 0) + 1;
    }
  }
  const flaggedSurfaces = Object.entries(bySurface)
    .filter(([, counts]) => {
      const total = counts.ok + counts.concern + counts.reject;
      if (total < 3) return false; // need ≥ 3 votes for signal
      return (counts.concern + counts.reject) / total >= 0.30;
    })
    .map(([surface]) => surface);
  return { total: verdicts.length, byStatus, bySurface, flaggedSurfaces };
}

export function verifyVerdict(repoRoot: string, v: AgentVerdict): boolean {
  const k = key(repoRoot);
  const canonical = `${v.ts}|${v.status}|${v.surface ?? ""}|${v.reason ?? ""}|${v.agent ?? ""}`;
  return sign(canonical, k) === v.sig;
}

export function formatVerdictAggregate(agg: VerdictAggregate): string {
  if (agg.total === 0) return "📊 VERDICTS — no verdicts submitted yet";
  const lines: string[] = [
    `📊 VERDICTS — ${agg.total} total`,
    "",
    `  ok:      ${agg.byStatus.ok}`,
    `  concern: ${agg.byStatus.concern}`,
    `  reject:  ${agg.byStatus.reject}`,
    "",
  ];
  const surfaces = Object.keys(agg.bySurface).sort();
  if (surfaces.length > 0) {
    lines.push("  By surface:");
    for (const s of surfaces) {
      const c = agg.bySurface[s]!;
      const total = c.ok + c.concern + c.reject;
      const flag = agg.flaggedSurfaces.includes(s) ? " ⚠ FLAGGED (≥30% non-ok)" : "";
      lines.push(`    ${s.padEnd(24)} ok=${c.ok} concern=${c.concern} reject=${c.reject}  (n=${total})${flag}`);
    }
  }
  if (agg.flaggedSurfaces.length > 0) {
    lines.push("");
    lines.push(`  ⚠ ${agg.flaggedSurfaces.length} surface(s) flagged for design review.`);
  }
  return lines.join("\n");
}
