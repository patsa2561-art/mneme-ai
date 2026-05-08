/**
 * Verify ALL bundled packs load + validate cleanly.
 * If a pack file is malformed, this test fails loudly.
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { listPackFiles, loadPackFromFile } from "./pack-loader.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKS_DIR = join(HERE, "packs");

const EXPECTED_PACKS = [
  "stripe", "react", "postgres", "express", "fastapi", "next", "kafka", "graphql",
];

describe("bundled packs — every shipped pack loads", () => {
  it("packs/ directory exists", () => {
    expect(existsSync(PACKS_DIR)).toBe(true);
  });

  it("ships all 8 expected ecosystems", () => {
    const files = listPackFiles(PACKS_DIR);
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  for (const id of EXPECTED_PACKS) {
    it(`pack '${id}' loads + validates against schema`, () => {
      const path = join(PACKS_DIR, `${id}.yml`);
      expect(existsSync(path)).toBe(true);
      const r = loadPackFromFile(path);
      if (!r.ok) {
        // eslint-disable-next-line no-console
        console.error(`Pack '${id}' validation failed:`, r);
        throw new Error(`Pack '${id}' invalid`);
      }
      expect(r.pack.id).toBe(id);
      expect(r.pack.tools.length).toBeGreaterThanOrEqual(2);
    });
  }

  it("every pack tool has at least one query pattern", () => {
    const files = listPackFiles(PACKS_DIR);
    for (const file of files) {
      const r = loadPackFromFile(file);
      if (!r.ok) throw new Error(`load failed for ${file}`);
      for (const tool of r.pack.tools) {
        if (tool.query.kind === "code-search") {
          expect(tool.query.patterns.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("every pack id is unique across the bundled set", () => {
    const files = listPackFiles(PACKS_DIR);
    const ids = new Set<string>();
    for (const file of files) {
      const r = loadPackFromFile(file);
      if (!r.ok) throw new Error(`load failed for ${file}`);
      expect(ids.has(r.pack.id)).toBe(false);
      ids.add(r.pack.id);
    }
  });
});
