#!/usr/bin/env node
// Suppress the node:sqlite "ExperimentalWarning" only — keep all other warnings.
// node:sqlite stabilises in Node 24; until then it emits an experimental notice
// on every load that pollutes our user-facing CLI output. We do this in the
// shebang script (not in dist code) so the suppression is set up before the
// SQLite module is first loaded by any downstream import.
const originalEmit = process.emit;
process.emit = function (name, data, ...rest) {
  if (
    name === "warning" &&
    typeof data === "object" &&
    data !== null &&
    data.name === "ExperimentalWarning" &&
    typeof data.message === "string" &&
    data.message.includes("SQLite is an experimental feature")
  ) {
    return false;
  }
  return originalEmit.call(this, name, data, ...rest);
};

import("../dist/index.js").then((m) => m.run(process.argv));
