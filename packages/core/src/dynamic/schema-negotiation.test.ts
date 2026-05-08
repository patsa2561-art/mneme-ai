import { describe, it, expect } from "vitest";
import {
  negotiateSchemaVersion,
  canLoad,
  CURRENT_PACK_SCHEMA_VERSION,
  SUPPORTED_PACK_SCHEMA_VERSIONS,
} from "./schema-negotiation.js";

describe("schema negotiation — happy path", () => {
  it("accepts current schema version", () => {
    const r = negotiateSchemaVersion(CURRENT_PACK_SCHEMA_VERSION);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.effectiveVersion).toBe(CURRENT_PACK_SCHEMA_VERSION);
    expect(r.migrationApplied).toBe(false);
  });

  it("canLoad returns true for supported version", () => {
    expect(canLoad(1)).toBe(true);
  });
});

describe("schema negotiation — failure paths", () => {
  it("rejects missing version with structured error", () => {
    const r = negotiateSchemaVersion(undefined);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("version-missing");
    expect(r.claimed).toBeNull();
  });

  it("rejects non-number version (string)", () => {
    const r = negotiateSchemaVersion("1");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("version-missing");
  });

  it("rejects NaN / Infinity", () => {
    expect(negotiateSchemaVersion(NaN).ok).toBe(false);
    expect(negotiateSchemaVersion(Infinity).ok).toBe(false);
  });

  it("rejects too-new version with upgrade hint", () => {
    const r = negotiateSchemaVersion(99);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("version-too-new");
    expect(r.message).toMatch(/upgrade/i);
    expect(r.claimed).toBe(99);
  });

  it("custom supported set: respects override (e.g. testing future v2 path)", () => {
    const r = negotiateSchemaVersion(2, [1, 2]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.effectiveVersion).toBe(2);
  });

  it("when supported set includes a gap, version in gap is 'version-unknown'", () => {
    // e.g. we support [1, 3] but pack claims version 2
    const r = negotiateSchemaVersion(2, [1, 3]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("version-unknown");
  });
});

describe("schema negotiation — exposed constants", () => {
  it("CURRENT_PACK_SCHEMA_VERSION is 1", () => {
    expect(CURRENT_PACK_SCHEMA_VERSION).toBe(1);
  });

  it("SUPPORTED_PACK_SCHEMA_VERSIONS includes current", () => {
    expect(SUPPORTED_PACK_SCHEMA_VERSIONS).toContain(CURRENT_PACK_SCHEMA_VERSION);
  });
});
