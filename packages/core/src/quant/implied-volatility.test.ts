import { describe, it, expect } from "vitest";
import { scoreTone, impliedVolatility, summarizeVolatility } from "./implied-volatility.js";
import type { Commit } from "../types.js";

const cmt = (hash: string, date: string, subject: string, body = ""): Commit => ({
  hash,
  shortHash: hash.slice(0, 7),
  authorName: "alice",
  authorEmail: "a@x",
  authorDate: `${date}T00:00:00Z`,
  committerDate: `${date}T00:00:00Z`,
  subject,
  body,
  parents: [],
  files: [],
});

describe("scoreTone — calm vs frustrated commits", () => {
  it("calm commit scores low tone", () => {
    const t = scoreTone(cmt("a1", "2024-01-01", "feat: add new endpoint"));
    expect(t.exclamationScore).toBe(0);
    expect(t.allCapsScore).toBe(0);
    expect(t.emojiScore).toBe(0);
    expect(t.frictionScore).toBe(0);
    expect(t.toneScore).toBeLessThan(0.1);
  });

  it("frustrated commit scores high tone", () => {
    const t = scoreTone(
      cmt("a1", "2024-01-01", "OMG WTF this is BROKEN!!!", "kinda hopefully fixed??"),
    );
    expect(t.exclamationScore).toBeGreaterThan(0);
    expect(t.allCapsScore).toBeGreaterThan(0);
    expect(t.frictionScore).toBeGreaterThan(0);
    expect(t.hedgeScore).toBeGreaterThan(0);
    expect(t.toneScore).toBeGreaterThan(0.3);
  });

  it("emoji-laden commit raises emoji score", () => {
    const t = scoreTone(cmt("a1", "2024-01-01", "fix prod 🔥💀⚠️"));
    expect(t.emojiScore).toBeGreaterThan(0);
  });

  it("hedge words detected", () => {
    const t = scoreTone(cmt("a1", "2024-01-01", "maybe fix race", "should work probably"));
    expect(t.hedgeScore).toBeGreaterThanOrEqual(2);
  });

  it("toneScore is bounded [0, 1]", () => {
    const samples = [
      "feat: add",
      "OMG WTF BROKEN!!!! 🔥💀 wtf wtf wtf maybe maybe maybe",
      "",
      "AAAAAAAA",
    ];
    for (const subj of samples) {
      const t = scoreTone(cmt("x", "2024-01-01", subj));
      expect(t.toneScore).toBeGreaterThanOrEqual(0);
      expect(t.toneScore).toBeLessThanOrEqual(1);
    }
  });
});

describe("impliedVolatility — weekly aggregation", () => {
  it("returns empty for empty input", () => {
    expect(impliedVolatility([])).toEqual([]);
  });

  it("buckets by ISO week + computes IV in 0-100 range", () => {
    const commits = [
      cmt("a1", "2024-01-01", "feat: A"),
      cmt("a2", "2024-01-02", "feat: B"),
      cmt("a3", "2024-01-08", "OMG BROKEN!!!"),
      cmt("a4", "2024-01-09", "wtf this is hopeless"),
    ];
    const windows = impliedVolatility(commits);
    expect(windows.length).toBeGreaterThanOrEqual(2);
    for (const w of windows) {
      expect(w.iv).toBeGreaterThanOrEqual(0);
      expect(w.iv).toBeLessThanOrEqual(100);
    }
  });

  it("higher tone week shows higher IV", () => {
    const commits = [
      cmt("a1", "2024-01-01", "feat: A"),
      cmt("a2", "2024-01-02", "feat: B"),
      cmt("a3", "2024-01-08", "OMG WTF BROKEN!!!"),
      cmt("a4", "2024-01-09", "ARGH crashed!!! ugh"),
      cmt("a5", "2024-01-10", "fucking 🔥🔥🔥"),
    ];
    const windows = impliedVolatility(commits);
    expect(windows.length).toBe(2);
    expect(windows[1]!.iv).toBeGreaterThan(windows[0]!.iv);
  });
});

describe("summarizeVolatility — trend detection", () => {
  it("returns 'insufficient-data' for fewer than 4 weeks", () => {
    const commits = [cmt("a", "2024-01-01", "feat: x")];
    expect(summarizeVolatility(commits).trend).toBe("insufficient-data");
  });

  it("'rising' when last 4 weeks ascend", () => {
    const commits = [
      // Week 1: calm
      cmt("a1", "2024-01-01", "feat: A"),
      // Week 2: warming up
      cmt("a2", "2024-01-08", "fix bug !!"),
      // Week 3: hot
      cmt("a3", "2024-01-15", "WTF BROKEN!!!"),
      // Week 4: very hot
      cmt("a4", "2024-01-22", "OMG WTF FUCKED 🔥💀 maybe hopefully fix?"),
    ];
    expect(summarizeVolatility(commits).trend).toBe("rising");
  });

  it("'falling' when last 4 weeks descend", () => {
    const commits = [
      cmt("a1", "2024-01-01", "OMG WTF FUCKED 🔥💀!!!!!"),
      cmt("a2", "2024-01-08", "WTF still BROKEN!!!"),
      cmt("a3", "2024-01-15", "kinda fix maybe"),
      cmt("a4", "2024-01-22", "feat: stable release"),
    ];
    expect(summarizeVolatility(commits).trend).toBe("falling");
  });

  it("'flat' when 4 weeks are similar", () => {
    const commits = [
      cmt("a1", "2024-01-01", "feat: stable"),
      cmt("a2", "2024-01-08", "feat: stable"),
      cmt("a3", "2024-01-15", "feat: stable"),
      cmt("a4", "2024-01-22", "feat: stable"),
    ];
    expect(summarizeVolatility(commits).trend).toBe("flat");
  });

  it("interpretation includes IV number + trend label", () => {
    const commits = Array.from({ length: 4 }, (_, i) =>
      cmt(`a${i}`, `2024-01-${String(i * 7 + 1).padStart(2, "0")}`, "feat: x"),
    );
    const r = summarizeVolatility(commits);
    expect(r.interpretation).toMatch(/IV is/);
  });
});
