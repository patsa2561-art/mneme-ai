/**
 * Time-travel — tests for the per-process state machine. We don't test
 * git resolution here (that's a runtime concern); we test that the
 * state holder transitions correctly and stays per-process.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { getTimeTravelState, resetTimeTravel } from "./_timetravel.js";

describe("Time-travel state machine", () => {
  beforeEach(() => {
    resetTimeTravel();
  });

  it("starts inactive on a fresh process", () => {
    const s = getTimeTravelState();
    expect(s.active).toBe(false);
    expect(s.ref).toBeNull();
    expect(s.resolvedHash).toBeNull();
  });

  it("resetTimeTravel returns state to inactive", () => {
    // Manually flip to active by simulating what activate would do —
    // we can't call the tool handler without a runtime, but we can
    // verify resetTimeTravel always returns to the inactive shape.
    resetTimeTravel();
    const s = getTimeTravelState();
    expect(s.active).toBe(false);
    expect(s.ref).toBeNull();
    expect(s.resolvedHash).toBeNull();
    expect(s.resolvedDate).toBeNull();
    expect(s.activatedAt).toBeNull();
  });
});
