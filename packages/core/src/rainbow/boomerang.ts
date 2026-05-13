/**
 * v1.92.0 -- RAINBOW: BOOMERANG (return-pad → MCP-watched inbox).
 *
 * Closes the HOMUNCULUS loop without requiring the Web AI to call MCP.
 *
 *   Editor AI (Mneme MCP) --soul--> Web AI (chatgpt/gemini)
 *     ^                                            |
 *     | inbox.jsonl                               | emits HOMUNCULUS RETURN
 *     |                                            v
 *   Mneme MCP watcher    <-- POST /return  --  return-pad (page)
 *
 * The page (SAME-SHELL or mobile) has a textarea + Send button. User
 * pastes the Web AI's full reply (must contain HOMUNCULUS RETURN). The
 * page POSTs the body to /return. The HTTP server validates + appends
 * one line to `.mneme/inbox/homunculus-return.jsonl`. Mneme MCP daemon
 * tails this file and surfaces new entries through the supersonic
 * pulse so the editor AI sees "[BOOMERANG] new return -- ingest?".
 *
 * Zero credentials. Zero webhook. Zero new daemon process. Just append
 * + tail of a local file that MCP already watches.
 */

import { appendFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomBytes } from "node:crypto";

import { parseHomunculusReturn, type HomunculusReturn } from "../abyss/homunculus.js";

export interface BoomerangEntry {
  /** Stable per-entry id (12-hex). */
  id: string;
  /** Wall-clock when ingested. */
  receivedAt: number;
  /** Where the return was posted from (lan/same-shell/tunnel). */
  source: "lan" | "same-shell" | "tunnel" | "manual";
  /** Raw POST body. */
  raw: string;
  /** SHA-256 of raw (dedup signal). */
  rawSha256: string;
  /** Parsed HOMUNCULUS RETURN block (null if invalid). */
  parsed: HomunculusReturn | null;
  /** Whether the editor AI has acknowledged this entry. */
  ingested: boolean;
  /** Free-form note (filled when ingested=true). */
  ingestNote?: string;
}

export interface IngestResult {
  ok: boolean;
  id: string;
  parsed: HomunculusReturn | null;
  /** Reason on failure (validation/io). */
  error?: string;
}

export interface BoomerangInbox {
  path: string;
  ingest(args: { raw: string; source?: BoomerangEntry["source"] }): IngestResult;
  list(): BoomerangEntry[];
  pending(): BoomerangEntry[];
  markIngested(ids: string[], note?: string): number;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function randomId(): string {
  return randomBytes(6).toString("hex");
}

/** Open or create a BOOMERANG inbox at the given JSONL path. */
export function openBoomerangInbox(path: string): BoomerangInbox {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(path)) writeFileSync(path, "", "utf8");

  function readAll(): BoomerangEntry[] {
    const text = readFileSync(path, "utf8");
    const out: BoomerangEntry[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as BoomerangEntry;
        out.push(obj);
      } catch {
        // skip malformed lines (forward-compat)
      }
    }
    return out;
  }

  function writeAll(entries: BoomerangEntry[]): void {
    const buf = entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length > 0 ? "\n" : "");
    writeFileSync(path, buf, "utf8");
  }

  return {
    path,
    ingest({ raw, source }) {
      if (typeof raw !== "string" || raw.length === 0) {
        return { ok: false, id: "", parsed: null, error: "empty body" };
      }
      if (raw.length > 256 * 1024) {
        return { ok: false, id: "", parsed: null, error: "body too large (>256KB)" };
      }
      const parsed = parseHomunculusReturn(raw);
      if (!parsed) {
        return { ok: false, id: "", parsed: null, error: "no HOMUNCULUS RETURN block detected" };
      }
      const rawSha256 = sha256(raw);
      // Dedup: if exact sha already in the inbox, return existing id without re-appending.
      const existing = readAll().find((e) => e.rawSha256 === rawSha256);
      if (existing) {
        return { ok: true, id: existing.id, parsed: existing.parsed };
      }
      const entry: BoomerangEntry = {
        id: randomId(),
        receivedAt: Date.now(),
        source: source ?? "manual",
        raw,
        rawSha256,
        parsed,
        ingested: false,
      };
      appendFileSync(path, JSON.stringify(entry) + "\n", "utf8");
      return { ok: true, id: entry.id, parsed };
    },
    list: readAll,
    pending: () => readAll().filter((e) => !e.ingested),
    markIngested(ids, note) {
      const all = readAll();
      const idSet = new Set(ids);
      let count = 0;
      for (const e of all) {
        if (idSet.has(e.id) && !e.ingested) {
          e.ingested = true;
          if (note) e.ingestNote = note;
          count++;
        }
      }
      writeAll(all);
      return count;
    },
  };
}

/** Render a one-line summary of a pending boomerang entry, for the
 *  supersonic pulse. */
export function formatPulseLine(entry: BoomerangEntry): string {
  if (!entry.parsed) return `[BOOMERANG ${entry.id}] (unparsed body, ${entry.raw.length}B)`;
  const p = entry.parsed;
  const counts = [
    p.decisions.length > 0 ? `d:${p.decisions.length}` : null,
    p.reasoning.length > 0 ? `r:${p.reasoning.length}` : null,
    p.vaccines.length > 0 ? `v:${p.vaccines.length}` : null,
    p.nextActions.length > 0 ? `n:${p.nextActions.length}` : null,
  ].filter(Boolean).join(" ");
  return `[BOOMERANG ${entry.id}] from ${p.returningFrom} -> ${p.originator} (${counts})`;
}

/** Server-side helper: validate + handle a /return POST body and
 *  produce a JSON response payload. Caller wires this into their
 *  HTTP framework. */
export interface ReturnPostResult {
  status: number;
  body: { ok: boolean; id?: string; error?: string };
}

export function handleReturnPost(args: { inbox: BoomerangInbox; body: string; source: BoomerangEntry["source"] }): ReturnPostResult {
  const r = args.inbox.ingest({ raw: args.body, source: args.source });
  if (!r.ok) {
    return { status: 400, body: { ok: false, error: r.error ?? "validation failed" } };
  }
  return { status: 200, body: { ok: true, id: r.id } };
}
