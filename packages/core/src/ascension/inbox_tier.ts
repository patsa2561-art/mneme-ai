/**
 * v1.68.0 -- ASCENSION ASC-6: INBOX TIER FILTER.
 *
 * The pulse currently counts ALL unread inbox messages, including
 * routine milestones + test probes. The user has to mentally filter
 * "is this an alert or noise". We do it for them.
 *
 *   ALERT     critical / high priority messages (incl. high-source like
 *             daemon-queue failures, version-check HIGH, AUTO-ACTION
 *             mandates)
 *   ROUTINE   low / medium milestones, manual test pushes, friendly
 *             milestones (daemon-milestone source, friend-test source)
 *
 * Pulse should foreground ALERT count + offer routine count as a
 * secondary line. Auto-archive ROUTINE older than 7 days.
 *
 * Pure-read by default; the archive step (writeArchived) is opt-in.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const ASC_DIR = ".mneme/ascension";
const ARCHIVE_FILE = ".mneme/ascension/inbox-archive.jsonl";

export type InboxTier = "alert" | "routine";

export interface TieredInboxMessage {
  id: string;
  createdAt: string;
  priority: "low" | "medium" | "high" | "critical";
  source: string;
  title: string;
  body?: string;
  sent: boolean;
  /** Classified tier (alert vs routine). */
  tier: InboxTier;
}

const ROUTINE_SOURCES = new Set([
  "daemon-milestone",
  "wild-test",
  "synthetic-test",
  "friend-test",
  "smoke-test",
  "manual",  // user-pushed manual notes
]);

const ALERT_SOURCES = new Set([
  "daemon-queue",       // mandate execution failures
  "version-check",      // new-version-available
  "autoaction",         // auto-action mandates
  "antivirus",          // hallucination strain caught
  "supernova",          // self-heal escalation
  "compliance",         // contract violation
]);

/** Classify a single inbox message into alert / routine. */
export function classifyTier(msg: { priority?: string; source?: string }): InboxTier {
  const src = (msg.source ?? "").toLowerCase();
  if (ALERT_SOURCES.has(src)) return "alert";
  if (ROUTINE_SOURCES.has(src)) return "routine";
  // Fall back to priority.
  if (msg.priority === "critical" || msg.priority === "high") return "alert";
  return "routine";
}

export interface TierBreakdown {
  alertUnsent: number;
  routineUnsent: number;
  totalUnsent: number;
  /** Most-recent ALERT title for pulse surface. */
  topAlertTitle: string | null;
  /** Plain-English headline. */
  headline: string;
}

export function tierBreakdown(messages: Array<{ id: string; priority?: string; source?: string; title?: string; sent?: boolean }>): TierBreakdown {
  let alert = 0;
  let routine = 0;
  let topAlertTitle: string | null = null;
  for (const m of messages) {
    if (m.sent) continue;
    const tier = classifyTier(m);
    if (tier === "alert") {
      alert += 1;
      if (!topAlertTitle && m.title) topAlertTitle = m.title;
    } else {
      routine += 1;
    }
  }
  const total = alert + routine;
  const headline = total === 0
    ? `Inbox quiet.`
    : alert === 0
      ? `${routine} routine message(s); 0 alerts.`
      : `${alert} alert(s)${routine > 0 ? ` + ${routine} routine` : ""}${topAlertTitle ? `: "${topAlertTitle}"` : ""}.`;
  return { alertUnsent: alert, routineUnsent: routine, totalUnsent: total, topAlertTitle, headline };
}

/** Auto-archive routine messages older than ttlDays from the breakdown
 *  perspective. Returns the count archived. Persists when persist=true. */
export interface ArchiveOptions {
  ttlDays?: number;
  persist?: boolean;
}

export function autoArchiveRoutine(
  repoRoot: string,
  messages: Array<{ id: string; createdAt: string; priority?: string; source?: string; title?: string; sent?: boolean }>,
  opts?: ArchiveOptions,
): { archivedCount: number; archivedIds: string[] } {
  const ttlDays = opts?.ttlDays ?? 7;
  const cutoff = Date.now() - ttlDays * 86400 * 1000;
  const archivedIds: string[] = [];
  for (const m of messages) {
    if (classifyTier(m) !== "routine") continue;
    const created = Date.parse(m.createdAt);
    if (!Number.isFinite(created) || created > cutoff) continue;
    archivedIds.push(m.id);
  }
  if (opts?.persist && archivedIds.length > 0) {
    try {
      const dir = join(repoRoot, ASC_DIR);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      for (const id of archivedIds) {
        appendFileSync(join(repoRoot, ARCHIVE_FILE),
          JSON.stringify({ ts: new Date().toISOString(), id, reason: `auto-archive routine after ${ttlDays}d` }) + "\n", "utf8");
      }
    } catch { /* */ }
  }
  return { archivedCount: archivedIds.length, archivedIds };
}

export function readArchive(repoRoot: string): Array<{ ts: string; id: string; reason: string }> {
  const p = join(repoRoot, ARCHIVE_FILE);
  if (!existsSync(p)) return [];
  const out: Array<{ ts: string; id: string; reason: string }> = [];
  try {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line) as { ts: string; id: string; reason: string }); } catch { /* */ }
    }
  } catch { /* */ }
  return out;
}
