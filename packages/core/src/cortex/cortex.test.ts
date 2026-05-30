import { describe, it, expect } from "vitest";
import { emptyStore, contribute, recall, verifyEntry, handoff, activeView, cortexGauntlet, reconcile, reconcileGauntlet } from "./index.js";

const R = process.cwd();

describe("v2.104 THE COGNITIVE CORTEX — Sovereign Memory Bus", () => {
  it("contribute → recall round-trips (any agent can read what another wrote)", () => {
    let s = emptyStore();
    s = contribute(R, s, { agent: "claude", key: "build.cmd", value: "npm run build", kind: "fact" }, 1).store;
    const hits = recall(s, "build command");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.entry.value).toBe("npm run build");
  });

  it("identical fact from a different agent is a DUPLICATE (agents agree)", () => {
    let s = emptyStore();
    s = contribute(R, s, { agent: "claude", key: "k", value: "v" }, 1).store;
    const r = contribute(R, s, { agent: "gpt", key: "k", value: "v" }, 2);
    expect(r.result.verdict).toBe("DUPLICATE");
  });

  it("THE GATEKEEPER — a conflicting value is QUARANTINED, not silently overwritten", () => {
    let s = emptyStore();
    s = contribute(R, s, { agent: "claude", key: "db.url", value: "postgres://prod" }, 1).store;
    const conf = contribute(R, s, { agent: "grok", key: "db.url", value: "postgres://EVIL" }, 2);
    expect(conf.result.verdict).toBe("QUARANTINED");
    expect(conf.result.conflictsWith).toBeTruthy();
    // established memory is unchanged — the mesh was not poisoned
    expect(activeView(conf.store).get("db.url")?.value).toBe("postgres://prod");
  });

  it("a DECLARED update supersedes (opts.update) — drift only by consent", () => {
    let s = emptyStore();
    s = contribute(R, s, { agent: "claude", key: "db.url", value: "v1" }, 1).store;
    const upd = contribute(R, s, { agent: "claude", key: "db.url", value: "v2" }, 2, { update: true });
    expect(upd.result.verdict).toBe("UPDATED");
    expect(activeView(upd.store).get("db.url")?.value).toBe("v2");
  });

  it("every entry is Ed25519-signed + offline-verifiable; tampering ANY signed field is caught", () => {
    let s = emptyStore();
    s = contribute(R, s, { agent: "claude", key: "k", value: "v", kind: "fact" }, 1).store;
    const e = activeView(s).get("k")!;
    expect(verifyEntry(e).bound).toBe(true);
    // every signed field must be bound (regression: v2.104 review found kind+at unbound)
    for (const mut of [
      (x: Record<string, unknown>) => { x.value = "HACKED"; },
      (x: Record<string, unknown>) => { x.agent = "evil"; },
      (x: Record<string, unknown>) => { x.key = "other"; },
      (x: Record<string, unknown>) => { x.kind = "warning"; },
      (x: Record<string, unknown>) => { x.at = 999999; },
      (x: Record<string, unknown>) => { x.supersedes = "fake"; },
    ]) {
      const t = JSON.parse(JSON.stringify(e)); mut(t);
      expect(verifyEntry(t).bound).toBe(false);
    }
  });

  it("TOTAL — issueReceipt-backed functions never throw on a null repoRoot (v2.104 review)", () => {
    expect(() => handoff(null as never, emptyStore(), "x", 1)).not.toThrow();
    expect(() => contribute(null as never, emptyStore(), { agent: "a", key: "k", value: "v" }, 1)).not.toThrow();
  });

  it("handoff builds a SIGNED context capsule of the live shared memory", () => {
    let s = emptyStore();
    s = contribute(R, s, { agent: "claude", key: "a", value: "1" }, 1).store;
    s = contribute(R, s, { agent: "gpt", key: "b", value: "2" }, 2).store;
    const cap = handoff(R, s, "gemini", 3);
    expect(cap.facts.length).toBe(2);
    expect(cap.toAgent).toBe("gemini");
    expect(typeof cap.receipt.sig).toBe("string");
  });

  it("cortex gauntlet scores 100 (round-trip ∧ quarantine ∧ signed ∧ tamper ∧ deterministic ∧ stable)", () => {
    const g = cortexGauntlet(R, 1700000000000);
    expect(g.roundTrip).toBe(true);
    expect(g.quarantinesConflict).toBe(true);
    expect(g.signed).toBe(true);
    expect(g.tamperCaught).toBe(true);
    expect(g.deterministic).toBe(true);
    expect(g.stable).toBe(true);
    expect(g.score).toBe(100);
  });

  it("RECONCILIATION (the magical power) — resolves a verifiably-false conflict BY PROOF", async () => {
    const r = await reconcile(R, { agent: "claude", value: "2+2=4" }, { agent: "grok", value: "2+2=5" }, 1700000000000);
    expect(r.resolution).toBe("proof");
    expect(r.winner?.value).toBe("2+2=4");
    expect(r.loser?.value).toBe("2+2=5");
  });

  it("RECONCILIATION — two unprovable opinions stay UNRESOLVED (no auto-decide; Padgett)", async () => {
    const r = await reconcile(R, { agent: "claude", value: "fly.io is the target" }, { agent: "grok", value: "vercel is the target" }, 1700000000000);
    expect(r.resolution).toBe("unresolved");
    expect(r.winner).toBeNull();
  });

  it("reconcile gauntlet scores 100 (proof-resolves ∧ opinion-unresolved ∧ signed ∧ stable)", async () => {
    const g = await reconcileGauntlet(R, 1700000000000);
    expect(g.proofResolves).toBe(true);
    expect(g.opinionUnresolved).toBe(true);
    expect(g.signed).toBe(true);
    expect(g.score).toBe(100);
  });

  it("STABILITY — total on garbage", () => {
    expect(() => contribute(R, null as never, null as never, 0)).not.toThrow();
    expect(contribute(R, null as never, null as never, 0).result.verdict).toBe("QUARANTINED");
    expect(recall(null as never, null as never)).toEqual([]);
    expect(verifyEntry(null as never).bound).toBe(false);
    expect(cortexGauntlet(R, 0).score).toBe(100);   // gauntlet builds its own data
  });
});
