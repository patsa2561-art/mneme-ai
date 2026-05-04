import { describe, it, expect } from "vitest";
import {
  MEDITATIONS,
  meditationOfTheDay,
  meditationByIndex,
  meditationById,
} from "./meditations.js";

describe("MEDITATIONS canon", () => {
  it("has at least 10 meditations", () => {
    expect(MEDITATIONS.length).toBeGreaterThanOrEqual(10);
  });

  it("every meditation has id, title, body, aphorism", () => {
    for (const m of MEDITATIONS) {
      expect(m.id).toBeTruthy();
      expect(m.title).toBeTruthy();
      expect(m.body.length).toBeGreaterThan(20);
      expect(m.aphorism).toBeTruthy();
    }
  });

  it("ids are unique", () => {
    const ids = MEDITATIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("aphorisms are all under 140 chars (tweetable)", () => {
    for (const m of MEDITATIONS) {
      expect(m.aphorism.length).toBeLessThanOrEqual(140);
    }
  });
});

describe("meditationOfTheDay", () => {
  it("returns a meditation", () => {
    const m = meditationOfTheDay();
    expect(m).toBeDefined();
    expect(m.title).toBeTruthy();
  });

  it("is deterministic — same day → same meditation", () => {
    const d = new Date("2026-05-04T10:00:00Z");
    expect(meditationOfTheDay(d).id).toBe(meditationOfTheDay(d).id);
  });

  it("changes day-to-day", () => {
    // Find at least two consecutive days that produce different meditations.
    const day1 = new Date("2026-05-04T00:00:00Z");
    const seen = new Set<string>();
    for (let i = 0; i < MEDITATIONS.length + 1; i++) {
      const d = new Date(day1.getTime() + i * 24 * 60 * 60 * 1000);
      seen.add(meditationOfTheDay(d).id);
    }
    expect(seen.size).toBe(MEDITATIONS.length);
  });

  it("is timezone-stable for the same UTC day", () => {
    const morning = new Date("2026-05-04T01:00:00Z");
    const evening = new Date("2026-05-04T23:00:00Z");
    expect(meditationOfTheDay(morning).id).toBe(meditationOfTheDay(evening).id);
  });
});

describe("meditationByIndex", () => {
  it("returns 1-indexed entries", () => {
    expect(meditationByIndex(1)?.id).toBe(MEDITATIONS[0]!.id);
    expect(meditationByIndex(MEDITATIONS.length)?.id).toBe(
      MEDITATIONS[MEDITATIONS.length - 1]!.id,
    );
  });
  it("returns undefined for out-of-range", () => {
    expect(meditationByIndex(0)).toBeUndefined();
    expect(meditationByIndex(MEDITATIONS.length + 1)).toBeUndefined();
    expect(meditationByIndex(NaN)).toBeUndefined();
  });
});

describe("meditationById", () => {
  it("finds by id", () => {
    expect(meditationById("memory-vs-intelligence")?.title).toContain("Memory");
  });
  it("returns undefined for unknown id", () => {
    expect(meditationById("nope")).toBeUndefined();
  });
});
