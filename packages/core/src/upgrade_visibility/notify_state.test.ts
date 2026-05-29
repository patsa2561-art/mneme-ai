/**
 * v2.94.0 — WHISPER, DON'T NAG (the first ETHOS action). notify-state tests.
 *
 *   W1  classifyUpgradeSeverity — security flag · feature (major/minor) · cosmetic (patch)
 *   W2  feature bump → whisper ONCE per new latest; silent after; a NEW latest re-whispers
 *   W3  security → surface ALWAYS (a duty, never deduped)
 *   W4  cosmetic → never the loud block (inbox/glyph only)
 *   W5  de-worm vow preserved — the notice is never an auto-action; reducing repetition only
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyUpgradeSeverity, shouldSurfaceUpgrade, markUpgradeNotified, upgradeAlreadyNotified } from "./notify_state.js";

function repo(): string { return mkdtempSync(join(tmpdir(), "notify-")); }

describe("v2.94.0 WHISPER — upgrade notify-state (version-dedupe + severity)", () => {
  it("W1 classifyUpgradeSeverity — security / feature(major,minor) / cosmetic(patch)", () => {
    expect(classifyUpgradeSeverity("2.93.0", "2.94.0", { security: true })).toBe("security");
    expect(classifyUpgradeSeverity("2.93.0", "3.0.0")).toBe("feature"); // major
    expect(classifyUpgradeSeverity("2.93.0", "2.94.0")).toBe("feature"); // minor
    expect(classifyUpgradeSeverity("2.93.0", "2.93.1")).toBe("cosmetic"); // patch only
    expect(classifyUpgradeSeverity("2.93.0", "garbage")).toBe("feature"); // unparseable → safer to whisper
  });

  it("W2 feature bump → whisper ONCE per new latest; silent after; new latest re-whispers", () => {
    const r = repo();
    // first sight of 2.94.0 → surface
    expect(shouldSurfaceUpgrade(r, "2.94.0", "feature")).toBe(true);
    markUpgradeNotified(r, "2.94.0", "feature");
    // same latest again → silent (the nag is gone)
    expect(shouldSurfaceUpgrade(r, "2.94.0", "feature")).toBe(false);
    expect(shouldSurfaceUpgrade(r, "2.94.0", "feature")).toBe(false);
    expect(upgradeAlreadyNotified(r, "2.94.0")).toBe(true);
    // a genuinely NEW latest → whisper once more
    expect(shouldSurfaceUpgrade(r, "2.95.0", "feature")).toBe(true);
    markUpgradeNotified(r, "2.95.0", "feature");
    expect(shouldSurfaceUpgrade(r, "2.95.0", "feature")).toBe(false);
    // ...but the OLD one stays silent (we moved on)
    expect(upgradeAlreadyNotified(r, "2.95.0")).toBe(true);
  });

  it("W3 security → surface ALWAYS (a duty, never deduped)", () => {
    const r = repo();
    markUpgradeNotified(r, "2.94.0", "security");
    // even already-notified, security surfaces every time
    expect(shouldSurfaceUpgrade(r, "2.94.0", "security")).toBe(true);
    expect(shouldSurfaceUpgrade(r, "2.94.0", "security")).toBe(true);
  });

  it("W4 cosmetic → never the loud block (inbox/glyph only)", () => {
    const r = repo();
    expect(shouldSurfaceUpgrade(r, "2.93.1", "cosmetic")).toBe(false);
    expect(shouldSurfaceUpgrade(r, "2.93.2", "cosmetic")).toBe(false);
  });

  it("W5 reducing repetition only — distinct latests are tracked independently", () => {
    const r = repo();
    expect(upgradeAlreadyNotified(r, "2.94.0")).toBe(false);
    markUpgradeNotified(r, "2.94.0", "feature");
    expect(upgradeAlreadyNotified(r, "2.94.0")).toBe(true);
    expect(upgradeAlreadyNotified(r, "2.95.0")).toBe(false); // a different version is its own decision
  });
});
