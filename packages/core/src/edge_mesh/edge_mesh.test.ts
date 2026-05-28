/**
 * v2.82.0 — SOVEREIGN EDGE MESH pinned + QUAN tests (💎9).
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPeerCard, verifyPeerCard, mergeMesh } from "./index.js";
import { type NotaryReceipt } from "../notary/index.js";

const repo = () => mkdtempSync(join(tmpdir(), "mneme-edge-"));

describe("v2.82.0 💎9 Edge Mesh (PINNED)", () => {
  it("E1 build → verify offline; tamper fails", () => {
    const r = repo();
    const { receipt } = buildPeerCard(r, { peer: "laptop", lanUrl: "http://192.168.1.5:7741", capabilities: ["verify", "index"] });
    const v = verifyPeerCard(JSON.parse(JSON.stringify(receipt)));
    expect(v.valid).toBe(true);
    expect(v.peer!.lanUrl).toBe("http://192.168.1.5:7741");
    expect(verifyPeerCard({ ...receipt, payload: { ...(receipt.payload as object), lanUrl: "http://evil.cloud" } } as NotaryReceipt).valid).toBe(false);
  });
  it("E2 mergeMesh dedups by peer (latest issuedAt wins) + drops forged", () => {
    const r = repo();
    const c1 = buildPeerCard(r, { peer: "node-a", lanUrl: "http://a:1", issuedAt: 100 }).receipt;
    const c2 = buildPeerCard(r, { peer: "node-a", lanUrl: "http://a:2", issuedAt: 200 }).receipt; // newer
    const c3 = buildPeerCard(r, { peer: "node-b", lanUrl: "http://b:1", issuedAt: 50 }).receipt;
    const forged = { ...c3, payload: { ...(c3.payload as object), peer: "node-c" } } as NotaryReceipt;
    const mesh = mergeMesh([c1, c2, c3, forged]);
    expect(mesh.admitted).toBe(2);
    expect(mesh.rejected).toBe(1);
    expect(mesh.peers.find((p) => p.peer === "node-a")!.lanUrl).toBe("http://a:2");
  });
});

describe("v2.82.0 💎9 QUAN", () => {
  it("Q mergeMesh is order-independent + idempotent", () => {
    const r = repo();
    const cards: NotaryReceipt[] = [];
    for (let i = 0; i < 20; i++) cards.push(buildPeerCard(r, { peer: `peer-${i % 7}`, lanUrl: `http://h:${i}`, issuedAt: (i * 11) % 50 }).receipt);
    const a = mergeMesh(cards);
    const b = mergeMesh(cards.slice().reverse());
    expect(a.peers.map((p) => `${p.peer}@${p.lanUrl}`)).toEqual(b.peers.map((p) => `${p.peer}@${p.lanUrl}`));
    // idempotent: re-merging the admitted cards yields the same set
    const reMerged = mergeMesh(a.peers.map((p) => buildPeerCard(r, { peer: p.peer, lanUrl: p.lanUrl, capabilities: p.capabilities, issuedAt: p.issuedAt }).receipt));
    expect(reMerged.peers.map((p) => p.peer)).toEqual(a.peers.map((p) => p.peer));
  });
});
