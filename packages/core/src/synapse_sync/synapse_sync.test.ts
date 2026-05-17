import { describe, it, expect } from "vitest";
import { reinforceSynapse, computeStats, pruneStore } from "../synapse_genesis/index.js";
import type { SynapseStore } from "../synapse_genesis/index.js";
import {
  exportForSync,
  verifySyncExport,
  mergeSynapseStores,
  packForDiaspora,
  unpackFromDiaspora,
  computeSyncStats,
  formatSyncStatsLine,
  type DeviceSynapseExport,
} from "./index.js";

const SECRET = "sync-test-secret-991";
const STORE_SECRET = "mneme-synapse-genesis-v1";

function freshStore(): SynapseStore {
  return { v: 1, weights: [], lastDecayedAtMs: null, sig: "" };
}

/** Helper: simulate a device learning a synapse for tool by event N times. */
function learn(store: SynapseStore, pattern: string, tool: string, n: number, startMs: number): SynapseStore {
  let s = store;
  for (let i = 0; i < n; i++) {
    const out = reinforceSynapse({
      store: s,
      event: { pattern, ts: startMs + i * 1000 },
      toolCall: { toolName: tool, ts: startMs + i * 1000 + 100 },
      satisfaction: "positive",
      nowMs: startMs + i * 1000 + 100,
      secret: STORE_SECRET,
    });
    s = out.store;
  }
  return s;
}

describe("v2.19.31 CROSS-DEVICE SYNAPSE SYNC -- envelope + HMAC", () => {
  it("exportForSync produces a valid HMAC-signed envelope", () => {
    const store = learn(freshStore(), "user_asks_test", "mneme.truth.forensic", 5, 1_700_000_000_000);
    const env = exportForSync({ deviceId: "macbook", store, secret: SECRET });
    expect(env.deviceId).toBe("macbook");
    expect(env.store.weights.length).toBe(1);
    expect(env.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifySyncExport(env, SECRET)).toBe(true);
  });

  it("verifySyncExport rejects tampered envelopes", () => {
    const store = learn(freshStore(), "x", "y.tool", 3, 1_700_000_000_000);
    const env = exportForSync({ deviceId: "phone", store, secret: SECRET });
    const tampered: DeviceSynapseExport = { ...env, deviceId: "evil-device" };
    expect(verifySyncExport(tampered, SECRET)).toBe(false);
  });

  it("verifySyncExport rejects wrong secret", () => {
    const store = learn(freshStore(), "x", "y", 3, 1_700_000_000_000);
    const env = exportForSync({ deviceId: "laptop", store, secret: SECRET });
    expect(verifySyncExport(env, "different-secret")).toBe(false);
  });

  it("verifySyncExport rejects malformed envelopes", () => {
    expect(verifySyncExport(null as unknown as DeviceSynapseExport, SECRET)).toBe(false);
    expect(verifySyncExport({} as DeviceSynapseExport, SECRET)).toBe(false);
    expect(verifySyncExport({ v: 999, deviceId: "x", exportedAtMs: 0, store: freshStore(), sig: "x" } as unknown as DeviceSynapseExport, SECRET)).toBe(false);
  });
});

