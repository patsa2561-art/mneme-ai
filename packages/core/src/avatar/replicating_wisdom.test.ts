import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { packWisdom, inheritPack, listLocalPacks, listInheritances } from "./replicating_wisdom.js";
import { publishCard, castVote } from "../teeth/genome_market.js";
import { getOrCreateMeshSecret } from "./gossip_mesh.js";

function ratifiedSetup(repo: string, n: number): void {
  for (let i = 0; i < n; i++) {
    publishCard(repo, { id: `vac-${i}`, author: "alice", title: `t${i}`, body: `body-${i}` });
    castVote(repo, { validator: `b${i}`, cardId: `vac-${i}`, vouch: true });
    castVote(repo, { validator: `c${i}`, cardId: `vac-${i}`, vouch: true });
    castVote(repo, { validator: `d${i}`, cardId: `vac-${i}`, vouch: true });
  }
}

describe("avatar/replicating_wisdom · packing", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-wisdom-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("packs zero vaccines when nothing ratified yet", () => {
    publishCard(repo, { id: "vac-1", author: "alice", title: "t", body: "b" });
    const pack = packWisdom(repo, { donorSender: "donor-a", donorMnemeVersion: "1.44.0" });
    expect(pack.vaccines).toHaveLength(0);
  });

  it("packs ratified vaccines", () => {
    ratifiedSetup(repo, 3);
    const pack = packWisdom(repo, { donorSender: "donor-a", donorMnemeVersion: "1.44.0" });
    expect(pack.vaccines).toHaveLength(3);
    expect(pack.metadata.ratifiedCount).toBe(3);
  });

  it("respects topK", () => {
    ratifiedSetup(repo, 25);
    const pack = packWisdom(repo, { donorSender: "donor-a", donorMnemeVersion: "1.44.0", topK: 5 });
    expect(pack.vaccines).toHaveLength(5);
  });

  it("scrubs PII from titles + bodies", () => {
    publishCard(repo, { id: "vac-pii", author: "alice", title: "fix for alice@example.com", body: "called +66 939455645 about bug" });
    castVote(repo, { validator: "b", cardId: "vac-pii", vouch: true });
    castVote(repo, { validator: "c", cardId: "vac-pii", vouch: true });
    castVote(repo, { validator: "d", cardId: "vac-pii", vouch: true });
    const pack = packWisdom(repo, { donorSender: "donor-a", donorMnemeVersion: "1.44.0" });
    expect(pack.vaccines[0]!.title).not.toContain("@example.com");
    expect(pack.vaccines[0]!.body).not.toContain("939455645");
    expect(pack.vaccines[0]!.title).toContain("<email>");
    expect(pack.vaccines[0]!.body).toContain("<phone>");
  });

  it("first pack has prevPackHash=null", () => {
    ratifiedSetup(repo, 1);
    const pack = packWisdom(repo, { donorSender: "donor-a", donorMnemeVersion: "1.44.0" });
    expect(pack.prevPackHash).toBeNull();
  });

  it("subsequent pack chains to previous", () => {
    ratifiedSetup(repo, 1);
    const p1 = packWisdom(repo, { donorSender: "donor-a", donorMnemeVersion: "1.44.0" });
    const p2 = packWisdom(repo, { donorSender: "donor-a", donorMnemeVersion: "1.44.0" });
    expect(p2.prevPackHash).toBe(p1.packId);
  });

  it("listLocalPacks returns chronologically", () => {
    ratifiedSetup(repo, 1);
    packWisdom(repo, { donorSender: "donor-a", donorMnemeVersion: "1.44.0" });
    packWisdom(repo, { donorSender: "donor-a", donorMnemeVersion: "1.44.0" });
    const list = listLocalPacks(repo);
    expect(list).toHaveLength(2);
    expect(list[0]!.packedAt <= list[1]!.packedAt).toBe(true);
  });
});

