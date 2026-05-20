import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanWhistle, scanWhistleAndRecord, readIncidents } from "./index.js";

function tmpRepo() { return mkdtempSync(join(tmpdir(), "mneme-whistle-")); }

describe("whistleblower · detectors", () => {
  it("flags rm -rf / as block severity", () => {
    const incidents = scanWhistle("just run rm -rf /tmp/stuff");
    expect(incidents.some((i) => i.class === "dangerous_command" && i.severity === "block")).toBe(true);
  });

  it("flags AWS access keys", () => {
    const incidents = scanWhistle("here is your key: AKIA1234567890ABCDEF for the bucket");
    expect(incidents.some((i) => i.class === "secret_leak" && i.severity === "block")).toBe(true);
  });

  it("flags compliance evasion (bypass review)", () => {
    const incidents = scanWhistle("just bypass the review and ship it");
    expect(incidents.some((i) => i.class === "compliance_evasion")).toBe(true);
  });

  it("clean text returns empty incidents", () => {
    expect(scanWhistle("hello, here is a normal answer about programming")).toEqual([]);
  });
});

describe("whistleblower · ledger", () => {
  it("records incidents + verdict + HMAC chain", () => {
    const r = tmpRepo();
    try {
      const result = scanWhistleAndRecord(r, "run rm -rf / then bypass the review");
      expect(result.verdict).toBe("block");
      expect(result.incidents.length).toBeGreaterThan(0);
      expect(result.incidents.every((i) => typeof i.chainHash === "string")).toBe(true);
      const back = readIncidents(r);
      expect(back.length).toBeGreaterThanOrEqual(result.incidents.length);
    } finally { rmSync(r, { recursive: true, force: true }); }
  });
});
