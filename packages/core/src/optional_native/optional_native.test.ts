import { describe, it, expect } from "vitest";
import {
  KNOWN_NATIVES,
  probeNative,
  detectAvailableNatives,
  requireOptional,
  installStatus,
  installHint,
  PROTOCOL_VERSION,
} from "./index.js";

describe("v2.19.55 OPTIONAL NATIVE — protocol + catalog", () => {
  it("KNOWN_NATIVES catalog has the expected 5 entries", () => {
    expect(KNOWN_NATIVES.length).toBe(5);
    const names = KNOWN_NATIVES.map((n) => n.name).sort();
    expect(names).toEqual(["onnxruntime-node", "sharp", "tensorflow", "transformers", "z3-solver"]);
  });

  it("every catalog entry has required fields", () => {
    for (const n of KNOWN_NATIVES) {
      expect(typeof n.name).toBe("string");
      expect(typeof n.npmPackage).toBe("string");
      expect(typeof n.enables).toBe("string");
      expect(typeof n.fallback).toBe("string");
      expect(typeof n.installHint).toBe("string");
      expect(n.installHint.startsWith("npm install")).toBe(true);
    }
  });

  it("probeNative returns structured result for known natives", async () => {
    const r = await probeNative("transformers");
    expect(typeof r.available).toBe("boolean");
    expect(r.fallback).toMatch(/hash embedder/);
    // We can't assert availability — depends on whether transformers is installed
  });

  it("probeNative returns ok=false with hint for unknown name", async () => {
    const r = await probeNative("nonexistent-thing" as never);
    expect(r.available).toBe(false);
    expect(r.loadErrorIfMissing).toBe("unknown native name");
  });

  it("detectAvailableNatives returns all 5 probes sorted (available first)", async () => {
    const probes = await detectAvailableNatives();
    expect(probes.length).toBe(5);
    // Available probes come first
    let sawMissing = false;
    for (const p of probes) {
      if (sawMissing) expect(p.available).toBe(false);
      if (!p.available) sawMissing = true;
    }
  });

  it("requireOptional<T> with missing dep returns fallbackUsed=true + no throw", async () => {
    // sharp is intentionally not a hard dep — almost certainly missing
    const r = await requireOptional("sharp");
    expect(typeof r.ok).toBe("boolean");
    expect(typeof r.fallbackUsed).toBe("boolean");
    // Either ok=true (sharp installed) or ok=false fallbackUsed=true
    if (!r.ok) {
      expect(r.fallbackUsed).toBe(true);
      expect(typeof r.fallbackHint).toBe("string");
    }
    // Never throws
  });

  it("installStatus returns structured dashboard with recommendation", async () => {
    const s = await installStatus();
    expect(s.v).toBe(PROTOCOL_VERSION);
    expect(s.totalKnown).toBe(KNOWN_NATIVES.length);
    expect(Array.isArray(s.available)).toBe(true);
    expect(Array.isArray(s.missing)).toBe(true);
    expect(s.available.length + s.missing.length).toBe(s.totalKnown);
    expect(typeof s.recommendation).toBe("string");
    expect(s.recommendation.length).toBeGreaterThan(20);
  });

  it("installStatus bytesAvailable + bytesIfAllInstalled are sensible", async () => {
    const s = await installStatus();
    expect(s.bytesIfAllInstalled).toBeGreaterThan(0);
    expect(s.bytesAvailable).toBeLessThanOrEqual(s.bytesIfAllInstalled);
  });

  it("installHint returns structured guidance for known native", () => {
    const r = installHint("transformers");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.npmCommand).toMatch(/^npm install/);
      expect(r.enables).toMatch(/embedder|WASM|model/);
      expect(r.approxMB).toBeGreaterThan(0);
      expect(r.rationale).toMatch(/Installing/);
    }
  });

  it("installHint returns ok=false for unknown native", () => {
    const r = installHint("nonexistent-native" as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("unknown native name");
  });

  it("z3-solver entry: confirms ACGV continues working when missing", () => {
    const z3 = KNOWN_NATIVES.find((n) => n.name === "z3-solver");
    expect(z3).toBeDefined();
    expect(z3!.fallback).toMatch(/propositional|Gödel|Godel/);
  });
});
