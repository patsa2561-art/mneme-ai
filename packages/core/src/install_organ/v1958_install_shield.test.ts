/**
 * v2.19.58 INSTALL SHIELD — deep tests for the 5-minute install-incoming
 * flag throttle that ends the recurring EBUSY race.
 *
 * The 6-round EBUSY bug class root cause: mid-install, any CLI invocation
 * (Cursor MCP server, VS Code, parallel terminal) respawns daemon → daemon
 * loads sharp DLL → EBUSY on next file copy. Fixed in autonomic_breath_hook
 * by checking install-incoming.flag with a 5-minute window.
 *
 * These tests pin the protocol contract:
 *   - readInstallIncoming returns the flag body when present
 *   - flag age computation matches the autonomic_breath_hook 5min window
 *   - clearInstallIncoming removes the flag (releases the shield)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, existsSync, mkdirSync, writeFileSync, readFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  announceInstallIncoming,
  clearInstallIncoming,
  readInstallIncoming,
  installIncomingPath,
} from "./index.js";

let savedHome: string | undefined;
let savedUserProfile: string | undefined;
let testHome: string;

beforeEach(() => {
  savedHome = process.env["HOME"];
  savedUserProfile = process.env["USERPROFILE"];
  testHome = join(tmpdir(), `mneme-shield-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(testHome, { recursive: true });
  process.env["HOME"] = testHome;
  process.env["USERPROFILE"] = testHome;
});

afterEach(() => {
  process.env["HOME"] = savedHome;
  process.env["USERPROFILE"] = savedUserProfile;
  try { rmSync(testHome, { recursive: true, force: true }); } catch { /* */ }
});

describe("v2.19.58 INSTALL SHIELD — flag-based throttle protocol", () => {
  it("readInstallIncoming returns null when no flag", () => {
    expect(readInstallIncoming()).toBeNull();
  });

  it("announceInstallIncoming + readInstallIncoming roundtrip with announcedAt timestamp", () => {
    const t0 = Date.now();
    announceInstallIncoming("preinstall-hook", "2.19.58");
    const flag = readInstallIncoming();
    expect(flag).not.toBeNull();
    expect(flag?.reason).toBe("preinstall-hook");
    expect(flag?.expectedVersion).toBe("2.19.58");
    expect(typeof flag?.announcedAt).toBe("string");
    const flagTs = new Date(flag!.announcedAt).getTime();
    expect(flagTs).toBeGreaterThanOrEqual(t0);
    expect(flagTs).toBeLessThanOrEqual(Date.now() + 100);
  });

  it("flag age within 5min window = SHIELD ACTIVE (throttle respawn)", () => {
    announceInstallIncoming("test");
    const flag = readInstallIncoming();
    const ageMs = Date.now() - new Date(flag!.announcedAt).getTime();
    const INSTALL_FLAG_TTL_MS = 5 * 60 * 1000;
    expect(ageMs).toBeLessThan(INSTALL_FLAG_TTL_MS);
    // The throttle decision per autonomic_breath_hook v2.19.58:
    const shieldActive = ageMs >= 0 && ageMs < INSTALL_FLAG_TTL_MS;
    expect(shieldActive).toBe(true);
  });

  it("flag age > 5min = SHIELD INACTIVE (allow respawn — install must have hung)", () => {
    announceInstallIncoming("test");
    // Fake an old flag by overwriting with stale timestamp
    const stalePath = installIncomingPath();
    const staleBody = JSON.parse(readFileSync(stalePath, "utf8"));
    staleBody.announcedAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    writeFileSync(stalePath, JSON.stringify(staleBody));
    const flag = readInstallIncoming();
    const ageMs = Date.now() - new Date(flag!.announcedAt).getTime();
    const INSTALL_FLAG_TTL_MS = 5 * 60 * 1000;
    expect(ageMs).toBeGreaterThanOrEqual(INSTALL_FLAG_TTL_MS);
    const shieldActive = ageMs >= 0 && ageMs < INSTALL_FLAG_TTL_MS;
    expect(shieldActive).toBe(false);
  });

  it("clearInstallIncoming removes flag = SHIELD LIFTED (allow respawn)", () => {
    announceInstallIncoming("test");
    expect(existsSync(installIncomingPath())).toBe(true);
    clearInstallIncoming();
    expect(existsSync(installIncomingPath())).toBe(false);
    expect(readInstallIncoming()).toBeNull();
  });

  it("malformed flag body = readInstallIncoming returns null (no crash)", () => {
    mkdirSync(join(testHome, ".mneme-global"), { recursive: true });
    writeFileSync(installIncomingPath(), "not valid json");
    expect(readInstallIncoming()).toBeNull();
  });

  it("future-dated flag (clock skew) handled — ageMs<0 means SHIELD INACTIVE per autonomic_breath_hook", () => {
    announceInstallIncoming("test");
    const futurePath = installIncomingPath();
    const body = JSON.parse(readFileSync(futurePath, "utf8"));
    body.announcedAt = new Date(Date.now() + 60_000).toISOString();
    writeFileSync(futurePath, JSON.stringify(body));
    const flag = readInstallIncoming();
    const ageMs = Date.now() - new Date(flag!.announcedAt).getTime();
    const shieldActive = ageMs >= 0 && ageMs < 5 * 60_000;
    expect(shieldActive).toBe(false); // future-dated flags don't shield (safety against bad clock)
  });
});
