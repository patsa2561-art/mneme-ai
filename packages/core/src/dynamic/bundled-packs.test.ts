/**
 * Bundled-packs tests — verify our shipped Stripe pack actually loads
 * + parses + matches schema + executes against a fixture repo.
 *
 * This is the integration moment: pack file on disk → loader → schema →
 * tool catalog → ready to dispatch.
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPackFromFile } from "./pack-loader.js";
import { buildActiveToolCatalog } from "./tool-builder.js";
import { detectEcosystems } from "./ecosystem.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

// Resolve pack path from THIS test file's location (works for both
// source and dist).
const HERE = dirname(fileURLToPath(import.meta.url));
const STRIPE_PACK_PATH = join(HERE, "packs", "stripe.yml");

describe("bundled Stripe pack — sanity", () => {
  it("file exists at expected location", () => {
    expect(existsSync(STRIPE_PACK_PATH)).toBe(true);
  });

  it("loads and validates against pack schema", () => {
    const r = loadPackFromFile(STRIPE_PACK_PATH);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      // Surface the validation errors loudly when they fire
      // eslint-disable-next-line no-console
      console.error("Stripe pack validation failures:", r);
      throw new Error("Stripe pack invalid");
    }
    expect(r.pack.id).toBe("stripe");
    expect(r.pack.tools.length).toBe(3);
  });

  it("declares the 3 expected tools", () => {
    const r = loadPackFromFile(STRIPE_PACK_PATH);
    if (!r.ok) throw new Error("expected ok");
    const ids = r.pack.tools.map((t) => t.id).sort();
    expect(ids).toEqual(["audit_pii_handlers", "find_pricing_logic", "list_webhook_handlers"]);
  });

  it("every tool's input schema is a valid JSON-Schema-shaped object", () => {
    const r = loadPackFromFile(STRIPE_PACK_PATH);
    if (!r.ok) throw new Error("expected ok");
    for (const tool of r.pack.tools) {
      expect(tool.inputSchema).toHaveProperty("type", "object");
    }
  });
});

describe("bundled Stripe pack — end-to-end with detection", () => {
  it("detects + builds catalog when fixture repo has Stripe", () => {
    const r = loadPackFromFile(STRIPE_PACK_PATH);
    if (!r.ok) throw new Error("expected ok");

    const tmp = mkdtempSync(join(tmpdir(), "mneme-stripe-fixture-"));
    try {
      writeFileSync(join(tmp, "package.json"), JSON.stringify({ dependencies: { stripe: "^14.0.0" } }));
      mkdirSync(join(tmp, "src"));
      writeFileSync(join(tmp, "src/billing.ts"), `import Stripe from 'stripe';\nconst c = stripe.prices.list();\n`);

      const detection = detectEcosystems(tmp);
      const catalog = buildActiveToolCatalog({ detection, packs: [r.pack] });

      expect(catalog.length).toBe(3);
      expect(catalog.map((t) => t.name).sort()).toEqual([
        "mneme.stripe.audit_pii_handlers",
        "mneme.stripe.find_pricing_logic",
        "mneme.stripe.list_webhook_handlers",
      ]);
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    }
  });

  it("does NOT build catalog when fixture repo has no Stripe", () => {
    const r = loadPackFromFile(STRIPE_PACK_PATH);
    if (!r.ok) throw new Error("expected ok");

    const tmp = mkdtempSync(join(tmpdir(), "mneme-no-stripe-"));
    try {
      writeFileSync(join(tmp, "package.json"), JSON.stringify({ dependencies: {} }));
      const detection = detectEcosystems(tmp);
      const catalog = buildActiveToolCatalog({ detection, packs: [r.pack] });
      expect(catalog).toEqual([]);
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    }
  });
});
