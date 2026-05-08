#!/usr/bin/env node
/**
 * git-mneme — the git subcommand wrapper.
 *
 * Allows users to type `git mneme <subcommand>` instead of `mneme <subcommand>`.
 * git treats any binary in PATH named `git-<name>` as a subcommand, so once
 * Mneme is installed globally + this script is on PATH, `git mneme why src/auth.ts`
 * works identically to `mneme why src/auth.ts`.
 *
 * This is the foundation of the v1.5.0 "stand beside git" positioning:
 * Mneme is no longer just an MCP plugin for AI tools — it's a git extension
 * that any developer using git, on any platform (GitHub / GitLab / Bitbucket
 * / Gitea / self-hosted), can install and benefit from.
 *
 * Implementation: pure pass-through to the same dist/index.js entrypoint
 * with argv shifted by one (drops the leading 'mneme' that git would
 * usually pass via argv[2]). All flags, all commands, all behaviors
 * identical to invoking `mneme` directly.
 */

// Same SQLite-warning suppression as mneme.js — keep behavior identical.
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

// argv layout when invoked as a git subcommand:
//   process.argv[0] = node
//   process.argv[1] = git-mneme.js
//   process.argv[2..] = the subcommand + flags ('why', 'audit', etc)
// The dist/index.js parser expects the same shape as `mneme`, so we just
// pass argv through unchanged after re-aliasing argv[1] for nicer error
// messages ("mneme" not "git-mneme.js").
const passthrough = ["mneme", ...process.argv.slice(2)];

// --version fast path — same as mneme.js
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
  import("../dist/index.js").then((m) => m.run(passthrough));
}
