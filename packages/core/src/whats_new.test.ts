import { describe, expect, it } from "vitest";
import { HIGHLIGHTS, buildDigest } from "./whats_new.js";

describe("whats_new highlights", () => {
  it("ships at least one highlight per minor release since 1.23", () => {
    const minors = new Set(HIGHLIGHTS.map((h) => h.version.split(".").slice(0, 2).join(".")));
    expect(minors.has("1.24")).toBe(true);
    expect(minors.has("1.23")).toBe(true);
  });

  it("every highlight has a non-empty headline + body + at least one tag", () => {
    for (const h of HIGHLIGHTS) {
      expect(h.headline.length).toBeGreaterThan(10);
      expect(h.body.length).toBeGreaterThan(40);
      expect(h.tags.length).toBeGreaterThan(0);
    }
  });

  it("body is ASCII-safe (no em-dash bytes that mojibake on Windows)", () => {
    for (const h of HIGHLIGHTS) {
      // U+2014 em-dash = E2 80 94 in UTF-8
      const buf = Buffer.from(h.body, "utf8");
      let foundEmDash = false;
      for (let i = 0; i < buf.length - 2; i++) {
        if (buf[i] === 0xe2 && buf[i + 1] === 0x80 && buf[i + 2] === 0x94) {
          foundEmDash = true; break;
        }
      }
      expect(foundEmDash).toBe(false);
    }
  });
});

describe("buildDigest", () => {
  it("default returns 3 latest highlights", () => {
    const d = buildDigest({ currentVersion: "1.24.1" });
    expect(d.highlights.length).toBeLessThanOrEqual(3);
    expect(d.totalAvailable).toBe(HIGHLIGHTS.length);
  });

  it("respects limit parameter", () => {
    const d = buildDigest({ currentVersion: "1.24.1", limit: 1 });
    expect(d.highlights.length).toBe(1);
  });

  it("filters by sinceVersion (>=)", () => {
    const d = buildDigest({ currentVersion: "1.24.1", sinceVersion: "1.24.0", limit: 20 });
    for (const h of d.highlights) {
      const [hMaj, hMin, hPatch] = h.version.split(".").map((n) => parseInt(n, 10));
      const cmp = (hMaj! * 10000) + (hMin! * 100) + (hPatch ?? 0);
      expect(cmp).toBeGreaterThanOrEqual(1 * 10000 + 24 * 100 + 0);
    }
  });

  it("returns oneLineSummary mentioning the count", () => {
    const d = buildDigest({ currentVersion: "1.24.1", limit: 2 });
    expect(d.oneLineSummary).toMatch(/2 highlights/);
  });

  it("oneLineSummary explicitly says 'up to date' when no highlights match", () => {
    const d = buildDigest({ currentVersion: "1.24.1", sinceVersion: "99.0.0" });
    expect(d.oneLineSummary).toMatch(/[Uu]p to date|no highlights/);
  });

  it("currentVersion is reflected in the digest", () => {
    const d = buildDigest({ currentVersion: "9.9.9" });
    expect(d.currentVersion).toBe("9.9.9");
  });
});
