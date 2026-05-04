import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ManualJsonAdapter } from "./manual.js";

let tmpDir: string;
let path: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mneme-manual-"));
  path = join(tmpDir, "incidents.json");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("ManualJsonAdapter", () => {
  it("loads valid incidents", async () => {
    writeFileSync(
      path,
      JSON.stringify([
        {
          id: "INC-1",
          title: "Stripe webhook 500",
          occurredAt: "2025-01-15T10:00:00Z",
          severity: "error",
        },
      ]),
    );
    const adapter = new ManualJsonAdapter(path);
    const incidents = await adapter.fetch({});
    expect(incidents).toHaveLength(1);
    expect(incidents[0]!.title).toBe("Stripe webhook 500");
    expect(incidents[0]!.source).toBe("manual");
  });

  it("auto-fills id when missing", async () => {
    writeFileSync(
      path,
      JSON.stringify([{ title: "x", occurredAt: "2025-01-01T00:00:00Z" }]),
    );
    const adapter = new ManualJsonAdapter(path);
    const incidents = await adapter.fetch({});
    expect(incidents[0]!.id).toBe("manual-0");
  });

  it("defaults severity to 'error'", async () => {
    writeFileSync(
      path,
      JSON.stringify([{ title: "x", occurredAt: "2025-01-01T00:00:00Z" }]),
    );
    const adapter = new ManualJsonAdapter(path);
    const [inc] = await adapter.fetch({});
    expect(inc!.severity).toBe("error");
  });

  it("throws if file is not a JSON array", async () => {
    writeFileSync(path, JSON.stringify({ not: "array" }));
    const adapter = new ManualJsonAdapter(path);
    await expect(adapter.fetch({})).rejects.toThrow(/JSON array/);
  });

  it("throws on missing required fields", async () => {
    writeFileSync(path, JSON.stringify([{ id: "x" }]));
    const adapter = new ManualJsonAdapter(path);
    await expect(adapter.fetch({})).rejects.toThrow(/title/);
  });
});
