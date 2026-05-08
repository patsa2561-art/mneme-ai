export * from "./ecosystem.js";
export * from "./pack-schema.js";
export * from "./pack-loader.js";
export * from "./query-engine.js";
export * from "./augmentation.js";
export * from "./tool-builder.js";

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to the bundled packs directory (resolved at runtime
 *  from this file's location). */
export function getBundledPacksDir(): string {
  // After build, this file is at <pkg>/dist/dynamic/index.js — packs live
  // alongside the SOURCE at <pkg>/src/dynamic/packs/. We compute relative
  // to dist/ so it works after publish.
  const here = dirname(fileURLToPath(import.meta.url));
  // From dist/dynamic/, go up to dist/, then over to src/dynamic/packs/
  // Actually packs YAML is data — we ship it from src/, copied via package.json files.
  return join(here, "..", "..", "src", "dynamic", "packs");
}