describe("v2.19.31 CROSS-DEVICE SYNAPSE SYNC -- CRDT merge semantics", () => {
  it("single device export merges to identical store (idempotent N=1)", () => {
    const store = learn(freshStore(), "p", "t.cmd", 3, 1_700_000_000_000);
    const env = exportForSync({ deviceId: "solo", store, secret: SECRET });
    const merged = mergeSynapseStores({ exports: [env], secret: SECRET });
    expect(merged.participatingDevices).toEqual(["solo"]);
    expect(merged.store.weights.length).toBe(1);
    expect(merged.store.weights[0]!.observationCount).toBe(3);
  });

  it("two devices, distinct synapses → union of both", () => {
    const a = learn(freshStore(), "edit_ts", "mneme.ask", 4, 1_700_000_000_000);
    const b = learn(freshStore(), "git_commit", "mneme.guard", 5, 1_700_000_000_000);
    const merged = mergeSynapseStores({
      exports: [
        exportForSync({ deviceId: "macbook", store: a, secret: SECRET }),
        exportForSync({ deviceId: "phone", store: b, secret: SECRET }),
      ],
      secret: SECRET,
    });
    expect(merged.store.weights.length).toBe(2);
    expect(merged.participatingDevices).toEqual(["macbook", "phone"]);
  });

  it("two devices, SAME synapse → cumulative observationCount + max weight", () => {
    const a = learn(freshStore(), "shared", "mneme.shared", 3, 1_700_000_000_000);
    const b = learn(freshStore(), "shared", "mneme.shared", 7, 1_700_000_500_000);
    const merged = mergeSynapseStores({
      exports: [
        exportForSync({ deviceId: "alpha", store: a, secret: SECRET }),
        exportForSync({ deviceId: "beta", store: b, secret: SECRET }),
      ],
      secret: SECRET,
    });
    expect(merged.store.weights.length).toBe(1);
    const w = merged.store.weights[0]!;
    expect(w.observationCount).toBe(10); // 3 + 7 cumulative
    // beta has more reinforcement so its weight > alpha's; winner = beta
    expect(merged.provenance[0]!.winnerDeviceId).toBe("beta");
  });

  it("permanent=true on ANY device → merged permanent (sticky/OR)", () => {
    // alpha crystallises through 12 reinforcements (FIRE_THRESHOLD)
    const alphaStore = learn(freshStore(), "p", "t.boot", 12, 1_700_000_000_000);
    const alphaPerm = alphaStore.weights[0]!.permanent;
    expect(alphaPerm).toBe(true);
    // beta only saw it twice — NOT permanent
    const betaStore = learn(freshStore(), "p", "t.boot", 2, 1_700_000_500_000);
    expect(betaStore.weights[0]!.permanent).toBe(false);

    const merged = mergeSynapseStores({
      exports: [
        exportForSync({ deviceId: "alpha", store: alphaStore, secret: SECRET }),
        exportForSync({ deviceId: "beta", store: betaStore, secret: SECRET }),
      ],
      secret: SECRET,
    });
    expect(merged.store.weights[0]!.permanent).toBe(true);
    expect(merged.provenance[0]!.mergedPermanent).toBe(true);
  });

  it("merge is COMMUTATIVE (A,B,C order vs C,B,A order → identical result)", () => {
    const a = learn(freshStore(), "p", "t", 4, 1_700_000_000_000);
    const b = learn(freshStore(), "p", "t", 6, 1_700_000_500_000);
    const c = learn(freshStore(), "q", "u", 3, 1_700_001_000_000);
    const envs = [
      exportForSync({ deviceId: "a", store: a, secret: SECRET }),
      exportForSync({ deviceId: "b", store: b, secret: SECRET }),
      exportForSync({ deviceId: "c", store: c, secret: SECRET }),
    ];
    const forward = mergeSynapseStores({ exports: envs, secret: SECRET });
    const reverse = mergeSynapseStores({ exports: [...envs].reverse(), secret: SECRET });
    expect(forward.store.sig).toBe(reverse.store.sig);
    // Provenance order is sorted by key — so identical too
    expect(forward.provenance).toEqual(reverse.provenance);
  });

  it("merge is ASSOCIATIVE ((A∪B)∪C ≡ A∪(B∪C))", () => {
    const a = learn(freshStore(), "x", "t", 2, 1_700_000_000_000);
    const b = learn(freshStore(), "x", "t", 4, 1_700_000_500_000);
    const c = learn(freshStore(), "y", "u", 3, 1_700_001_000_000);

    const envA = exportForSync({ deviceId: "a", store: a, secret: SECRET });
    const envB = exportForSync({ deviceId: "b", store: b, secret: SECRET });
    const envC = exportForSync({ deviceId: "c", store: c, secret: SECRET });

    const allAtOnce = mergeSynapseStores({ exports: [envA, envB, envC], secret: SECRET });

    // Pair AB first, then re-export, then merge with C
    const ab = mergeSynapseStores({ exports: [envA, envB], secret: SECRET });
    const abExport = exportForSync({ deviceId: "ab-fused", store: ab.store, secret: SECRET });
    const abThenC = mergeSynapseStores({ exports: [abExport, envC], secret: SECRET });

    // observation counts are identical (associative property)
    const sumObs = (m: ReturnType<typeof mergeSynapseStores>): number =>
      m.store.weights.reduce((acc, w) => acc + w.observationCount, 0);
    expect(sumObs(allAtOnce)).toBe(sumObs(abThenC));
    expect(allAtOnce.store.weights.length).toBe(abThenC.store.weights.length);
  });

  it("merge is IDEMPOTENT (merge(merge(X), X) ≡ merge(X) on observation-count … only X's first contribution is counted)", () => {
    // Note: idempotence in pure-CRDT sense applies when contributing identifier
    // is unchanged. Re-exporting same deviceId+store → last-export-wins (counted once).
    const x = learn(freshStore(), "p", "t", 5, 1_700_000_000_000);
    const env = exportForSync({ deviceId: "solo", store: x, secret: SECRET, nowMs: 1_700_000_000_500 });
    const once = mergeSynapseStores({ exports: [env], secret: SECRET });
    const twice = mergeSynapseStores({ exports: [env, env], secret: SECRET });
    // Same deviceId → de-duped → identical observationCount
    expect(once.store.weights[0]!.observationCount).toBe(twice.store.weights[0]!.observationCount);
  });

  it("duplicate deviceId: last-export-wins by exportedAtMs", () => {
    const stale = learn(freshStore(), "p", "t", 2, 1_700_000_000_000);
    const fresh = learn(freshStore(), "p", "t", 9, 1_700_000_500_000);
    const merged = mergeSynapseStores({
      exports: [
        exportForSync({ deviceId: "same", store: stale, secret: SECRET, nowMs: 1_000 }),
        exportForSync({ deviceId: "same", store: fresh, secret: SECRET, nowMs: 9_999 }),
      ],
      secret: SECRET,
    });
    // Fresh export wins → observationCount = 9
    expect(merged.store.weights[0]!.observationCount).toBe(9);
  });

  it("forged envelope is dropped + listed in rejectedDevices", () => {
    const real = learn(freshStore(), "p", "t", 3, 1_700_000_000_000);
    const goodEnv = exportForSync({ deviceId: "trusted", store: real, secret: SECRET });
    const badEnv: DeviceSynapseExport = { ...goodEnv, deviceId: "hacker", sig: "deadbeef".repeat(8) };
    const merged = mergeSynapseStores({ exports: [goodEnv, badEnv], secret: SECRET });
    expect(merged.participatingDevices).toEqual(["trusted"]);
    expect(merged.rejectedDevices).toEqual(["hacker"]);
  });

  it("empty exports list → empty merged store, never throws", () => {
    const merged = mergeSynapseStores({ exports: [], secret: SECRET });
    expect(merged.store.weights).toEqual([]);
    expect(merged.participatingDevices).toEqual([]);
    expect(merged.rejectedDevices).toEqual([]);
  });

  it("malformed weight entries dropped silently", () => {
    const store = learn(freshStore(), "p", "t", 3, 1_700_000_000_000);
    // Inject malformed entries
    store.weights.push({ key: 123 as unknown as string, eventPattern: "x", toolName: "y", weight: 1, observationCount: 1, lastObservedAtMs: 1, permanentSinceWeight: 0, permanent: false });
    const env = exportForSync({ deviceId: "x", store, secret: SECRET });
    const merged = mergeSynapseStores({ exports: [env], secret: SECRET });
    expect(merged.store.weights.length).toBe(1);
  });

  it("merged store has fresh recomputed HMAC (re-exportable)", () => {
    const a = learn(freshStore(), "p", "t", 3, 1_700_000_000_000);
    const merged = mergeSynapseStores({
      exports: [exportForSync({ deviceId: "x", store: a, secret: SECRET })],
      secret: SECRET,
      storeSecret: STORE_SECRET,
    });
    expect(merged.store.sig).toMatch(/^[0-9a-f]{64}$/);
    // The merged store can be re-exported + re-verified
    const reExport = exportForSync({ deviceId: "fused", store: merged.store, secret: SECRET });
    expect(verifySyncExport(reExport, SECRET)).toBe(true);
  });
});

