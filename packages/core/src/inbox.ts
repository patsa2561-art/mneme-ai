/**
 * Mneme Inbox (v1.23.0) — the RLHF Force-Push channel.
 *
 * Problem: AI agents don't read MCP `notifications/message` reliably across
 * clients. We need a way for Mneme (especially the always-running NUCLEUS
 * daemon) to push messages to the user MID-CONVERSATION without depending
 * on client-specific notification UX.
 *
 * Solution: every Mneme tool dispatch is guaranteed to flow its wisdom
 * field back to the user (via the AI agent quoting it). The inbox is an
 * append-only queue that:
 *   • Daemon (or any background process) writes to when something
 *     noteworthy happens (new version, milestone, achievement, alert).
 *   • Every MCP tool dispatch reads + prepends unsent messages to its
 *     wisdom field with a 🔔 marker.
 *   • Agent sees wisdom, surfaces to user — message arrives without the
 *     user having typed anything Mneme-related.
 *
 * This is the "ai agent talks to user FIRST" pattern the user explicitly
 * asked for — works with EVERY MCP client because we use the same
 * guaranteed wisdom channel that's already wired.
 *
 * Storage: `.mneme/inbox.jsonl` — append-only, line-delimited JSON.
 * Items have a `sent: bool` flag flipped when first surfaced.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";

const INBOX_FILE = ".mneme/inbox.jsonl";
const MAX_INBOX_BYTES = 256 * 1024; // 256KB cap — auto-rotate above this

export type InboxPriority = "low" | "medium" | "high" | "critical";

export interface InboxMessage {
  id: string;
  createdAt: string;
  priority: InboxPriority;
  /** Source: "daemon" | "version-check" | "mutation" | "achievement" | "manual" | "update" */
  source: string;
  /** Short headline (≤ 80 chars) — what the user sees first. */
  title: string;
  /** Optional one-line body for context. */
  body?: string;
  /** Optional CTA the AI agent should suggest (e.g., "say 'upgrade Mneme'"). */
  cta?: string;
  /** True when this message has been surfaced to the user via wisdom prepend. */
  sent: boolean;
  /** ISO timestamp the message was sent. */
  sentAt?: string;
  /**
   * v1.26.3 -- when set, this inbox message is an AUTO-ACTION:
   * pulse.ts surfaces it with `[AUTO-ACTION]` instead of `[INFO]`
   * and emits an `EXECUTE NOW: <tool>(<args>)` line so the AI runs
   * the tool immediately without asking permission.
   */
  autoAction?: { tool: string; args?: Record<string, unknown> };
}

function ensureDir(repoRoot: string): void {
  const dir = join(repoRoot, ".mneme");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function inboxPath(repoRoot: string): string {
  return join(repoRoot, INBOX_FILE);
}

/** Push a new message into the inbox. Always idempotent on `id` —
 *  re-pushing the same id is a no-op (so version-check won't spam). */
export function pushInbox(
  repoRoot: string,
  msg: Omit<InboxMessage, "id" | "createdAt" | "sent"> & { id?: string },
): InboxMessage {
  const id =
    msg.id ??
    createHash("sha256")
      .update(msg.title)
      .update(msg.source)
      .update(msg.body ?? "")
      .digest("hex")
      .slice(0, 12);
  // Skip if already in inbox (idempotency).
  for (const m of readInbox(repoRoot)) {
    if (m.id === id) return m;
  }
  const full: InboxMessage = {
    id,
    createdAt: new Date().toISOString(),
    priority: msg.priority,
    source: msg.source,
    title: msg.title,
    body: msg.body,
    cta: msg.cta,
    sent: false,
    autoAction: msg.autoAction,
  };
  try {
    ensureDir(repoRoot);
    appendFileSync(inboxPath(repoRoot), JSON.stringify(full) + "\n", "utf8");
    rotateIfNeeded(repoRoot);
  } catch {
    // best-effort — never fail callers on disk error
  }
  return full;
}

/**
 * v1.26.3 (Bug #1 fix) -- remove every entry whose source matches.
 * Used by version-check to invalidate stale "vX available" entries
 * before pushing the new one, so users don't accumulate one notice
 * per past version.
 *
 * Returns the number of removed entries.
 */
export function popInboxBySource(repoRoot: string, source: string): number {
  const all = readInbox(repoRoot);
  const kept = all.filter((m) => m.source !== source);
  if (kept.length === all.length) return 0;
  try {
    writeFileSync(
      inboxPath(repoRoot),
      kept.length === 0 ? "" : kept.map((m) => JSON.stringify(m)).join("\n") + "\n",
      "utf8",
    );
  } catch {
    // best-effort
  }
  return all.length - kept.length;
}

/**
 * v1.26.3 (Bug #1 fix) -- atomic "replace by source" helper. Pops every
 * existing entry from `source`, then pushes the new one. Net effect:
 * the inbox contains AT MOST ONE message per source at any time.
 *
 * If `skip` returns true, no push happens (used by version-check to
 * skip self-notice when current >= target).
 */
export function pushInboxReplacingSource(
  repoRoot: string,
  msg: Omit<InboxMessage, "id" | "createdAt" | "sent"> & { id?: string },
  opts: { skip?: () => boolean } = {},
): InboxMessage | null {
  if (opts.skip && opts.skip()) {
    // Still pop existing -- the user is now current, stale notices must go.
    popInboxBySource(repoRoot, msg.source);
    return null;
  }
  popInboxBySource(repoRoot, msg.source);
  return pushInbox(repoRoot, msg);
}

/**
 * v1.26.3 (Bug #2 fix) -- ack one or more inbox entries by id. When
 * `ids` is "all", every unsent entry becomes sent. When `ids` is an
 * array, only those ids are acked (no-op for ids that don't exist).
 *
 * Returns the number of entries actually changed (sent flag flipped).
 */
export function ackInbox(repoRoot: string, ids: string[] | "all"): number {
  const all = readInbox(repoRoot);
  if (all.length === 0) return 0;
  const targetIds = ids === "all"
    ? new Set(all.filter((m) => !m.sent).map((m) => m.id))
    : new Set(ids);
  if (targetIds.size === 0) return 0;
  const sentAt = new Date().toISOString();
  let changed = 0;
  const next = all.map((m) => {
    if (targetIds.has(m.id) && !m.sent) {
      changed++;
      return { ...m, sent: true, sentAt };
    }
    return m;
  });
  if (changed === 0) return 0;
  try {
    writeFileSync(inboxPath(repoRoot), next.map((m) => JSON.stringify(m)).join("\n") + "\n", "utf8");
  } catch {
    // best-effort
  }
  return changed;
}

/**
 * v1.26.3 (Bug #2 fix) -- delete inbox entries entirely (not just ack).
 * `which` = "sent" removes sent entries, "all" wipes everything,
 * "older-than-days" removes entries older than the given day count.
 * Returns the number of removed entries.
 */
export function clearInbox(
  repoRoot: string,
  which: "sent" | "all" | { olderThanDays: number },
): number {
  const all = readInbox(repoRoot);
  if (all.length === 0) return 0;
  let kept: InboxMessage[];
  if (which === "all") {
    kept = [];
  } else if (which === "sent") {
    kept = all.filter((m) => !m.sent);
  } else {
    const cutoff = Date.now() - which.olderThanDays * 24 * 60 * 60 * 1000;
    kept = all.filter((m) => Date.parse(m.createdAt) >= cutoff);
  }
  if (kept.length === all.length) return 0;
  try {
    writeFileSync(
      inboxPath(repoRoot),
      kept.length === 0 ? "" : kept.map((m) => JSON.stringify(m)).join("\n") + "\n",
      "utf8",
    );
  } catch {
    // best-effort
  }
  return all.length - kept.length;
}

/** v1.26.3 -- count of unsent messages, cheap (one file read). */
export function countUnsent(repoRoot: string): number {
  return readInbox(repoRoot).filter((m) => !m.sent).length;
}

/** Read all messages currently in the inbox (sent + unsent). */
export function readInbox(repoRoot: string): InboxMessage[] {
  const path = inboxPath(repoRoot);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line) as InboxMessage; } catch { return null; }
      })
      .filter((m): m is InboxMessage => m !== null);
  } catch {
    return [];
  }
}

