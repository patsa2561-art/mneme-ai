/**
 * v1.83.0 -- AURA: LAN auto-discovery (no broadcast, no mDNS dep).
 *
 * Detect the local LAN IPv4 address(es) of this machine so the source
 * AI can build a `lanUrl` for the pairing payload WITHOUT asking the
 * user to type anything.
 *
 * No service broadcast on the wire -- we publish nothing to the LAN.
 * The destination device only learns the LAN URL via the QR/payload
 * the user CHOSE to share. Office neighbours never see Mneme.
 */

import { networkInterfaces } from "node:os";

export interface LanCandidate {
  /** Interface name (eth0 / Wi-Fi / en0 etc). */
  iface: string;
  ipv4: string;
  /** Is this a private RFC1918 address? */
  isPrivate: boolean;
}

function isPrivateIPv4(addr: string): boolean {
  if (addr.startsWith("10.")) return true;
  if (addr.startsWith("192.168.")) return true;
  if (addr.startsWith("172.")) {
    const second = parseInt(addr.split(".")[1] ?? "0", 10);
    return second >= 16 && second <= 31;
  }
  return false;
}

/** List private LAN IPv4 addresses (no loopback). */
export function discoverLanAddresses(): LanCandidate[] {
  const out: LanCandidate[] = [];
  const ifaces = networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    for (const a of addrs) {
      if (a.family === "IPv4" && !a.internal && isPrivateIPv4(a.address)) {
        out.push({ iface: name, ipv4: a.address, isPrivate: true });
      }
    }
  }
  return out;
}

/** Build a LAN URL from the best candidate + a port. Returns null if
 *  no private interface is found (machine isn't on a LAN -- use
 *  Gist transport instead). */
export function buildLanUrl(port = 7741): string | null {
  const candidates = discoverLanAddresses();
  if (candidates.length === 0) return null;
  // Prefer Wi-Fi-named interfaces, then any private IPv4.
  const wifi = candidates.find((c) => /wi-?fi|wlan|wifi/i.test(c.iface));
  const best = wifi ?? candidates[0]!;
  return `http://${best.ipv4}:${port}`;
}