describe("v2.19.31 CROSS-DEVICE SYNAPSE SYNC -- DIASPORA transport adapter", () => {
  it("packForDiaspora returns canonical path + bytes + branch", () => {
    const env = exportForSync({ deviceId: "macbook-pro-2026", store: freshStore(), secret: SECRET });
    const packed = packForDiaspora(env);
    expect(packed.path).toBe(".mneme/diaspora/synapse-macbook-pro-2026.json");
    expect(packed.branchHint).toBe("diaspora/synapse-macbook-pro-2026");
    expect(typeof packed.bytes).toBe("string");
  });

  it("packForDiaspora sanitises unsafe characters in deviceId", () => {
    const env = exportForSync({ deviceId: "../../../etc/passwd; rm -rf /", store: freshStore(), secret: SECRET });
    const packed = packForDiaspora(env);
    // Path traversal + shell metachars stripped
    expect(packed.path).not.toContain("..");
    expect(packed.path).not.toContain(";");
    expect(packed.path).not.toContain(" ");
    expect(packed.path).not.toContain("/etc/");
  });

  it("unpackFromDiaspora round-trips packForDiaspora", () => {
    const original = exportForSync({ deviceId: "phone", store: learn(freshStore(), "p", "t", 2, 1_700_000_000_000), secret: SECRET });
    const packed = packForDiaspora(original);
    const unpacked = unpackFromDiaspora(packed.bytes);
    expect(unpacked).not.toBeNull();
    expect(unpacked!.deviceId).toBe("phone");
    expect(verifySyncExport(unpacked!, SECRET)).toBe(true);
  });

  it("unpackFromDiaspora returns null on garbage", () => {
    expect(unpackFromDiaspora("not-json")).toBeNull();
    expect(unpackFromDiaspora("{}")).toBeNull();
    expect(unpackFromDiaspora('{"v":999}')).toBeNull();
  });
});

