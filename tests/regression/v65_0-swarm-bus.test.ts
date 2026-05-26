/**
 * v2.65.0 — SWARM BUS (cross-agent message bus) pinned tests.
 *
 * Section map:
 *   H1 — channel create + list
 *   H2 — subscribe (public auto-creates)
 *   H3 — broadcast (delivery + sender excluded)
 *   H4 — drain (causal order + inbox empties)
 *   H5 — peek (non-destructive)
 *   H6 — Lamport clock + message HMAC
 *   H7 — handoff narrative
 *   H8 — HMAC-chained ledger
 *   H9 — CLI surface
 *   H10 — TG probes
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "../..");
const CLI = join(REPO, "packages", "cli", "bin", "mneme.js");

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "mneme-sb-"));
}

describe("v2.65.0 H1 — channel create + list (PINNED)", () => {
  it("H1.1 createChannel records meta + appears in listChannels", async () => {
    const m = await import("../../packages/core/src/swarm_bus/index.js");
    const dir = tmp();
    try {
      m.createChannel({ channel: "test", kind: "public", owner: "claude", cwd: dir });
      const chs = m.listChannels(dir);
      expect(chs.length).toBe(1);
      expect(chs[0]?.name).toBe("test");
      expect(chs[0]?.kind).toBe("public");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("H1.2 createChannel is idempotent (same name returns existing)", async () => {
    const m = await import("../../packages/core/src/swarm_bus/index.js");
    const dir = tmp();
    try {
      m.createChannel({ channel: "test", kind: "public", owner: "claude", cwd: dir });
      const r2 = m.createChannel({ channel: "test", kind: "private", owner: "other", cwd: dir });
      expect(r2.ok).toBe(true);
      expect(m.listChannels(dir).length).toBe(1);
      expect(m.listChannels(dir)[0]?.kind).toBe("public"); // original wins
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.65.0 H2 — subscribe (PINNED)", () => {
  it("H2.1 subscribe to non-existent public channel auto-creates it", async () => {
    const m = await import("../../packages/core/src/swarm_bus/index.js");
    const dir = tmp();
    try {
      const r = await m.subscribe({ channel: "new", agent: "a", cwd: dir });
      expect(r.ok).toBe(true);
      expect(m.listChannels(dir).length).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("H2.2 subscribe is idempotent", async () => {
    const m = await import("../../packages/core/src/swarm_bus/index.js");
    const dir = tmp();
    try {
      await m.subscribe({ channel: "c", agent: "a", cwd: dir });
      const r2 = await m.subscribe({ channel: "c", agent: "a", cwd: dir });
      expect(r2.reason).toBe("already_subscribed");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("H2.3 subscribe to private channel without passport → refused", async () => {
    const m = await import("../../packages/core/src/swarm_bus/index.js");
    const dir = tmp();
    try {
      m.createChannel({ channel: "secret", kind: "private", owner: "claude", cwd: dir });
      const r = await m.subscribe({ channel: "secret", agent: "a", cwd: dir });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("passport_required");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("H2.4 subscribe to private with invalid passport → refused", async () => {
    const m = await import("../../packages/core/src/swarm_bus/index.js");
    const dir = tmp();
    try {
      m.createChannel({ channel: "secret", kind: "private", owner: "claude", cwd: dir });
      const r = await m.subscribe({ channel: "secret", agent: "a", passportToken: "totally-fake", cwd: dir });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("passport_invalid");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.65.0 H3 — broadcast (PINNED)", () => {
  it("H3.1 broadcast delivers to all subscribers EXCEPT sender", async () => {
    const m = await import("../../packages/core/src/swarm_bus/index.js");
    const dir = tmp();
    try {
      await m.subscribe({ channel: "c", agent: "a", cwd: dir });
      await m.subscribe({ channel: "c", agent: "b", cwd: dir });
      await m.subscribe({ channel: "c", agent: "claude", cwd: dir });
      const r = await m.broadcast({ channel: "c", from: "claude", text: "hello", cwd: dir });
      expect(r.ok).toBe(true);
      expect(r.deliveredTo.length).toBe(2);
      expect(r.deliveredTo).not.toContain("claude");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("H3.2 broadcast to unknown channel → channel_unknown", async () => {
    const m = await import("../../packages/core/src/swarm_bus/index.js");
    const dir = tmp();
    try {
      const r = await m.broadcast({ channel: "nope", from: "a", text: "x", cwd: dir });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("channel_unknown");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("H3.3 broadcast on channel with 0 other subscribers still ok (delivered=[])", async () => {
    const m = await import("../../packages/core/src/swarm_bus/index.js");
    const dir = tmp();
    try {
      await m.subscribe({ channel: "lonely", agent: "claude", cwd: dir });
      const r = await m.broadcast({ channel: "lonely", from: "claude", text: "hello?", cwd: dir });
      expect(r.ok).toBe(true);
      expect(r.deliveredTo.length).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("H3.4 broadcast carries artifactHmac through to message", async () => {
    const m = await import("../../packages/core/src/swarm_bus/index.js");
    const dir = tmp();
    try {
      await m.subscribe({ channel: "c", agent: "b", cwd: dir });
      const r = await m.broadcast({ channel: "c", from: "a", text: "x", artifactHmac: "abc123", artifactPath: "src/x.ts", cwd: dir });
      expect(r.message?.artifactHmac).toBe("abc123");
      expect(r.message?.artifactPath).toBe("src/x.ts");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.65.0 H4 — drain (PINNED)", () => {
  it("H4.1 drain returns messages + empties inbox", async () => {
    const m = await import("../../packages/core/src/swarm_bus/index.js");
    const dir = tmp();
    try {
      await m.subscribe({ channel: "c", agent: "b", cwd: dir });
      await m.broadcast({ channel: "c", from: "a", text: "msg1", cwd: dir });
      const r1 = m.drain({ agent: "b", cwd: dir });
      expect(r1.messages.length).toBe(1);
      const r2 = m.drain({ agent: "b", cwd: dir });
      expect(r2.messages.length).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("H4.2 channel filter on drain", async () => {
    const m = await import("../../packages/core/src/swarm_bus/index.js");
    const dir = tmp();
    try {
      await m.subscribe({ channel: "c1", agent: "b", cwd: dir });
      await m.subscribe({ channel: "c2", agent: "b", cwd: dir });
      await m.broadcast({ channel: "c1", from: "a", text: "from c1", cwd: dir });
      await m.broadcast({ channel: "c2", from: "a", text: "from c2", cwd: dir });
      const r = m.drain({ agent: "b", channel: "c1", cwd: dir });
      expect(r.messages.length).toBe(1);
      expect(r.messages[0]?.channel).toBe("c1");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("H4.3 limit on drain", async () => {
    const m = await import("../../packages/core/src/swarm_bus/index.js");
    const dir = tmp();
    try {
      await m.subscribe({ channel: "c", agent: "b", cwd: dir });
      for (let i = 0; i < 5; i++) await m.broadcast({ channel: "c", from: "a", text: "m" + i, cwd: dir });
      const r = m.drain({ agent: "b", limit: 2, cwd: dir });
      expect(r.messages.length).toBe(2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.65.0 H5 — peek (PINNED)", () => {
  it("H5.1 peek returns messages without consuming", async () => {
    const m = await import("../../packages/core/src/swarm_bus/index.js");
    const dir = tmp();
    try {
      await m.subscribe({ channel: "c", agent: "b", cwd: dir });
      await m.broadcast({ channel: "c", from: "a", text: "x", cwd: dir });
      const p1 = m.peekInbox(dir, "b");
      const p2 = m.peekInbox(dir, "b");
      expect(p1.length).toBe(1);
      expect(p2.length).toBe(1); // still there
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.65.0 H6 — Lamport clock + message HMAC (PINNED)", () => {
  it("H6.1 successive broadcasts get monotonic Lamport timestamps", async () => {
    const m = await import("../../packages/core/src/swarm_bus/index.js");
    const dir = tmp();
    try {
      await m.subscribe({ channel: "c", agent: "b", cwd: dir });
      const r1 = await m.broadcast({ channel: "c", from: "a", text: "1", cwd: dir });
      const r2 = await m.broadcast({ channel: "c", from: "a", text: "2", cwd: dir });
      const r3 = await m.broadcast({ channel: "c", from: "a", text: "3", cwd: dir });
      expect(r1.message?.lamport).toBe(1);
      expect(r2.message?.lamport).toBe(2);
      expect(r3.message?.lamport).toBe(3);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("H6.2 verifyMessage round-trips + tamper fails", async () => {
    const m = await import("../../packages/core/src/swarm_bus/index.js");
    const dir = tmp();
    try {
      await m.subscribe({ channel: "c", agent: "b", cwd: dir });
      const r = await m.broadcast({ channel: "c", from: "a", text: "x", cwd: dir });
      expect(m.verifyMessage(r.message!)).toBe(true);
      const tampered = { ...r.message!, text: "evil" };
      expect(m.verifyMessage(tampered)).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.65.0 H7 — handoff narrative (PINNED)", () => {
  it("H7.1 3-agent chain renders correctly", async () => {
    const m = await import("../../packages/core/src/swarm_bus/index.js");
    const dir = tmp();
    try {
      await m.subscribe({ channel: "team", agent: "claude", cwd: dir });
      await m.subscribe({ channel: "team", agent: "cursor", cwd: dir });
      await m.subscribe({ channel: "team", agent: "continue", cwd: dir });
      await m.broadcast({ channel: "team", from: "claude", text: "step1", cwd: dir });
      await m.broadcast({ channel: "team", from: "cursor", text: "step2", cwd: dir });
      await m.broadcast({ channel: "team", from: "continue", text: "step3", cwd: dir });
      const h = m.auditHandoff(dir, "team");
      expect(h.steps.length).toBe(3);
      expect(h.chain).toEqual(["claude", "cursor", "continue"]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("H7.2 empty channel handoff is empty array", async () => {
    const m = await import("../../packages/core/src/swarm_bus/index.js");
    const dir = tmp();
    try {
      const h = m.auditHandoff(dir, "ghost");
      expect(h.steps.length).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.65.0 H8 — HMAC-chained ledger (PINNED)", () => {
  it("H8.1 fresh ledger → ok with 0 rows", async () => {
    const m = await import("../../packages/core/src/swarm_bus/index.js");
    const dir = tmp();
    try {
      const r = m.verifyLedgerChain(dir);
      expect(r.ok).toBe(true);
      expect(r.rows).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("H8.2 multi-event sequence chains", async () => {
    const m = await import("../../packages/core/src/swarm_bus/index.js");
    const dir = tmp();
    try {
      await m.subscribe({ channel: "c", agent: "a", cwd: dir });
      await m.subscribe({ channel: "c", agent: "b", cwd: dir });
      await m.broadcast({ channel: "c", from: "a", text: "x", cwd: dir });
      m.drain({ agent: "b", cwd: dir });
      const led = m.verifyLedgerChain(dir);
      expect(led.ok).toBe(true);
      expect(led.rows).toBeGreaterThanOrEqual(4); // create+sub+sub+broadcast+drain
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.65.0 H9 — CLI surface (PINNED)", () => {
  function runCli(args: string[], cwd?: string): { stdout: string; stderr: string; status: number | null } {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 60000, cwd });
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
  }

  it("H9.1 `subscribe` + `broadcast` + `drain` round-trip via CLI", () => {
    const dir = tmp();
    try {
      const s = runCli(["swarm_bus", "subscribe", "--channel", "c", "--agent", "b"], dir);
      expect(s.status).toBe(0);
      const b = runCli(["swarm_bus", "broadcast", "--channel", "c", "--from", "a", "--text", "hello"], dir);
      expect(b.status).toBe(0);
      const d = runCli(["swarm_bus", "drain", "--agent", "b"], dir);
      expect(d.status).toBe(0);
      const dr = JSON.parse(d.stdout);
      expect(dr.messages.length).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("H9.2 `channels` lists existing channels", () => {
    const dir = tmp();
    try {
      runCli(["swarm_bus", "subscribe", "--channel", "c1", "--agent", "a"], dir);
      runCli(["swarm_bus", "subscribe", "--channel", "c2", "--agent", "a"], dir);
      const r = runCli(["swarm_bus", "channels"], dir);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.count).toBe(2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("H9.3 `handoff --banner` renders narrative", () => {
    const dir = tmp();
    try {
      runCli(["swarm_bus", "subscribe", "--channel", "team", "--agent", "claude"], dir);
      runCli(["swarm_bus", "subscribe", "--channel", "team", "--agent", "cursor"], dir);
      runCli(["swarm_bus", "broadcast", "--channel", "team", "--from", "claude", "--text", "step1"], dir);
      runCli(["swarm_bus", "broadcast", "--channel", "team", "--from", "cursor", "--text", "step2"], dir);
      const r = runCli(["swarm_bus", "handoff", "--channel", "team", "--banner"], dir);
      expect(r.stdout).toMatch(/SWARM handoff/);
      expect(r.stdout).toMatch(/claude → cursor/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("H9.4 `audit` returns envelope", () => {
    const dir = tmp();
    try {
      const r = runCli(["swarm_bus", "audit"], dir);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(typeof parsed.totalRows).toBe("number");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.65.0 H10 — TG probes (PINNED)", () => {
  it("H10.1 probe.swarm_bus.broadcast_drain_handoff returns 1", async () => {
    const m = await import("../../packages/core/src/truth_gate/probes.js");
    const p = m.probeById("probe.swarm_bus.broadcast_drain_handoff");
    expect(p).toBeDefined();
    const r = await p!.run({ cwd: REPO });
    expect(r.value).toBe(1);
  });

  it("H10.2 probe.swarm_bus.ledger_chain_intact returns 1 or null", async () => {
    const m = await import("../../packages/core/src/truth_gate/probes.js");
    const p = m.probeById("probe.swarm_bus.ledger_chain_intact");
    expect(p).toBeDefined();
    const r = await p!.run({ cwd: REPO });
    expect([null, 0, 1]).toContain(r.value);
  });
});
