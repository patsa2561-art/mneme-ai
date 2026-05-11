import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { emitMessage, ingestMessage, forward, getOrCreateMeshSecret, listQuarantine, listSeen } from "./gossip_mesh.js";

describe("avatar/gossip_mesh · secret + signing", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-mesh-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("creates a 64-hex-char mesh secret on first use", () => {
    const s = getOrCreateMeshSecret(repo);
    expect(s).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns same secret on subsequent calls", () => {
    const s1 = getOrCreateMeshSecret(repo);
    const s2 = getOrCreateMeshSecret(repo);
    expect(s1).toBe(s2);
  });

  it("emit + ingest in same mesh = accepted", () => {
    const m = emitMessage(repo, { kind: "vaccine", sender: "alice", body: JSON.stringify({ rule: "no eval" }) });
    const r = ingestMessage(repo, m);
    expect(r.outcome).toBe("accepted");
  });
});

describe("avatar/gossip_mesh · cross-mesh signature isolation", () => {
  let repoA: string;
  let repoB: string;
  beforeEach(() => {
    repoA = mkdtempSync(join(tmpdir(), "mneme-meshA-"));
    repoB = mkdtempSync(join(tmpdir(), "mneme-meshB-"));
  });
  afterEach(() => {
    try { rmSync(repoA, { recursive: true, force: true }); } catch { /* */ }
    try { rmSync(repoB, { recursive: true, force: true }); } catch { /* */ }
  });

  it("message signed by mesh A is REJECTED by mesh B (different secret)", () => {
    const m = emitMessage(repoA, { kind: "advisory", sender: "alice", body: "x" });
    const r = ingestMessage(repoB, m);
    expect(r.outcome).toBe("bad-signature");
  });

  it("when both meshes share the same secret, message is accepted", () => {
    const sharedSecret = getOrCreateMeshSecret(repoA);
    // Manually plant the same secret in repoB BEFORE first use
    const fs = require("node:fs") as typeof import("node:fs");
    fs.mkdirSync(join(repoB, ".mneme"), { recursive: true });
    writeFileSync(join(repoB, ".mneme/mesh-secret"), sharedSecret + "\n");
    const m = emitMessage(repoA, { kind: "vaccine", sender: "alice", body: "y" });
    const r = ingestMessage(repoB, m);
    expect(r.outcome).toBe("accepted");
  });
});

describe("avatar/gossip_mesh · dedup + replay protection", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-mesh-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("ingesting the same message twice → second is duplicate", () => {
    const m = emitMessage(repo, { kind: "vaccine", sender: "a", body: "z" });
    const r1 = ingestMessage(repo, m);
    const r2 = ingestMessage(repo, m);
    expect(r1.outcome).toBe("accepted");
    expect(r2.outcome).toBe("duplicate");
  });

  it("two different messages from same sender both accepted", () => {
    const m1 = emitMessage(repo, { kind: "vaccine", sender: "a", body: "one" });
    const m2 = emitMessage(repo, { kind: "vaccine", sender: "a", body: "two" });
    expect(ingestMessage(repo, m1).outcome).toBe("accepted");
    expect(ingestMessage(repo, m2).outcome).toBe("accepted");
  });
});

describe("avatar/gossip_mesh · hop limit", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-mesh-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("forward bumps hops + re-signs", () => {
    const m = emitMessage(repo, { kind: "vaccine", sender: "a", body: "x" });
    const fwd = forward(repo, m)!;
    expect(fwd.hops).toBe(1);
    expect(fwd.signature).not.toBe(m.signature);
    expect(ingestMessage(repo, fwd).outcome).toBe("accepted");
  });

  it("rejects message with hops > MAX_HOPS", () => {
    const m = { ...emitMessage(repo, { kind: "vaccine", sender: "a", body: "x" }), hops: 99 };
    // Re-sign with the right hops or it'd be bad-sig — but we want hops-exceeded specifically
    // So sign properly with hops=99
    const secret = getOrCreateMeshSecret(repo);
    const { createHmac } = require("node:crypto") as typeof import("node:crypto");
    m.signature = createHmac("sha256", secret).update(`${m.kind}|${m.sender}|${m.body}|99`).digest("hex");
    expect(ingestMessage(repo, m).outcome).toBe("hops-exceeded");
  });

  it("forward returns null at hops cap", () => {
    const m = { ...emitMessage(repo, { kind: "vaccine", sender: "a", body: "x" }), hops: 3 };
    expect(forward(repo, m)).toBeNull();
  });
});

describe("avatar/gossip_mesh · sender quota", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-mesh-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("over-quota messages quarantine", () => {
    // Hit 100 messages from "spammer" rapidly
    for (let i = 0; i < 100; i++) {
      const m = emitMessage(repo, { kind: "advisory", sender: "spammer", body: `msg-${i}` });
      ingestMessage(repo, m);
    }
    const overflow = emitMessage(repo, { kind: "advisory", sender: "spammer", body: "overflow" });
    const r = ingestMessage(repo, overflow);
    expect(r.outcome).toBe("quota-exceeded");
    expect(listQuarantine(repo)).toHaveLength(1);
  });
});

describe("avatar/gossip_mesh · trust escalation", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-mesh-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("11th vaccine from sender with 10 clean accepts → trusted-auto-apply", () => {
    for (let i = 0; i < 10; i++) {
      const m = emitMessage(repo, { kind: "vaccine", sender: "trusted", body: `v-${i}` });
      ingestMessage(repo, m);
    }
    const m11 = emitMessage(repo, { kind: "vaccine", sender: "trusted", body: "v-11" });
    expect(ingestMessage(repo, m11).outcome).toBe("trusted-auto-apply");
  });

  it("non-vaccine kinds never auto-apply", () => {
    for (let i = 0; i < 10; i++) {
      const m = emitMessage(repo, { kind: "vaccine", sender: "trusted", body: `v-${i}` });
      ingestMessage(repo, m);
    }
    const adv = emitMessage(repo, { kind: "advisory", sender: "trusted", body: "advisory" });
    expect(ingestMessage(repo, adv).outcome).toBe("accepted");
  });
});

describe("avatar/gossip_mesh · listSeen", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-mesh-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("listSeen reflects every ingest call", () => {
    const m1 = emitMessage(repo, { kind: "vaccine", sender: "a", body: "x" });
    const m2 = emitMessage(repo, { kind: "vaccine", sender: "a", body: "y" });
    ingestMessage(repo, m1);
    ingestMessage(repo, m2);
    expect(listSeen(repo)).toHaveLength(2);
  });
});