describe("v2.19.31 CROSS-DEVICE SYNAPSE SYNC -- system test (mobile + laptop + desktop)", () => {
  // Exactly the scenario the user mandated:
  //   "ทำให้ใช้ได้ ผมถึงบอกว่าคุณต้องเทสเยอะๆ ว่ามัน sync brain ได้จริงๆ
  //    ข้าม mobile + computer + notebook"
  it("3-device unified brain: mobile + laptop + desktop all observe + merge", () => {
    // Mobile: user fires `mneme.ask` while reading on the train (5 times)
    const mobile = learn(freshStore(), "user_asks_question", "mneme.ask", 5, 1_700_000_000_000);
    // Laptop: user runs `mneme.truth.forensic` heavily during deep work (15 times → crystallises)
    const laptop = learn(freshStore(), "user_writes_code", "mneme.truth.forensic", 15, 1_700_001_000_000);
    // Desktop: user fires `mneme.guard` on every commit (8 times)
    const desktop = learn(freshStore(), "git_commit", "mneme.guard", 8, 1_700_002_000_000);

    const exports = [
      exportForSync({ deviceId: "mobile-iphone-15", store: mobile, secret: SECRET, nowMs: 1_700_003_000_000 }),
      exportForSync({ deviceId: "laptop-macbook-pro", store: laptop, secret: SECRET, nowMs: 1_700_003_000_000 }),
      exportForSync({ deviceId: "desktop-ryzen", store: desktop, secret: SECRET, nowMs: 1_700_003_000_000 }),
    ];

    const merged = mergeSynapseStores({ exports, secret: SECRET });

    // All 3 devices participated, no rejects
    expect(merged.participatingDevices.length).toBe(3);
    expect(merged.rejectedDevices.length).toBe(0);

    // 3 distinct synapses (no overlap between device synapses)
    expect(merged.store.weights.length).toBe(3);

    // The laptop's mneme.truth.forensic should be permanent (15 reinforcements > threshold)
    const forensicWeight = merged.store.weights.find((w) => w.toolName === "mneme.truth.forensic");
    expect(forensicWeight).toBeDefined();
    expect(forensicWeight!.permanent).toBe(true);

    // Total observation count = 5 + 15 + 8 = 28 (cumulative evidence)
    const totalObs = merged.store.weights.reduce((acc, w) => acc + w.observationCount, 0);
    expect(totalObs).toBe(28);

    // Stats line
    const stats = computeSyncStats(merged);
    expect(stats.participatingDevices).toBe(3);
    expect(stats.totalSynapses).toBe(3);
    expect(stats.permanentSynapses).toBeGreaterThanOrEqual(1);
    expect(stats.unifiedObservations).toBe(28);
  });

  it("3-device with OVERLAP: same synapse on multiple devices → unified", () => {
    // All 3 devices learn `git_commit → mneme.guard` independently
    const mobile = learn(freshStore(), "git_commit", "mneme.guard", 3, 1_700_000_000_000);
    const laptop = learn(freshStore(), "git_commit", "mneme.guard", 6, 1_700_001_000_000);
    const desktop = learn(freshStore(), "git_commit", "mneme.guard", 4, 1_700_002_000_000);

    const merged = mergeSynapseStores({
      exports: [
        exportForSync({ deviceId: "mobile", store: mobile, secret: SECRET }),
        exportForSync({ deviceId: "laptop", store: laptop, secret: SECRET }),
        exportForSync({ deviceId: "desktop", store: desktop, secret: SECRET }),
      ],
      secret: SECRET,
    });

    // 1 synapse, but observations from all 3 devices add up
    expect(merged.store.weights.length).toBe(1);
    expect(merged.store.weights[0]!.observationCount).toBe(13); // 3+6+4
    // Provenance shows 3 contributors
    expect(merged.provenance[0]!.contributors.length).toBe(3);
    // Winner is laptop (most reinforcement → highest weight)
    expect(merged.provenance[0]!.winnerDeviceId).toBe("laptop");
    // multi-device count = 1
    expect(computeSyncStats(merged).multiDeviceSynapses).toBe(1);
  });

  it("system test: full round-trip via DIASPORA-shaped transport", () => {
    // Simulate the full pipeline: device A exports → "git push" → device B fetches → merge
    const deviceA = learn(freshStore(), "p", "mneme.x", 4, 1_700_000_000_000);
    const deviceB = learn(freshStore(), "q", "mneme.y", 5, 1_700_000_500_000);

    // Device A packages + "transports" via diaspora-shaped envelope
    const envA = exportForSync({ deviceId: "A", store: deviceA, secret: SECRET });
    const packedA = packForDiaspora(envA);

    // Wire crosses → device B receives bytes (e.g. via git pull / HTTP / QR scan)
    const arrivedA = unpackFromDiaspora(packedA.bytes);
    expect(arrivedA).not.toBeNull();

    // Device B merges its own store + the arrived envelope
    const envB = exportForSync({ deviceId: "B", store: deviceB, secret: SECRET });
    const unified = mergeSynapseStores({ exports: [arrivedA!, envB], secret: SECRET });

    expect(unified.store.weights.length).toBe(2);
    expect(unified.participatingDevices).toEqual(["A", "B"]);
  });

  it("system test: ban-recovery + cross-device combo", () => {
    // Vendor A on laptop gets banned → uses SOUL EMBALMING (separate module) to capture state
    // Vendor B on phone resumes via cross-device sync
    const laptopBeforeBan = learn(freshStore(), "user_codes", "mneme.truth.forensic", 14, 1_700_000_000_000);

    // Export the synapse state through Phase D
    const env = exportForSync({ deviceId: "laptop-pre-ban", store: laptopBeforeBan, secret: SECRET });

    // Phone receives + merges (vendor switched, brain preserved)
    const merged = mergeSynapseStores({ exports: [env], secret: SECRET });
    expect(merged.store.weights.length).toBe(1);
    expect(merged.store.weights[0]!.permanent).toBe(true);
    expect(merged.store.weights[0]!.toolName).toBe("mneme.truth.forensic");

    // Phone continues with the embalmed synapse — re-reinforcing 2 more times
    const phoneAfterMerge = reinforceSynapse({
      store: merged.store,
      event: { pattern: "user_codes", ts: 1_700_010_000_000 },
      toolCall: { toolName: "mneme.truth.forensic", ts: 1_700_010_000_100 },
      satisfaction: "positive",
      nowMs: 1_700_010_000_100,
      secret: STORE_SECRET,
    });
    expect(phoneAfterMerge.store.weights[0]!.observationCount).toBeGreaterThan(14);
    expect(phoneAfterMerge.store.weights[0]!.permanent).toBe(true); // still permanent
  });

  it("system test: stats line is human-readable + counts correct", () => {
    const a = learn(freshStore(), "p", "t1", 3, 1_700_000_000_000);
    const b = learn(freshStore(), "p", "t1", 4, 1_700_000_500_000);
    const c = learn(freshStore(), "q", "t2", 12, 1_700_001_000_000); // permanent
    const merged = mergeSynapseStores({
      exports: [
        exportForSync({ deviceId: "A", store: a, secret: SECRET }),
        exportForSync({ deviceId: "B", store: b, secret: SECRET }),
        exportForSync({ deviceId: "C", store: c, secret: SECRET }),
      ],
      secret: SECRET,
    });
    const stats = computeSyncStats(merged);
    const line = formatSyncStatsLine(stats);
    expect(line).toContain("SYNC");
    expect(line).toContain("3dev");
    expect(line).toContain("multi-dev");
    expect(line).toContain("perm");
  });

  it("system test: composes onto computeStats from synapse_genesis", () => {
    const a = learn(freshStore(), "p", "t", 3, 1_700_000_000_000);
    const b = learn(freshStore(), "p", "t", 4, 1_700_000_500_000);
    const merged = mergeSynapseStores({
      exports: [
        exportForSync({ deviceId: "A", store: a, secret: SECRET }),
        exportForSync({ deviceId: "B", store: b, secret: SECRET }),
      ],
      secret: SECRET,
    });
    // Downstream synapse_genesis tools work on the merged store
    const stats = computeStats(merged.store);
    expect(stats.totalSynapses).toBe(1);
    // prune also works
    const pruned = pruneStore({ store: merged.store, secret: STORE_SECRET });
    expect(pruned.store.weights.length).toBeGreaterThanOrEqual(1);
  });
});
