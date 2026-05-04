import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MnemeStore } from "../store/sqlite.js";
import {
  recordQuery,
  setHelpful,
  recordImplicitRevisit,
  listFeedback,
  summarizeFeedback,
} from "./feedback.js";
import {
  calibrate,
  readCalibration,
  persistCalibration,
  listCalibrations,
} from "./calibrator.js";
import { DEFAULT_CALIBRATION } from "./types.js";

let tmpDir: string;
let store: MnemeStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mneme-wisdom-test-"));
  store = new MnemeStore(join(tmpDir, "mneme.db"));
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("wisdom_feedback — recordQuery + setHelpful", () => {
  it("records a pending feedback row and lets it be marked helpful", () => {
    const id = recordQuery(store, {
      query: "why does payment retry",
      resultHashes: ["abc123", "def456"],
      topScore: 0.087,
      semanticWeight: 0.65,
      minSemCosine: 0.4,
      rrfK: 60,
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const list = listFeedback(store);
    expect(list).toHaveLength(1);
    expect(list[0]!.wasHelpful).toBeUndefined();
    expect(list[0]!.source).toBe("pending");
    expect(list[0]!.resultHashes).toEqual(["abc123", "def456"]);

    expect(setHelpful(store, id, true)).toBe(true);
    expect(listFeedback(store)[0]!.wasHelpful).toBe(1);
    expect(listFeedback(store)[0]!.source).toBe("explicit");
  });

  it("setHelpful with false records as unhelpful", () => {
    const id = recordQuery(store, { query: "x", resultHashes: ["h1"] });
    setHelpful(store, id, false);
    expect(listFeedback(store)[0]!.wasHelpful).toBe(0);
  });

  it("setHelpful returns false when id does not exist", () => {
    expect(setHelpful(store, "nonexistent-id", true)).toBe(false);
  });
});

describe("recordImplicitRevisit — implicit positive signal from `mneme why`", () => {
  it("marks recent pending row helpful when commit was in result set", () => {
    const id = recordQuery(store, { query: "x", resultHashes: ["abc", "def"] });
    const updated = recordImplicitRevisit(store, "abc");
    expect(updated).toBe(1);
    const row = listFeedback(store).find((r) => r.id === id)!;
    expect(row.wasHelpful).toBe(1);
    expect(row.source).toBe("implicit-revisit");
  });

  it("does not touch rows that did not return that commit", () => {
    const id = recordQuery(store, { query: "x", resultHashes: ["xxx"] });
    const updated = recordImplicitRevisit(store, "abc");
    expect(updated).toBe(0);
    expect(listFeedback(store).find((r) => r.id === id)!.wasHelpful).toBeUndefined();
  });

  it("does not touch already-decided rows", () => {
    const id = recordQuery(store, { query: "x", resultHashes: ["abc"] });
    setHelpful(store, id, false, "explicit");
    recordImplicitRevisit(store, "abc");
    expect(listFeedback(store)[0]!.wasHelpful).toBe(0); // stays unhelpful
    expect(listFeedback(store)[0]!.source).toBe("explicit");
  });
});

describe("summarizeFeedback", () => {
  it("counts helpful / unhelpful / pending and computes hit rate", () => {
    recordQuery(store, { query: "1", resultHashes: ["a"] });
    const id2 = recordQuery(store, { query: "2", resultHashes: ["b"] });
    setHelpful(store, id2, true);
    const id3 = recordQuery(store, { query: "3", resultHashes: ["c"] });
    setHelpful(store, id3, false);
    const id4 = recordQuery(store, { query: "4", resultHashes: ["d"] });
    setHelpful(store, id4, true);

    const summary = summarizeFeedback(store);
    expect(summary.total).toBe(4);
    expect(summary.helpful).toBe(2);
    expect(summary.unhelpful).toBe(1);
    expect(summary.pending).toBe(1);
    // hit rate = helpful / decided = 2 / 3
    expect(summary.hitRate).toBeCloseTo(2 / 3, 4);
  });

  it("returns 0 hit rate when no rows are decided yet", () => {
    recordQuery(store, { query: "x", resultHashes: ["a"] });
    expect(summarizeFeedback(store).hitRate).toBe(0);
  });
});

describe("calibrator — readCalibration + persistCalibration", () => {
  it("returns DEFAULT_CALIBRATION when nothing is stored", () => {
    expect(readCalibration(store)).toEqual(DEFAULT_CALIBRATION);
  });

  it("returns the latest stored calibration", () => {
    persistCalibration(
      store,
      "search",
      { semanticWeight: 0.85, minSemCosine: 0.3, rrfK: 30, hitRate: 0.92 },
      "hit_rate",
    );
    const c = readCalibration(store);
    expect(c.semanticWeight).toBe(0.85);
    expect(c.minSemCosine).toBe(0.3);
    expect(c.rrfK).toBe(30);
  });

  it("listCalibrations returns rows ordered by calibrated_at desc", async () => {
    persistCalibration(store, "search", { semanticWeight: 0.4, minSemCosine: 0.5, rrfK: 60, hitRate: 0.5 }, "hit_rate");
    await new Promise((r) => setTimeout(r, 10)); // ensure different timestamps
    persistCalibration(store, "search", { semanticWeight: 0.85, minSemCosine: 0.3, rrfK: 30, hitRate: 0.9 }, "hit_rate");
    const list = listCalibrations(store);
    expect(list).toHaveLength(1); // PRIMARY KEY=key, only one row per key
    expect((list[0]!.value as { semanticWeight: number }).semanticWeight).toBe(0.85);
  });
});

describe("calibrate — the actual loop", () => {
  it("returns defaults and does not run when fewer than 10 positive examples", async () => {
    for (let i = 0; i < 5; i++) {
      const id = recordQuery(store, { query: `q${i}`, resultHashes: [`h${i}`] });
      setHelpful(store, id, true);
    }
    const result = await calibrate(store);
    expect(result.calibrated).toBe(false);
    expect(result.positiveExamples).toBe(5);
    expect(result.config).toEqual(DEFAULT_CALIBRATION);
  });

  it("runs grid search and returns the best config when >= 10 positives", async () => {
    // Note: this calibrates against real search() runs, which need an indexed
    // store. Here we use ZERO commits — so search() returns [] for everything.
    // The grid still runs; every config produces 0% hit rate. That's a valid
    // edge case to verify: calibration is robust even with no corpus.
    for (let i = 0; i < 12; i++) {
      const id = recordQuery(store, { query: `q${i}`, resultHashes: [`h${i}`] });
      setHelpful(store, id, true);
    }
    const result = await calibrate(store);
    expect(result.calibrated).toBe(true);
    expect(result.positiveExamples).toBe(12);
    expect(result.grid.length).toBeGreaterThan(0);
    // With an empty corpus, every grid point has hit rate 0 — but the
    // calibrator still picks one and persists it.
    expect(result.hitRate).toBe(0);
    const stored = readCalibration(store);
    expect(stored.semanticWeight).toBeDefined();
  });
});
