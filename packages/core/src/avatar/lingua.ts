/**
 * DEMON STAGE 5.2 — Lingua: Vendor-Neutral Knowledge Stream (v1.44.0)
 *
 * SCOPE: take Mneme's heterogeneous on-disk signals (compliance log,
 * vaccines, pheromones, soul diary, gossip mesh) and emit them as a
 * SINGLE NORMALIZED STREAM that any AI tool can consume — JSONL with
 * a tiny universal schema. The point: "Mneme as the lingua franca"
 * means a Cursor / Codex / Aider / Continue user gets the same
 * structured knowledge regardless of vendor.
 *
 * SCHEMA (deliberately tiny — fewer fields = more interop):
 *   { v: 1, id: "...", at: "...", kind: "...", origin: "...", body: {...}, tags: [...] }
 *
 * SOURCES SUPPORTED:
 *   - compliance       → kind="compliance.event"
 *   - auto-action queue→ kind="action.queued"
 *   - ai-souls dir     → kind="soul.entry"
 *   - vaccines         → kind="wisdom.vaccine"
 *   - pheromones       → kind="wisdom.pheromone"
 *   - gossip seen log  → kind="mesh.event"
 *
 * INNOVATIONS BEYOND SPEC:
 *   - "Filter by since": only emit events newer than a given ISO ts so a
 *     consumer can poll incrementally without re-receiving everything
 *   - "Cursor token": each emission returns a `nextCursor` ts so the
 *     consumer doesn't need to track its own watermark
 *   - "Origin tagging": every event carries the file it came from, so
 *     consumers can verify provenance without trusting Mneme's claims
 *   - "Schema discipline": ANY field not in the universal schema is
 *     pushed under `body.*` — keeps the top-level forever-stable
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

const SOURCES = {
  compliance: { rel: ".mneme/ai-compliance.jsonl", kind: "compliance.event" },
  queue:      { rel: ".mneme/auto-action-queue.jsonl", kind: "action.queued" },
  vaccines:   { rel: ".mneme/vaccines.jsonl", kind: "wisdom.vaccine" },
  pheromones: { rel: ".mneme/ai-pheromones.jsonl", kind: "wisdom.pheromone" },
  meshSeen:   { rel: ".mneme/mesh-seen.jsonl", kind: "mesh.event" },
} as const;

const SOULS_DIR_REL = ".mneme/ai-souls";

export interface LinguaEvent {
  v: 1;
  id: string;             // sha256(origin + raw line) → stable across runs
  at: string;             // ISO-8601
  kind: string;
  origin: string;         // relative path of the source file
  body: Record<string, unknown>;
  tags: string[];
}

export interface LinguaStream {
  events: LinguaEvent[];
  nextCursor: string;     // ISO ts — pass back as `since` next time
  totalRead: number;
  totalEmitted: number;
}

const TOP_LEVEL_FIELDS = new Set(["v", "id", "at", "kind", "origin", "body", "tags"]);

function safeParseJsonl(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return [];
  const out: Record<string, unknown>[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as Record<string, unknown>); } catch { /* skip */ }
  }
  return out;
}

function pickAt(raw: Record<string, unknown>): string | null {
  for (const k of ["at", "timestamp", "createdAt", "emittedAt", "ts"]) {
    const v = raw[k];
    if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return v;
  }
  return null;
}

function makeId(origin: string, raw: Record<string, unknown>): string {
  return createHash("sha256").update(origin + "\0" + JSON.stringify(raw)).digest("hex").slice(0, 16);
}

function normalizeBody(raw: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!TOP_LEVEL_FIELDS.has(k)) body[k] = v;
  }
  return body;
}

function inferTags(kind: string, raw: Record<string, unknown>): string[] {
  const tags: string[] = [kind.split(".")[0]!];
  if (typeof raw.vendor === "string") tags.push(`vendor:${raw.vendor}`);
  if (typeof raw.outcome === "string") tags.push(`outcome:${raw.outcome}`);
  if (typeof raw.severity === "string") tags.push(`severity:${raw.severity}`);
  if (typeof raw.sender === "string") tags.push(`sender:${raw.sender}`);
  return tags;
}

