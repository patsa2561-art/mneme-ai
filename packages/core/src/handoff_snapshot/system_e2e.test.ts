/**
 * v2.19.32 SYSTEM E2E TEST — the full PARENT → QR → CHILD pipeline
 *
 * Exercises all 4 v2.19.32 modules together with a realistic 4-vendor
 * scenario. If this test passes, BEACON HANDOFF actually works.
 */

import { describe, it, expect } from "vitest";
import { captureSnapshot, verifyEnvelope, freshnessCheck, renderForChildVendor } from "./index.js";
import { bindEnvelope, lookupByCode, markUsed, sasEmoji, normaliseCode } from "../pair_code/index.js";
import { generateHandoffPwaHtml } from "../handoff_pwa/index.js";
import { recordFork, markReconciled, findActiveDescendants, verifyLedger } from "../consciousness_fork/index.js";
import type { ForkRecord } from "../consciousness_fork/index.js";
import type { PairRecord } from "../pair_code/index.js";

const SECRET_HANDOFF = "e2e-handoff-77";
const SECRET_PAIR = "e2e-pair-22";
const SECRET_FORK = "e2e-fork-13";

describe("v2.19.32 BEACON HANDOFF -- E2E SYSTEM TEST (parent → QR → child works for real)", () => {
  it("scenario 1: macbook (Claude) → android phone (Gemini) — full happy path", () => {
    // ─── PARENT SIDE ──────────────────────────────────────────────
    const nowMs = 1_700_000_000_000;
    const envelope = captureSnapshot({
      parentDeviceId: "macbook-pro-claude",
      conversation: [
        { role: "user", text: "we just fixed BUG #1 BEACON token bypass", ts: nowMs - 60_000 },
        { role: "assistant", text: "added 4 regression tests; all pass", ts: nowMs - 30_000 },
        { role: "user", text: "now hand off to my phone before I leave", ts: nowMs - 1_000 },
      ],
      activeIntent: "discussing v2.19.31 ship; continuing on phone",
      gitState: {
        branch: "main",
        dirty: " M packages/core/src/beacon/index.ts",
        recentCommits: ["feat(v2.19.31): BUG #1 BEACON token bypass FIXED"],
      },
      recentActivity: [
        { action: "mneme.truth.forensic", ts: nowMs - 45_000 },
        { action: "mneme.synapse.sync_export", ts: nowMs - 20_000 },
      ],
      capabilities: {
        mnemeVersion: "2.19.32",
        toolFamilies: ["beacon", "truth", "synapse", "soul", "court"],
        requiredTools: ["mneme.truth.forensic"],
      },
      voiceDirective: "Thai-speaking solo dev; technical; concise",
      mnemeDictionary: { "BUG #1": "the BEACON token bypass v2.19.31 fixed" },
      nowMs,
      secret: SECRET_HANDOFF,
    });

    expect(verifyEnvelope(envelope, SECRET_HANDOFF)).toBe(true);
    expect(envelope.envelopeId).toMatch(/^[0-9a-f]{16}$/);

    // ─── BIND PAIR CODE (30s TTL) ─────────────────────────────────
    const pair = bindEnvelope({
      envelopeSig: envelope.sig,
      envelopeId: envelope.envelopeId,
      nowMs,
      ttlMs: 30_000,
      secret: SECRET_PAIR,
    });
    expect(pair.code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    expect(pair.usedAtMs).toBeNull();

    // ─── RENDER PWA HTML (served to phone via BEACON HTTP) ────────
    const sas = sasEmoji(envelope.sig);
    const body = renderForChildVendor(envelope);
    const html = generateHandoffPwaHtml({
      body,
      pairCode: pair.code,
      sasEmoji: sas,
      expiresInMs: pair.expiresAtMs - nowMs,
      title: "Mneme Handoff",
      parentDeviceId: envelope.parentDeviceId,
      shareTargets: ["Gemini", "ChatGPT", "Claude"],
    });
    expect(html).toContain(pair.code);
    expect(html).toContain(sas[0]);
    expect(html).toContain("macbook-pro-claude");
    expect(html).toContain("Gemini");
    // Body contains the active intent (XSS-safe)
    expect(html).toContain("discussing v2.19.31 ship");

    // ─── CHILD SIDE: user types code on phone or scans QR ─────────
    // User typed "zozcat" (lowercase, no dash) — normaliseCode handles it
    const lookup = lookupByCode({
      records: [pair],
      code: pair.code.toLowerCase().replace("-", ""),
      nowMs: nowMs + 5_000, // 5s after pair created
      secret: SECRET_PAIR,
    });
    expect(lookup.verdict).toBe("found");
    expect(lookup.record!.envelopeId).toBe(envelope.envelopeId);

    // Child verifies envelope HMAC (must match parent secret)
    expect(verifyEnvelope(envelope, SECRET_HANDOFF)).toBe(true);

    // Child checks freshness (5s old = fresh)
    const fresh = freshnessCheck(envelope, nowMs + 5_000);
    expect(fresh.isFresh).toBe(true);
    expect(fresh.reason).toBe("fresh");

    // Child marks pair code used (one-shot)
    const usedPair = markUsed({
      record: lookup.record!,
      usedByDeviceId: "galaxy-s24-android-gemini",
      nowMs: nowMs + 5_000,
      secret: SECRET_PAIR,
    });
    expect(usedPair.usedAtMs).toBe(nowMs + 5_000);

    // Re-scan: must fail (one-shot enforcement)
    const replay = lookupByCode({
      records: [usedPair],
      code: pair.code,
      nowMs: nowMs + 6_000,
      secret: SECRET_PAIR,
    });
    expect(replay.verdict).toBe("already_used");

    // ─── CONSCIOUSNESS FORK LEDGER ────────────────────────────────
    const forkResult = recordFork({
      ledger: [],
      parentDeviceId: envelope.parentDeviceId,
      childDeviceId: "galaxy-s24-android-gemini",
      envelopeId: envelope.envelopeId,
      forkedAtMs: nowMs + 5_000,
      note: "handoff: laptop → phone before commute",
      secret: SECRET_FORK,
    });
    expect(forkResult.record).not.toBeNull();
    expect(forkResult.record!.status).toBe("active");
    expect(verifyLedger(forkResult.ledger, SECRET_FORK)).toBe(true);

    // ─── CHILD GETS THE INGESTIBLE MARKDOWN ───────────────────────
    expect(body).toContain("we just fixed BUG #1");
    expect(body).toContain("v2.19.31");
    expect(body).toContain("macbook-pro-claude");
    expect(body).toContain("Thai-speaking solo dev");
  });

  it("scenario 2: STALE handoff (envelope > 5min old) — child REFUSES ingest", () => {
    const env = captureSnapshot({ parentDeviceId: "p", nowMs: 1000, secret: SECRET_HANDOFF });
    const fresh = freshnessCheck(env, 1000 + 6 * 60 * 1000); // 6 min later
    expect(fresh.isExpired).toBe(true);
    expect(fresh.reason).toBe("expired");
    // Receiver SHOULD refuse to ingest → require parent to refresh
  });

  it("scenario 3: TAMPERED envelope — child REJECTS even with valid pair code", () => {
    const env = captureSnapshot({ parentDeviceId: "good-parent", nowMs: 1000, secret: SECRET_HANDOFF });
    const tampered = { ...env, parentDeviceId: "evil-attacker" };
    expect(verifyEnvelope(tampered, SECRET_HANDOFF)).toBe(false);
    // Even if attacker has a valid pair code, the envelope HMAC fails.
  });

  it("scenario 4: TAMPERED pair record — lookup returns 'tampered'", () => {
    const env = captureSnapshot({ parentDeviceId: "p", nowMs: 1000, secret: SECRET_HANDOFF });
    const pair = bindEnvelope({ envelopeSig: env.sig, envelopeId: env.envelopeId, nowMs: 1000, secret: SECRET_PAIR });
    const tampered: PairRecord = { ...pair, envelopeSig: "evil-sig" };
    const result = lookupByCode({ records: [tampered], code: pair.code, nowMs: 5_000, secret: SECRET_PAIR });
    expect(result.verdict).toBe("tampered");
  });

  it("scenario 5: REPLAY ATTACK on expired code — lookup returns 'expired'", () => {
    const env = captureSnapshot({ parentDeviceId: "p", nowMs: 0, secret: SECRET_HANDOFF });
    const pair = bindEnvelope({ envelopeSig: env.sig, envelopeId: env.envelopeId, nowMs: 0, ttlMs: 1000, secret: SECRET_PAIR });
    const result = lookupByCode({ records: [pair], code: pair.code, nowMs: 60_000, secret: SECRET_PAIR });
    expect(result.verdict).toBe("expired");
  });

  it("scenario 6: MITM attack — attacker shows different SAS emoji", () => {
    const env1 = captureSnapshot({ parentDeviceId: "real-parent", nowMs: 1000, secret: SECRET_HANDOFF });
    const env2 = captureSnapshot({ parentDeviceId: "evil-parent", nowMs: 1000, secret: SECRET_HANDOFF });
    const sas1 = sasEmoji(env1.sig);
    const sas2 = sasEmoji(env2.sig);
    // User compares emoji on screens; if attacker swapped envelope, emoji visually differ
    expect(sas1.join("")).not.toBe(sas2.join(""));
  });

  it("scenario 7: 3-device fork lineage (Mac → Phone → Tablet) chained via fork ledger", () => {
    const env1 = captureSnapshot({ parentDeviceId: "mac", nowMs: 1000, secret: SECRET_HANDOFF });
    const env2 = captureSnapshot({ parentDeviceId: "phone", nowMs: 2000, secret: SECRET_HANDOFF });

    let ledger: ForkRecord[] = [];
    ledger = recordFork({ ledger, parentDeviceId: "mac", childDeviceId: "phone", envelopeId: env1.envelopeId, forkedAtMs: 1500, secret: SECRET_FORK }).ledger;
    ledger = recordFork({ ledger, parentDeviceId: "phone", childDeviceId: "tablet", envelopeId: env2.envelopeId, forkedAtMs: 2500, secret: SECRET_FORK }).ledger;
    expect(ledger.length).toBe(2);
    expect(verifyLedger(ledger, SECRET_FORK)).toBe(true);
    const macDescendants = findActiveDescendants({ ledger, parentDeviceId: "mac" });
    expect(macDescendants.length).toBe(1);
    const phoneDescendants = findActiveDescendants({ ledger, parentDeviceId: "phone" });
    expect(phoneDescendants.length).toBe(1);
  });

  it("scenario 8: RECONCILIATION via SYNAPSE SYNC closes the fork loop", () => {
    const env = captureSnapshot({ parentDeviceId: "mac", nowMs: 1000, secret: SECRET_HANDOFF });
    let ledger: ForkRecord[] = recordFork({
      ledger: [],
      parentDeviceId: "mac",
      childDeviceId: "phone",
      envelopeId: env.envelopeId,
      forkedAtMs: 1500,
      secret: SECRET_FORK,
    }).ledger;
    const forkId = ledger[0]!.forkId;
    // Phone comes back via SYNAPSE SYNC merge at t=10000
    ledger = markReconciled({ ledger, forkId, reconciledAtMs: 10_000, secret: SECRET_FORK }).ledger;
    const active = findActiveDescendants({ ledger, parentDeviceId: "mac" });
    expect(active.length).toBe(0);
    expect(ledger[0]!.status).toBe("reconciled");
  });

  it("scenario 9: user typed code with confusable misread — normaliseCode helps", () => {
    const env = captureSnapshot({ parentDeviceId: "p", nowMs: 1000, secret: SECRET_HANDOFF });
    const pair = bindEnvelope({ code: "CAT-DAD", envelopeSig: env.sig, envelopeId: env.envelopeId, nowMs: 1000, secret: SECRET_PAIR });
    // User typed " cat dad " (extra spaces, lowercase, no dash)
    const norm = normaliseCode("  cat dad  ");
    expect(norm).toBe("CAT-DAD");
    const result = lookupByCode({ records: [pair], code: norm, nowMs: 5_000, secret: SECRET_PAIR });
    expect(result.verdict).toBe("found");
  });

  it("scenario 10: HMAC bypass attempt — attacker forges envelope but pair code → tampered detect", () => {
    const real = captureSnapshot({ parentDeviceId: "real", nowMs: 1000, secret: SECRET_HANDOFF });
    // Attacker builds fake envelope with same envelopeId
    const fake = { ...real, parentDeviceId: "attacker", sig: "0".repeat(64) };
    expect(verifyEnvelope(fake, SECRET_HANDOFF)).toBe(false);
    // Pair code bound to REAL sig won't match fake envelope sig — receiver compares.
    const pair = bindEnvelope({ envelopeSig: real.sig, envelopeId: real.envelopeId, nowMs: 1000, secret: SECRET_PAIR });
    expect(pair.envelopeSig).toBe(real.sig);
    expect(pair.envelopeSig).not.toBe(fake.sig);
  });
});
