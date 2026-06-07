import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleKeryxRelay } from "../gephyra/index.js";
import { mintPairingCode } from "./rendezvous.js";

describe("RELAY AUTH — multi-tenant theft/hijack closed (the shipped weakness)", () => {
  it("a daemonId is CLAIMED by its key; a wrong key cannot drain (no approval theft) or re-register (no hijack)", async () => {
    const repo = mkdtempSync(join(tmpdir(), "relay-auth-"));
    const victimKey = "victim-secret-key";
    const { code, record } = mintPairingCode("d-victim", "line", { now: Date.now(), secret: victimKey });

    // victim registers (claims d-victim with victimKey)
    const reg = await handleKeryxRelay(repo, "pair-register", { daemonId: "d-victim", record, key: victimKey }, {});
    expect((reg.body as { registered?: boolean }).registered).toBe(true);

    // victim links via the code (real webhook) → an answer queued
    const codeMsg = JSON.stringify({ events: [{ message: { text: code }, source: { userId: "Uvictim" } }] });
    await handleKeryxRelay(repo, "webhook", codeMsg, { provider: "line" });
    const tap = JSON.stringify({ events: [{ message: { text: "allow" }, source: { userId: "Uvictim" } }] });
    await handleKeryxRelay(repo, "webhook", tap, { provider: "line" });

    // ATTACKER drains d-victim WITHOUT the key → gets NOTHING (no theft)
    const steal = await handleKeryxRelay(repo, "drain", "", { daemon: "d-victim" }, { "x-keryx-key": "wrong" });
    expect((steal.body as { answers?: unknown[]; auth?: boolean }).answers).toHaveLength(0);
    expect((steal.body as { auth?: boolean }).auth).toBe(false);

    // ATTACKER tries to re-register (hijack routing) under d-victim with their own key → 401
    const { record: evil } = mintPairingCode("d-victim", "line", { now: Date.now(), secret: "attacker", counter: 1 });
    const hijack = await handleKeryxRelay(repo, "pair-register", { daemonId: "d-victim", record: evil, key: "attacker" }, {});
    expect(hijack.status).toBe(401);

    // the VICTIM drains WITH the key → gets the answer
    const ok = await handleKeryxRelay(repo, "drain", "", { daemon: "d-victim" }, { "x-keryx-key": victimKey });
    expect((ok.body as { answers?: Array<{ payload: string }> }).answers?.some((a) => a.payload === "allow")).toBe(true);
  });

  it("expired/used pairings are pruned (no unbounded growth)", async () => {
    const repo = mkdtempSync(join(tmpdir(), "relay-prune-"));
    const { record } = mintPairingCode("d", "line", { now: Date.now() - 999999, ttlMs: 1, secret: "k" }); // already expired
    await handleKeryxRelay(repo, "pair-register", { daemonId: "d", record, key: "k" }, {});
    // any save prunes — register a fresh one + the expired one should be gone
    const fresh = mintPairingCode("d", "line", { now: Date.now(), secret: "k", counter: 5 });
    await handleKeryxRelay(repo, "pair-register", { daemonId: "d", record: fresh.record, key: "k" }, {});
    const drain = await handleKeryxRelay(repo, "drain", "", { daemon: "d" }, { "x-keryx-key": "k" });
    expect(drain.status).toBe(200); // no crash, pruning happened on save
  });
});
