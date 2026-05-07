import { describe, expect, it } from "vitest";
import { _AXES_FOR_TESTS } from "./axes.js";

describe("mri — axis catalogue", () => {
  it("has 20 axes", () => {
    expect(_AXES_FOR_TESTS).toHaveLength(20);
  });

  it("every axis has a non-zero stdev (no divide-by-zero)", () => {
    for (const a of _AXES_FOR_TESTS) {
      expect(a.ref.stdev).toBeGreaterThan(0);
    }
  });

  it("every axis declares a direction", () => {
    for (const a of _AXES_FOR_TESTS) {
      expect(["higher-is-worse", "lower-is-worse"]).toContain(a.direction);
    }
  });

  it("every axis id is unique", () => {
    const ids = new Set(_AXES_FOR_TESTS.map((a) => a.id));
    expect(ids.size).toBe(_AXES_FOR_TESTS.length);
  });

  it("every group is represented", () => {
    const counts = new Map<string, number>();
    for (const a of _AXES_FOR_TESTS) {
      counts.set(a.group, (counts.get(a.group) ?? 0) + 1);
    }
    for (const grp of ["people", "code", "process", "risk"]) {
      expect(counts.get(grp), `group ${grp} should have at least one axis`).toBeGreaterThan(0);
    }
    const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
    expect(total).toBe(_AXES_FOR_TESTS.length);
  });

  it("every axis has a non-empty caveat", () => {
    for (const a of _AXES_FOR_TESTS) {
      expect(a.caveat.length).toBeGreaterThan(10);
    }
  });
});
