/**
 * v1.61.0 -- EXODUS LAYER 6: WISDOM RIVER.
 *
 * Continuous broadcast of Mneme events over Server-Sent Events (SSE)
 * + a local JSONL ring buffer. Any tool subscribes:
 *
 *   curl -N http://127.0.0.1:11550/events           (CLI)
 *   new EventSource("http://127.0.0.1:11550/events") (browser / vscode)
 *
 * Events are JSONL objects { ts, kind, payload }. Kinds:
 *   "verdict"   -- ACGV verdict on a claim
 *   "vaccine"   -- new lie pattern recorded
 *   "forecast"  -- regression forecast computed
 *   "violation" -- covenant violation detected
 *   "soul"      -- ai-soul mirror updated
 *   "tick"      -- nucleus daemon tick
 *
 * Free-first: no `ws` dependency, no npm install. Just node:http SSE.
 * Single subscriber port; the buffer survives subscriber churn.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type EventKind = "verdict" | "vaccine" | "forecast" | "violation" | "soul" | "tick" | "custom";

export interface WisdomEvent {
  ts: string;
  kind: EventKind;
  payload: Record<string, unknown>;
}

interface Subscriber { res: ServerResponse; id: number }

export class WisdomRiver {
  private server: Server | null = null;
  private subscribers: Subscriber[] = [];
  private subId = 0;
  private buffer: WisdomEvent[] = [];
  private readonly bufferCap = 1000;

  constructor(private repoRoot: string, private port: number) {}

  /** Start the SSE server. Idempotent: returns the live port. */
  async start(): Promise<{ port: number }> {
    if (this.server) return { port: this.port };
    return new Promise((resolve, reject) => {
      const srv = createServer((req, res) => this.handle(req, res));
      srv.on("error", reject);
      srv.listen(this.port, "127.0.0.1", () => {
        this.server = srv;
        resolve({ port: this.port });
      });
    });
  }

  /** Stop the server + close all subscribers. Always safe to call. */
  async stop(): Promise<void> {
    for (const s of this.subscribers) { try { s.res.end(); } catch { /* */ } }
    this.subscribers = [];
    if (this.server) {
      await new Promise<void>((r) => this.server!.close(() => r()));
      this.server = null;
    }
  }

  /** Push an event to every subscriber + the rotating buffer + audit log. */
  emit(kind: EventKind, payload: Record<string, unknown>): WisdomEvent {
    const event: WisdomEvent = { ts: new Date().toISOString(), kind, payload };
    this.buffer.push(event);
    if (this.buffer.length > this.bufferCap) this.buffer.shift();
    const line = `event: ${kind}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const s of this.subscribers) {
      try { s.res.write(line); } catch { /* dead subscriber -- garbage-collected on next handle */ }
    }
    try {
      const dir = join(this.repoRoot, ".mneme", "exodus", "river");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, "events.jsonl"), JSON.stringify(event) + "\n", "utf8");
    } catch { /* */ }
    return event;
  }

  /** Snapshot recent events from the in-memory ring buffer. */
  recent(n: number = 50): WisdomEvent[] {
    return this.buffer.slice(-n);
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    if (req.url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      // Replay last 20 events to new subscriber so it has context.
      for (const e of this.buffer.slice(-20)) {
        res.write(`event: ${e.kind}\ndata: ${JSON.stringify(e)}\n\n`);
      }
      const id = ++this.subId;
      this.subscribers.push({ res, id });
      req.on("close", () => {
        this.subscribers = this.subscribers.filter((s) => s.id !== id);
      });
      return;
    }
    if (req.url === "/recent") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(this.recent(50)));
      return;
    }
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, subscribers: this.subscribers.length, buffered: this.buffer.length }));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  }
}

/** Read the persisted JSONL event log. */
export function readEventLog(repoRoot: string, tail: number = 100): WisdomEvent[] {
  const p = join(repoRoot, ".mneme", "exodus", "river", "events.jsonl");
  if (!existsSync(p)) return [];
  try {
    const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
    return lines.slice(-tail).map((l) => {
      try { return JSON.parse(l) as WisdomEvent; } catch { return null; }
    }).filter((x): x is WisdomEvent => x !== null);
  } catch { return []; }
}