/** Read up to N unsent messages, sorted by priority desc + createdAt asc.
 *  Marks them sent (write-back). Used by enrichWithSecondBrain. */
export function popUnsent(repoRoot: string, limit = 3): InboxMessage[] {
  const all = readInbox(repoRoot);
  const unsent = all
    .filter((m) => !m.sent)
    .sort((a, b) => {
      const pri = priorityOrder(b.priority) - priorityOrder(a.priority);
      if (pri !== 0) return pri;
      return a.createdAt.localeCompare(b.createdAt);
    })
    .slice(0, limit);
  if (unsent.length === 0) return [];
  // Write-back: rewrite the whole file with sent flags flipped.
  const ids = new Set(unsent.map((m) => m.id));
  const sentAt = new Date().toISOString();
  const next = all.map((m) => (ids.has(m.id) ? { ...m, sent: true, sentAt } : m));
  try {
    writeFileSync(inboxPath(repoRoot), next.map((m) => JSON.stringify(m)).join("\n") + "\n", "utf8");
  } catch {
    // best-effort
  }
  return unsent;
}

function priorityOrder(p: InboxPriority): number {
  return p === "critical" ? 4 : p === "high" ? 3 : p === "medium" ? 2 : 1;
}

/** Rotate the file if it exceeds MAX_INBOX_BYTES — keep last half. */
function rotateIfNeeded(repoRoot: string): void {
  try {
    const path = inboxPath(repoRoot);
    if (!existsSync(path)) return;
    const stat = statSync(path);
    if (stat.size <= MAX_INBOX_BYTES) return;
    const all = readInbox(repoRoot);
    const keep = all.slice(Math.floor(all.length / 2));
    writeFileSync(path, keep.map((m) => JSON.stringify(m)).join("\n") + "\n", "utf8");
  } catch {
    // ignore
  }
}

/** Format unsent messages as a wisdom-prepend block. The AI agent will
 *  see this in the wisdom field and surface to the user verbatim. */
export function formatForWisdom(messages: InboxMessage[]): string {
  if (messages.length === 0) return "";
  const lines: string[] = [];
  for (const m of messages) {
    const glyph = m.priority === "critical" ? "🚨" : m.priority === "high" ? "📢" : m.priority === "medium" ? "🔔" : "💬";
    let line = `${glyph} **Mneme · ${m.title}**`;
    if (m.body) line += ` — ${m.body}`;
    if (m.cta) line += ` (${m.cta})`;
    lines.push(line);
  }
  return lines.join("\n") + "\n\n";
}

/** Stable ID for the daemon to use when pushing repeated messages of the
 *  same kind (e.g., once per detected version). */
export function deterministicId(seed: string): string {
  return createHash("sha256").update(seed).digest("hex").slice(0, 12);
}

/** For tests — clear the inbox. */
export function _clearInboxForTests(repoRoot: string): void {
  try {
    const path = inboxPath(repoRoot);
    if (existsSync(path)) writeFileSync(path, "", "utf8");
  } catch { /* ignore */ }
  void randomBytes; // silence unused
}