function emitFromJsonl(repoRoot: string, rel: string, kind: string, since: number): LinguaEvent[] {
  const root = resolve(repoRoot);
  const path = join(root, rel);
  const raws = safeParseJsonl(path);
  const out: LinguaEvent[] = [];
  for (const raw of raws) {
    const at = pickAt(raw);
    if (!at) continue;
    const ts = Date.parse(at);
    if (ts < since) continue;
    out.push({
      v: 1,
      id: makeId(rel, raw),
      at,
      kind,
      origin: rel,
      body: normalizeBody(raw),
      tags: inferTags(kind, raw),
    });
  }
  return out;
}

function emitFromSoulsDir(repoRoot: string, since: number): LinguaEvent[] {
  const root = resolve(repoRoot);
  const dir = join(root, SOULS_DIR_REL);
  if (!existsSync(dir)) return [];
  const out: LinguaEvent[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const full = join(dir, name);
    let raw: Record<string, unknown>;
    try { raw = JSON.parse(readFileSync(full, "utf8")); } catch { continue; }
    let at = pickAt(raw);
    if (!at) {
      // fall back to file mtime if soul has no timestamp field
      try { at = new Date(statSync(full).mtimeMs).toISOString(); } catch { continue; }
    }
    const ts = Date.parse(at);
    if (ts < since) continue;
    const rel = `${SOULS_DIR_REL}/${name}`;
    out.push({
      v: 1,
      id: makeId(rel, raw),
      at,
      kind: "soul.entry",
      origin: rel,
      body: normalizeBody(raw),
      tags: ["soul", `vendor:${name.replace(/\.json$/, "")}`],
    });
  }
  return out;
}

export function emitStream(repoRoot: string, opts: { since?: string; maxEvents?: number } = {}): LinguaStream {
  const sinceTs = opts.since ? Date.parse(opts.since) : 0;
  const maxEvents = Math.min(opts.maxEvents ?? 1000, 10_000);

  const events: LinguaEvent[] = [];
  let totalRead = 0;
  for (const [, src] of Object.entries(SOURCES)) {
    const e = emitFromJsonl(repoRoot, src.rel, src.kind, Number.isNaN(sinceTs) ? 0 : sinceTs);
    totalRead += e.length;
    events.push(...e);
  }
  const soulEvents = emitFromSoulsDir(repoRoot, Number.isNaN(sinceTs) ? 0 : sinceTs);
  totalRead += soulEvents.length;
  events.push(...soulEvents);

  // Sort by `at` ascending (so cursor advances monotonically), then dedupe by id
  events.sort((a, b) => a.at.localeCompare(b.at));
  const seen = new Set<string>();
  const deduped: LinguaEvent[] = [];
  for (const e of events) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    deduped.push(e);
  }
  const trimmed = deduped.slice(0, maxEvents);
  const nextCursor = trimmed.length > 0 ? trimmed[trimmed.length - 1]!.at : (opts.since ?? new Date(0).toISOString());
  return { events: trimmed, nextCursor, totalRead, totalEmitted: trimmed.length };
}

/**
 * Public schema descriptor for documentation / consumer codegen.
 * Stable across versions — additions to the body shape don't bump v.
 */
export function schema(): { version: 1; topLevel: string[]; bodyExamples: Record<string, string[]>; kinds: string[] } {
  return {
    version: 1,
    topLevel: ["v", "id", "at", "kind", "origin", "body", "tags"],
    kinds: [...Object.values(SOURCES).map((s) => s.kind), "soul.entry"],
    bodyExamples: {
      "compliance.event": ["vendor", "outcome", "mandateId"],
      "action.queued": ["action", "type"],
      "wisdom.vaccine": ["rule", "scope", "rationale"],
      "wisdom.pheromone": ["pattern", "weight"],
      "mesh.event": ["sender", "msgId", "outcome"],
      "soul.entry": ["vendor", "lifetimeCompliance", "sessions"],
    },
  };
}