describe("avatar/replicating_wisdom · inherit", () => {
  let donorRepo: string;
  let receiverRepo: string;
  beforeEach(() => {
    donorRepo = mkdtempSync(join(tmpdir(), "mneme-wisdom-d-"));
    receiverRepo = mkdtempSync(join(tmpdir(), "mneme-wisdom-r-"));
  });
  afterEach(() => {
    try { rmSync(donorRepo, { recursive: true, force: true }); } catch { /* */ }
    try { rmSync(receiverRepo, { recursive: true, force: true }); } catch { /* */ }
  });

  it("inherits a clean pack (different mesh, advisory mode)", () => {
    ratifiedSetup(donorRepo, 3);
    const pack = packWisdom(donorRepo, { donorSender: "donor", donorMnemeVersion: "1.44.0" });
    const r = inheritPack(receiverRepo, pack);
    expect(r.outcome).toBe("inherited");
  });

  it("rejects pack with rejection rate > 30%", () => {
    ratifiedSetup(donorRepo, 1);
    const pack = packWisdom(donorRepo, { donorSender: "donor", donorMnemeVersion: "1.44.0" });
    pack.metadata.rejectionRate = 0.50;
    // recompute packId so we get past the integrity check first
    const { packId: _id, signature: _sig, ...rest } = pack;
    pack.packId = (require("node:crypto") as typeof import("node:crypto")).createHash("sha256").update(JSON.stringify(rest)).digest("hex");
    const r = inheritPack(receiverRepo, pack);
    expect(r.outcome).toBe("rejected-rate");
  });

  it("rejects pack with mutated payload (tamper detection)", () => {
    ratifiedSetup(donorRepo, 1);
    const pack = packWisdom(donorRepo, { donorSender: "donor", donorMnemeVersion: "1.44.0" });
    pack.vaccines[0]!.body = "TAMPERED";
    const r = inheritPack(receiverRepo, pack);
    expect(r.outcome).toBe("rejected-signature");
  });

  it("rejects pack with broken chain (prev not local)", () => {
    ratifiedSetup(donorRepo, 1);
    packWisdom(donorRepo, { donorSender: "donor", donorMnemeVersion: "1.44.0" });
    const pack2 = packWisdom(donorRepo, { donorSender: "donor", donorMnemeVersion: "1.44.0" });
    // receiver doesn't have pack1 → should reject pack2
    const r = inheritPack(receiverRepo, pack2);
    expect(r.outcome).toBe("rejected-chain");
  });

  it("dedupes second inherit of same pack", () => {
    ratifiedSetup(donorRepo, 1);
    const pack = packWisdom(donorRepo, { donorSender: "donor", donorMnemeVersion: "1.44.0" });
    expect(inheritPack(receiverRepo, pack).outcome).toBe("inherited");
    expect(inheritPack(receiverRepo, pack).outcome).toBe("duplicate");
  });

  it("listInheritances tracks every inherit", () => {
    ratifiedSetup(donorRepo, 1);
    const pack = packWisdom(donorRepo, { donorSender: "donor", donorMnemeVersion: "1.44.0" });
    inheritPack(receiverRepo, pack);
    expect(listInheritances(receiverRepo)).toHaveLength(1);
  });

  it("sameMesh=true verifies signature under shared secret", () => {
    // Plant identical mesh secret in both
    const sharedSecret = getOrCreateMeshSecret(donorRepo);
    const fs = require("node:fs") as typeof import("node:fs");
    fs.mkdirSync(join(receiverRepo, ".mneme"), { recursive: true });
    writeFileSync(join(receiverRepo, ".mneme/mesh-secret"), sharedSecret + "\n");
    ratifiedSetup(donorRepo, 1);
    const pack = packWisdom(donorRepo, { donorSender: "donor", donorMnemeVersion: "1.44.0" });
    expect(inheritPack(receiverRepo, pack, { sameMesh: true }).outcome).toBe("inherited");
  });

  it("sameMesh=true rejects when secrets differ", () => {
    ratifiedSetup(donorRepo, 1);
    const pack = packWisdom(donorRepo, { donorSender: "donor", donorMnemeVersion: "1.44.0" });
    // receiverRepo has its own (different) secret — sameMesh check should fail
    const r = inheritPack(receiverRepo, pack, { sameMesh: true });
    expect(r.outcome).toBe("rejected-signature");
  });
});
