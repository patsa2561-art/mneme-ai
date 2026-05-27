/**
 * 🌐 PROTOPLASM — LAN GOSSIP
 *
 * Mneme instances on the same LAN can discover each other via UDP
 * multicast and gossip per-host health summaries. Each gossip frame is
 * HMAC-signed so a hostile peer cannot inject false findings.
 *
 * Wire format (UTF-8 JSON over UDP):
 *   {
 *     v: 1,
 *     hostId: string,                 // stable per-machine id
 *     pid: number,
 *     ts: ISO,
 *     summary: { healthy, warn, broken, totalFns, walRows },
 *     hmac: hex16                     // HMAC of canonical(body)
 *   }
 *
 * Default multicast: 239.42.42.42 : 42424. Configurable via env.
 * TTL=1 keeps it on LAN (no internet leak).
 *
 * Discovery: instances announce every ANNOUNCE_MS. Receivers maintain
 * a peer map with last-seen + summary.
 */

import { createSocket, type Socket, type RemoteInfo } from "node:dgram";
import { createHmac } from "node:crypto";
import { hostname } from "node:os";

const DEFAULT_GROUP = process.env.MNEME_GOSSIP_GROUP ?? "239.42.42.42";
const DEFAULT_PORT = Number(process.env.MNEME_GOSSIP_PORT ?? 42424);
const ANNOUNCE_MS = 30_000;
const PEER_STALE_MS = 90_000;

export interface GossipSummary {
  healthy: number;
  warn: number;
  broken: number;
  totalFns: number;
  walRows: number;
}

export interface GossipFrame {
  v: 1;
  hostId: string;
  pid: number;
  ts: string;
  summary: GossipSummary;
  hmac: string;
}

export interface PeerRecord extends GossipFrame {
  lastSeenAt: string;
  fromAddress: string;
}

function canonical(o: unknown): string {
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + o.map(canonical).join(",") + "]";
  const keys = Object.keys(o as object).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical((o as any)[k])).join(",") + "}";
}

function signFrame(body: Omit<GossipFrame, "hmac">, secret: string): string {
  return createHmac("sha256", secret).update(canonical(body)).digest("hex").slice(0, 16);
}

function verifyFrame(frame: GossipFrame, secret: string): boolean {
  const { hmac, ...body } = frame;
  return signFrame(body, secret) === hmac;
}

export interface GossipOptions {
  secret: string;
  hostId?: string;
  group?: string;
  port?: number;
  onPeer?: (peer: PeerRecord) => void;
}

export class LanGossip {
  private sock: Socket | null = null;
  private peers = new Map<string, PeerRecord>();
  private announceTimer?: NodeJS.Timeout;
  private stop = false;

  constructor(public readonly opts: GossipOptions) {}

  async start(): Promise<{ ok: boolean; reason?: string; group: string; port: number }> {
    const group = this.opts.group ?? DEFAULT_GROUP;
    const port = this.opts.port ?? DEFAULT_PORT;
    return await new Promise((resolve) => {
      const sock = createSocket({ type: "udp4", reuseAddr: true });
      sock.on("error", (err) => { try { sock.close(); } catch { /* */ } resolve({ ok: false, reason: err.message, group, port }); });
      sock.on("message", (buf, rinfo) => this.handleMessage(buf, rinfo));
      sock.bind(port, () => {
        try {
          sock.setMulticastTTL(1);
          sock.setBroadcast(true);
          sock.addMembership(group);
          this.sock = sock;
          resolve({ ok: true, group, port });
        } catch (e) {
          resolve({ ok: false, reason: (e as Error).message, group, port });
        }
      });
    });
  }

  private handleMessage(buf: Buffer, rinfo: RemoteInfo): void {
    if (this.stop) return;
    try {
      const frame = JSON.parse(buf.toString("utf8")) as GossipFrame;
      if (frame.v !== 1) return;
      if (!verifyFrame(frame, this.opts.secret)) return;       // silent reject hostile
      const peer: PeerRecord = { ...frame, lastSeenAt: new Date().toISOString(), fromAddress: rinfo.address };
      this.peers.set(frame.hostId, peer);
      this.opts.onPeer?.(peer);
    } catch { /* malformed → drop */ }
  }

  announce(summary: GossipSummary): boolean {
    if (!this.sock) return false;
    const body: Omit<GossipFrame, "hmac"> = {
      v: 1,
      hostId: this.opts.hostId ?? hostname(),
      pid: process.pid,
      ts: new Date().toISOString(),
      summary,
    };
    const frame: GossipFrame = { ...body, hmac: signFrame(body, this.opts.secret) };
    const payload = Buffer.from(JSON.stringify(frame), "utf8");
    try {
      this.sock.send(payload, this.opts.port ?? DEFAULT_PORT, this.opts.group ?? DEFAULT_GROUP);
      return true;
    } catch { return false; }
  }

  startAnnouncing(summaryFn: () => GossipSummary): void {
    if (this.announceTimer) return;
    this.announce(summaryFn());
    this.announceTimer = setInterval(() => this.announce(summaryFn()), ANNOUNCE_MS);
    if (typeof (this.announceTimer as any).unref === "function") (this.announceTimer as any).unref();
  }

  listPeers(): PeerRecord[] {
    const now = Date.now();
    return [...this.peers.values()].filter((p) => now - new Date(p.lastSeenAt).getTime() < PEER_STALE_MS);
  }

  close(): void {
    this.stop = true;
    if (this.announceTimer) clearInterval(this.announceTimer);
    if (this.sock) { try { this.sock.close(); } catch { /* */ } this.sock = null; }
  }
}

export const GOSSIP_TUNING = { DEFAULT_GROUP, DEFAULT_PORT, ANNOUNCE_MS, PEER_STALE_MS };
