/**
 * v2.82.0 — BGP NOTARIZING ROUTER · the cross-protocol "BGP of agent protocols"
 * (TRUST FABRIC 💎1, on the NOTARY spine).
 *
 * Everyone builds ONE protocol (MCP or A2A or x402 or ERC-8004). Nobody builds the
 * notarizing router that lets a request hop MCP → A2A → x402 → ERC-8004 in one
 * flow where EVERY hop is signed — like BGP routing between autonomous systems,
 * but with a notary stamp + CCTV on every segment.
 *
 * Each protocol-boundary crossing becomes a NOTARY receipt (kind "protocol-hop"),
 * prev-chained into a route. `verifyRoute` proves: every hop's signature is valid,
 * the chain is intact, AND the protocols actually connect (hop[i].to == hop[i+1].from).
 * A third party verifies the whole cross-protocol path OFFLINE without trusting Mneme.
 *
 * Composes NOTARY directly. Pure except route() (signs). Never throws on verify.
 */

import { issueReceipt, verifyChain, type NotaryReceipt, type IssuerKeyPair } from "../notary/index.js";

export type Protocol = "mcp" | "a2a" | "x402" | "erc8004" | "http" | "local";

export interface Hop {
  from: Protocol;
  to: Protocol;
  /** What crosses the boundary (a tool call, an agent task, a payment, an identity check). */
  action: string;
  agent?: string;
  /** Optional structured payload attested at this hop. */
  payload?: unknown;
}

export interface RoutedHop extends Hop {
  index: number;
  receipt: NotaryReceipt;
}

const PROTOCOLS = new Set<Protocol>(["mcp", "a2a", "x402", "erc8004", "http", "local"]);

/**
 * Route a request across protocol boundaries, notarizing every hop. Returns one
 * signed, prev-chained receipt per hop. `requestId` ties the route together.
 */
export function routeRequest(
  repoRoot: string,
  input: { requestId: string; hops: Hop[] },
  keyPair?: IssuerKeyPair,
): { routeId: string; hops: RoutedHop[]; receipts: NotaryReceipt[] } {
  const routed: RoutedHop[] = [];
  const receipts: NotaryReceipt[] = [];
  let prev: string | null = null;
  const hops = Array.isArray(input.hops) ? input.hops : [];
  for (let i = 0; i < hops.length; i++) {
    const h = hops[i]!;
    const receipt = issueReceipt(repoRoot, {
      kind: "protocol-hop",
      subject: `route:${input.requestId}:${i}:${h.from}->${h.to}`,
      payload: { requestId: input.requestId, index: i, from: h.from, to: h.to, action: h.action, agent: h.agent, hopPayload: h.payload },
      prev,
    }, keyPair);
    prev = receipt.receiptId;
    routed.push({ ...h, index: i, receipt });
    receipts.push(receipt);
  }
  return { routeId: receipts.length ? receipts[receipts.length - 1]!.receiptId : input.requestId, hops: routed, receipts };
}

export interface RouteVerifyResult {
  valid: boolean;
  reason: string;
  hops: number;
  /** index where it broke, if any. */
  brokenAt?: number;
}

/**
 * Verify a routed path OFFLINE: every hop signs + chains (NOTARY), AND protocols
 * connect (each hop's `to` is the next hop's `from`). Catches a tampered or
 * spliced route across protocol boundaries.
 */
export function verifyRoute(receipts: NotaryReceipt[]): RouteVerifyResult {
  if (!Array.isArray(receipts) || receipts.length === 0) return { valid: false, reason: "empty route", hops: 0 };
  const chain = verifyChain(receipts, { sameIssuer: true });
  if (!chain.valid) return { valid: false, reason: `chain: ${chain.reason}`, hops: receipts.length, brokenAt: chain.brokenAt };
  // Protocol continuity + shape.
  let prevTo: Protocol | null = null;
  for (let i = 0; i < receipts.length; i++) {
    const p = receipts[i]!.payload as { from?: Protocol; to?: Protocol; index?: number } | undefined;
    if (!p || !PROTOCOLS.has(p.from as Protocol) || !PROTOCOLS.has(p.to as Protocol)) {
      return { valid: false, reason: `hop ${i}: invalid protocol`, hops: receipts.length, brokenAt: i };
    }
    if (p.index !== i) return { valid: false, reason: `hop ${i}: index mismatch (route reordered)`, hops: receipts.length, brokenAt: i };
    if (prevTo !== null && p.from !== prevTo) {
      return { valid: false, reason: `hop ${i}: protocol discontinuity (${prevTo} ≠ ${p.from})`, hops: receipts.length, brokenAt: i };
    }
    prevTo = p.to as Protocol;
  }
  return { valid: true, reason: "ok", hops: receipts.length };
}

/** Human path string: mcp→a2a→x402→erc8004. */
export function renderRoute(receipts: NotaryReceipt[]): string {
  if (!receipts.length) return "(empty route)";
  const first = receipts[0]!.payload as { from?: string };
  const segs = [first.from ?? "?", ...receipts.map((r) => (r.payload as { to?: string }).to ?? "?")];
  return segs.join("→");
}
