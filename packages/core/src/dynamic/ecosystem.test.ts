/**
 * Dynamic MCP — ecosystem detection tests.
 *
 * The wild card: the FIRST MCP server with repo-dependent tool surface.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectEcosystems, buildDynamicToolCatalog } from "./ecosystem.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mneme-eco-"));
});

afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

describe("detectEcosystems — empty repo", () => {
  it("returns no signals for an empty directory", () => {
    const r = detectEcosystems(tmp);
    expect(r.signals).toEqual([]);
    expect(r.toolsToAdd).toBe(0);
  });
});

describe("detectEcosystems — Stripe", () => {
  it("detects Stripe via package.json + import", () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ dependencies: { stripe: "^14.0.0" } }));
    mkdirSync(join(tmp, "src"));
    writeFileSync(join(tmp, "src/checkout.ts"), `import Stripe from 'stripe';\nconst client = new Stripe(key);`);
    const r = detectEcosystems(tmp);
    const stripe = r.signals.find((s) => s.id === "stripe");
    expect(stripe).toBeDefined();
    expect(stripe!.confidence).toBeGreaterThan(0.5);
    expect(stripe!.tools).toContain("mneme.stripe.find_pricing_logic");
  });
});

describe("detectEcosystems — React", () => {
  it("detects React monorepo", () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ dependencies: { react: "^18.0.0", "react-dom": "^18.0.0" } }));
    mkdirSync(join(tmp, "src"));
    writeFileSync(join(tmp, "src/App.tsx"), `import React from 'react';\nexport default function App(){return <div/>}`);
    const r = detectEcosystems(tmp);
    const react = r.signals.find((s) => s.id === "react");
    expect(react).toBeDefined();
    expect(react!.tools.length).toBeGreaterThan(0);
  });
});

describe("detectEcosystems — Postgres", () => {
  it("detects Prisma + migrations folder", () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ dependencies: { "@prisma/client": "^5.0.0" } }));
    mkdirSync(join(tmp, "prisma/migrations/0001_init"), { recursive: true });
    writeFileSync(join(tmp, "prisma/migrations/0001_init/migration.sql"), "CREATE TABLE users (id INT);");
    const r = detectEcosystems(tmp);
    const pg = r.signals.find((s) => s.id === "postgres");
    expect(pg).toBeDefined();
  });
});

describe("detectEcosystems — multi-ecosystem repo", () => {
  it("detects multiple ecosystems independently (React + Stripe + Postgres)", () => {
    writeFileSync(
      join(tmp, "package.json"),
      JSON.stringify({
        dependencies: {
          react: "^18.0.0",
          stripe: "^14.0.0",
          "@prisma/client": "^5.0.0",
        },
      }),
    );
    mkdirSync(join(tmp, "src"));
    writeFileSync(join(tmp, "src/App.tsx"), `import React from 'react';`);
    writeFileSync(join(tmp, "src/checkout.ts"), `import Stripe from 'stripe';`);
    mkdirSync(join(tmp, "prisma"));
    writeFileSync(join(tmp, "prisma/schema.prisma"), "model User {}");

    const r = detectEcosystems(tmp);
    const ids = r.signals.map((s) => s.id).sort();
    expect(ids).toContain("react");
    expect(ids).toContain("stripe");
    expect(ids).toContain("postgres");
    expect(r.toolsToAdd).toBeGreaterThanOrEqual(7);
  });
});

describe("buildDynamicToolCatalog", () => {
  it("converts detection into tool catalog with descriptions", () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ dependencies: { stripe: "^14.0.0" } }));
    mkdirSync(join(tmp, "src"));
    writeFileSync(join(tmp, "src/x.ts"), `import Stripe from 'stripe';`);
    const detection = detectEcosystems(tmp);
    const catalog = buildDynamicToolCatalog(detection);
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog[0]!.description).toMatch(/auto-detected/);
    expect(catalog[0]!.confidence).toBeGreaterThan(0);
    expect(catalog[0]!.ecosystem).toBe("stripe");
  });

  it("returns empty catalog for empty detection", () => {
    const catalog = buildDynamicToolCatalog({ detectedAt: "x", signals: [], toolsToAdd: 0 });
    expect(catalog).toEqual([]);
  });
});

describe("detectEcosystems — refuses false positives", () => {
  it("does NOT flag Stripe just because the word appears in a comment", () => {
    mkdirSync(join(tmp, "src"));
    writeFileSync(join(tmp, "src/x.ts"), "// stripe is a payment processor — but we don't use it");
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ dependencies: {} }));
    const r = detectEcosystems(tmp);
    const stripe = r.signals.find((s) => s.id === "stripe");
    // Confidence might match the file pattern (filename contains 'stripe-') but not enough alone
    expect(stripe).toBeUndefined();
  });
});
