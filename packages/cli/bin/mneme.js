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

// ── v0.39 HPC fast path ────────────────────────────────────────────────
// Several common invocations don't need the 50+ command modules to load.
// Short-circuiting them here drops cold-start from ~8-13 s on Windows
// Node 24 to <300 ms (file read + version print).  Anything not handled
// here falls through to the full CLI parser as before.
const arg = process.argv[2];
if (process.argv.length === 3 && (arg === "--version" || arg === "-V")) {
  import("node:fs").then((fs) =>
    import("node:url").then((urlMod) =>
      import("node:path").then((path) => {
        const here = path.dirname(urlMod.fileURLToPath(import.meta.url));
        const pkg = JSON.parse(
          fs.readFileSync(path.join(here, "..", "package.json"), "utf8"),
        );
        process.stdout.write(pkg.version + "\n");
        process.exit(0);
      }),
    ),
  );
} else {
  import("../dist/index.js").then((m) => m.run(process.argv));
}
