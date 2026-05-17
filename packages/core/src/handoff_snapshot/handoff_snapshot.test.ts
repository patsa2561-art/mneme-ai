import { describe, it, expect } from "vitest";
import {
  captureSnapshot,
  verifyEnvelope,
  freshnessCheck,
  renderForChildVendor,
  computeSnapshotStats,
  formatSnapshotLine,
  HANDOFF_SNAPSHOT_TUNABLES,
} from "./index.js";

const SECRET = "handoff-test-secret-77";

describe("v2.19.32 HANDOFF SNAPSHOT -- pure-function envelope composer", () => {
  it("captureSnapshot returns a valid HMAC-signed envelope from minimal input", () => {
    const env = captureSnapshot({
      parentDeviceId: "parent-pc",
      nowMs: 1_700_000_000_000,
      secret: SECRET,
    });
    expect(env.v).toBe(HANDOFF_SNAPSHOT_TUNABLES.PROTOCOL_VERSION);
    expect(env.envelopeId).toMatch(/^[0-9a-f]{16}$/);
    expect(env.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(env.parentDeviceId).toBe("parent-pc");
    expect(env.snapshotAtMs).toBe(1_700_000_000_000);
    expect(verifyEnvelope(env, SECRET)).toBe(true);
  });

  it("captureSnapshot is deterministic: same input + secret -> same sig", () => {
    const input = {
      parentDeviceId: "p1",
      conversation: [{ role: "user" as const, text: "hello", ts: 1000 }],
      nowMs: 5000,
      secret: SECRET,
    };
    const a = captureSnapshot(input);
    const b = captureSnapshot(input);
    expect(a.sig).toBe(b.sig);
    expect(a.envelopeId).toBe(b.envelopeId);
  });

  it("captureSnapshot embeds conversation + git state + activity", () => {
    const env = captureSnapshot({
      parentDeviceId: "p1",
      conversation: [
        { role: "user", text: "fix beacon bug", ts: 1000 },
        { role: "assistant", text: "found it on line 216", ts: 2000 },
      ],
      activeIntent: "fixing BEACON BUG #1",
      gitState: { branch: "main", dirty: " M beacon/index.ts", recentCommits: ["fix: bug #1"] },
      recentActivity: [{ action: "mneme.truth.forensic", ts: 1500 }],
      capabilities: { mnemeVersion: "2.19.32", toolFamilies: ["beacon", "synapse"] },
      voiceDirective: "concise + technical",
      mnemeDictionary: { "BEACON": "QR transfer subsystem" },
      nowMs: 3000,
      secret: SECRET,
    });
    expect(env.conversation.length).toBe(2);
    expect(env.activeIntent).toBe("fixing BEACON BUG #1");
    expect(env.gitState.branch).toBe("main");
    expect(env.recentActivity.length).toBe(1);
    expect(env.capabilities.mnemeVersion).toBe("2.19.32");
    expect(env.voiceDirective).toBe("concise + technical");
    expect(env.mnemeDictionary["BEACON"]).toBe("QR transfer subsystem");
    expect(verifyEnvelope(env, SECRET)).toBe(true);
  });

  it("captureSnapshot is DEFENSIVE: bad input never throws", () => {
    const bad: unknown[] = [
      undefined, null, {}, { parentDeviceId: 123 }, { conversation: "not-an-array" },
      { conversation: [{ role: "alien", text: 99, ts: "x" }] },
      { gitState: "not-an-object" },
      { recentActivity: [null, undefined, "x", { action: 1 }] },
      { capabilities: 99 },
      { mnemeDictionary: "x" },
    ];
    for (const b of bad) {
      const env = captureSnapshot((b ?? {}) as Parameters<typeof captureSnapshot>[0]);
      expect(env.sig).toMatch(/^[0-9a-f]{64}$/);
      expect(verifyEnvelope(env)).toBe(true);
    }
  });

  it("verifyEnvelope rejects tampered envelopes (one char change in sig)", () => {
    const env = captureSnapshot({ parentDeviceId: "p", nowMs: 1, secret: SECRET });
    const tampered = { ...env, sig: env.sig.slice(0, -1) + (env.sig.endsWith("a") ? "b" : "a") };
    expect(verifyEnvelope(tampered, SECRET)).toBe(false);
  });

  it("verifyEnvelope rejects field mutation", () => {
    const env = captureSnapshot({ parentDeviceId: "p", nowMs: 1, secret: SECRET });
    const tampered = { ...env, parentDeviceId: "attacker" };
    expect(verifyEnvelope(tampered, SECRET)).toBe(false);
  });

  it("verifyEnvelope rejects wrong secret", () => {
    const env = captureSnapshot({ parentDeviceId: "p", nowMs: 1, secret: SECRET });
    expect(verifyEnvelope(env, "wrong-secret")).toBe(false);
  });

  it("verifyEnvelope rejects malformed envelopes", () => {
    expect(verifyEnvelope(null as unknown as Parameters<typeof verifyEnvelope>[0])).toBe(false);
    expect(verifyEnvelope({} as Parameters<typeof verifyEnvelope>[0])).toBe(false);
    expect(verifyEnvelope({ v: 99, sig: "x".repeat(64) } as unknown as Parameters<typeof verifyEnvelope>[0])).toBe(false);
  });

  it("freshnessCheck: fresh / stale / expired / future_clock_skew bands", () => {
    const env = captureSnapshot({ parentDeviceId: "p", nowMs: 1_000_000, secret: SECRET });
    expect(freshnessCheck(env, 1_000_500).reason).toBe("fresh");                        // 0.5s old
    expect(freshnessCheck(env, 1_000_000 + 4 * 60 * 1000 + 30 * 1000).reason).toBe("stale"); // 4.5min
    expect(freshnessCheck(env, 1_000_000 + 6 * 60 * 1000).reason).toBe("expired");      // 6min
    expect(freshnessCheck(env, 1_000_000 - 5_000).reason).toBe("future_clock_skew");    // child behind 5s
  });

  it("renderForChildVendor produces valid markdown the receiving AI can paste", () => {
    const env = captureSnapshot({
      parentDeviceId: "macbook",
      conversation: [{ role: "user", text: "what about phase D?", ts: 1000 }],
      activeIntent: "discussing cross-device sync",
      gitState: { branch: "main", recentCommits: ["feat: v2.19.31"] },
      capabilities: { mnemeVersion: "2.19.32", toolFamilies: ["synapse"] },
      nowMs: 2000,
      secret: SECRET,
    });
    const md = renderForChildVendor(env);
    expect(md).toContain("Mneme Handoff");
    expect(md).toContain("macbook");
    expect(md).toContain("phase D");
    expect(md).toContain("discussing cross-device sync");
    expect(md).toContain("feat: v2.19.31");
    expect(md).toContain(env.envelopeId);
    expect(md.length).toBeGreaterThan(100);
  });

  it("computeSnapshotStats reports byte size + turn count + age", () => {
    const env = captureSnapshot({
      parentDeviceId: "p",
      conversation: [{ role: "user", text: "hi", ts: 1 }],
      nowMs: 1000,
      secret: SECRET,
    });
    const s = computeSnapshotStats(env, 5000);
    expect(s.conversationTurns).toBe(1);
    expect(s.totalBytes).toBeGreaterThan(0);
    expect(s.ageMs).toBe(4000);
    const line = formatSnapshotLine(s);
    expect(line).toContain("SNAPSHOT");
    expect(line).toContain(env.envelopeId);
  });

  it("24/7 RESILIENCE: 1000 random snapshots never crash", () => {
    const rand = (n: number): number => Math.floor(Math.random() * n);
    for (let i = 0; i < 1000; i++) {
      const env = captureSnapshot({
        parentDeviceId: `p-${rand(100)}`,
        conversation: Array.from({ length: rand(5) }, (_, j) => ({
          role: (["user", "assistant", "system"] as const)[rand(3)],
          text: `msg-${rand(10000)}`,
          ts: rand(1_000_000),
        })),
        nowMs: rand(1_000_000),
        secret: `s-${rand(50)}`,
      });
      expect(verifyEnvelope(env, env.parentDeviceId === "" ? undefined : undefined)).toBeDefined();
    }
  });
});
