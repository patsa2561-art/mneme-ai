import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { safeHmacEqual, safeHmacNotEqual } from "./hmac_compare.js";

describe("v2.4 HMAC CONSTANT-TIME COMPARE", () => {
  const a = createHmac("sha256", "secret").update("payload").digest("hex");
  const b = createHmac("sha256", "secret").update("payload").digest("hex");
  const c = createHmac("sha256", "secret").update("DIFFERENT").digest("hex");

  it("equal HMACs compare equal", () => {
    expect(safeHmacEqual(a, b)).toBe(true);
    expect(safeHmacNotEqual(a, b)).toBe(false);
  });

  it("different HMACs compare unequal", () => {
    expect(safeHmacEqual(a, c)).toBe(false);
    expect(safeHmacNotEqual(a, c)).toBe(true);
  });

  it("different-length strings short-circuit to false", () => {
    expect(safeHmacEqual(a, a + "00")).toBe(false);
    expect(safeHmacEqual(a, "")).toBe(false);
  });

  it("empty strings are equal", () => {
    expect(safeHmacEqual("", "")).toBe(true);
  });

  it("non-string inputs return false", () => {
    expect(safeHmacEqual(123 as unknown as string, "abc")).toBe(false);
    expect(safeHmacEqual(null as unknown as string, "abc")).toBe(false);
    expect(safeHmacEqual(undefined as unknown as string, undefined as unknown as string)).toBe(false);
    expect(safeHmacEqual({} as unknown as string, "abc")).toBe(false);
  });
});
