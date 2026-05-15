import { describe, it, expect } from "vitest";
import { NexusProactive, formatNexusLine } from "./index.js";

describe("v2.18 · MNEME NEXUS PROACTIVE — Reverse-MCP push notifier", () => {
  it("subscription registers with sig + monotonic id", () => {
    const n = new NexusProactive();
    const s = n.registerSubscription({
      subscriber: "claude-1",
      kind: "symbol_location",
      factKey: "calculateTotal",
      knownValue: "src/foo.ts:42",
    });
    expect(s.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(s.subId).toMatch(/^sub-[0-9a-f]{14}$/);
    expect(s.subscriber).toBe("claude-1");
  });

  it("publishes a stale_claim notification when fact changes", () => {
    const n = new NexusProactive();
    n.registerSubscription({
      subscriber: "claude-1",
      kind: "symbol_location",
      factKey: "calculateTotal",
      knownValue: "src/foo.ts:42",
    });
    const emitted = n.publishObservation({
      kind: "symbol_location",
      factKey: "calculateTotal",
      value: "src/foo.ts:80",
    });
    expect(emitted.length).toBe(1);
    expect(emitted[0]!.kind).toBe("stale_claim");
    expect(emitted[0]!.oldValue).toBe("src/foo.ts:42");
    expect(emitted[0]!.newValue).toBe("src/foo.ts:80");
    expect(emitted[0]!.severity).toBe(4); // symbol_location is MUST ACK
    expect(emitted[0]!.message).toContain("MUST ACK");
  });

  it("does NOT emit when value unchanged", () => {
    const n = new NexusProactive();
    n.registerSubscription({
      subscriber: "x", kind: "file_content", factKey: "src/a.ts", knownValue: "abc",
    });
    const emitted = n.publishObservation({ kind: "file_content", factKey: "src/a.ts", value: "abc" });
    expect(emitted.length).toBe(0);
  });

  it("does NOT cross subscribers — per-subscriber isolation", () => {
    const n = new NexusProactive();
    n.registerSubscription({ subscriber: "claude", kind: "file_content", factKey: "src/a.ts", knownValue: "v1" });
    n.registerSubscription({ subscriber: "gpt",    kind: "file_content", factKey: "src/b.ts", knownValue: "v1" });
    const emitted = n.publishObservation({ kind: "file_content", factKey: "src/a.ts", value: "v2" });
    expect(emitted.length).toBe(1);
    expect(emitted[0]!.subscriber).toBe("claude");
    const claudeQ = n.drainNotifications("claude");
    expect(claudeQ.length).toBe(1);
    const gptQ = n.drainNotifications("gpt");
    expect(gptQ.length).toBe(0);
  });

  it("seq is monotonic per subscriber", () => {
    const n = new NexusProactive();
    n.registerSubscription({ subscriber: "x", kind: "file_content", factKey: "a", knownValue: "v1" });
    n.publishObservation({ kind: "file_content", factKey: "a", value: "v2" });
    n.publishObservation({ kind: "file_content", factKey: "a", value: "v3" });
    n.publishObservation({ kind: "file_content", factKey: "a", value: "v4" });
    const drained = n.drainNotifications("x");
    expect(drained.length).toBe(3);
    expect(drained[0]!.seq).toBe(1);
    expect(drained[1]!.seq).toBe(2);
    expect(drained[2]!.seq).toBe(3);
  });

  it("drain clears the queue", () => {
    const n = new NexusProactive();
    n.registerSubscription({ subscriber: "x", kind: "file_content", factKey: "a", knownValue: "v1" });
    n.publishObservation({ kind: "file_content", factKey: "a", value: "v2" });
    expect(n.drainNotifications("x").length).toBe(1);
    expect(n.drainNotifications("x").length).toBe(0);
  });

  it("expired subscription emits subscription_expired on drain", () => {
    const n = new NexusProactive();
    const t0 = 1_000_000_000_000;
    n.registerSubscription({ subscriber: "x", kind: "file_content", factKey: "a", knownValue: "v1", ttlSeconds: 60, nowMs: t0 });
    const drained = n.drainNotifications("x", t0 + 120_000); // 2 minutes later
    expect(drained.length).toBe(1);
    expect(drained[0]!.kind).toBe("subscription_expired");
  });

  it("acknowledge records signed receipt + isAcked true", () => {
    const n = new NexusProactive();
    n.registerSubscription({ subscriber: "x", kind: "file_content", factKey: "a", knownValue: "v1" });
    const emitted = n.publishObservation({ kind: "file_content", factKey: "a", value: "v2" });
    const notif = emitted[0]!;
    const ack = n.acknowledge({ notifId: notif.notifId, subscriber: "x", restatement: "got it, v2 now" });
    expect(ack.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(ack.restatement).toBe("got it, v2 now");
    expect(n.isAcked(notif.notifId)).toBe(true);
    expect(n.verifyAck(ack)).toBe(true);
  });

  it("verifyNotification rejects tampered notifications", () => {
    const n = new NexusProactive();
    n.registerSubscription({ subscriber: "x", kind: "file_content", factKey: "a", knownValue: "v1" });
    const [notif] = n.publishObservation({ kind: "file_content", factKey: "a", value: "v2" });
    expect(n.verifyNotification(notif!)).toBe(true);
    const tampered = { ...notif!, newValue: "EVIL" };
    expect(n.verifyNotification(tampered)).toBe(false);
  });

  it("vendor_score severity escalates with delta", () => {
    const n = new NexusProactive();
    n.registerSubscription({ subscriber: "x", kind: "vendor_score", factKey: "claude", knownValue: "0.50" });
    n.publishObservation({ kind: "vendor_score", factKey: "claude", value: "0.51" }); // tiny
    const small = n.drainNotifications("x");
    expect(small[0]!.severity).toBeLessThanOrEqual(2);

    n.registerSubscription({ subscriber: "y", kind: "vendor_score", factKey: "claude", knownValue: "0.50" });
    n.publishObservation({ kind: "vendor_score", factKey: "claude", value: "0.10" }); // huge swing
    const big = n.drainNotifications("y");
    expect(big[0]!.severity).toBe(4);
  });

  it("soul_rule changes are severity 5 (MUST ACK)", () => {
    const n = new NexusProactive();
    n.registerSubscription({ subscriber: "x", kind: "soul_rule", factKey: "no-friday-deploys", knownValue: "active" });
    const [notif] = n.publishObservation({ kind: "soul_rule", factKey: "no-friday-deploys", value: "removed" });
    expect(notif!.severity).toBe(5);
  });

  it("stats reports active subs + pending notifs + acks", () => {
    const n = new NexusProactive();
    n.registerSubscription({ subscriber: "x", kind: "file_content", factKey: "a", knownValue: "v1" });
    n.publishObservation({ kind: "file_content", factKey: "a", value: "v2" });
    const s = n.stats("x");
    expect(s.activeSubs).toBe(1);
    expect(s.pendingNotifs).toBe(1);
    expect(s.totalAcks).toBe(0);
  });

  it("formatNexusLine summarises", () => {
    const n = new NexusProactive();
    n.registerSubscription({ subscriber: "x", kind: "file_content", factKey: "a", knownValue: "v1" });
    const [notif] = n.publishObservation({ kind: "file_content", factKey: "a", value: "v2" });
    expect(formatNexusLine(notif!)).toContain("NEXUS");
  });
});
