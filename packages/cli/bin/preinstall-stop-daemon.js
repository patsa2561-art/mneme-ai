#!/usr/bin/env node
/**
 * v2.19.45 — npm preinstall hook: stop any running Mneme daemon before
 * npm tries to overwrite the binary. Closes the EBUSY libvips-42.dll
 * race on Windows where `npm install -g mneme-ai@latest` would fail
 * because the running daemon held the .dll open.
 *
 * Safe by design:
 *   - Best-effort: never throws (silently exits 0 if anything fails).
 *   - Idempotent: if no daemon is running, the script is a no-op.
 *   - Cross-platform: uses Mneme's own daemon-stop primitive if available.
 *
 * Why this works at preinstall time: npm runs preinstall on the NEW
 * package's lifecycle BEFORE extracting tarball contents. The OLD
 * binary is still on disk + the OLD daemon may still be running. We
 * spawn `mneme daemon stop` against the OLD binary to release file
 * locks BEFORE npm copies in new files.
 */

// We have to be ultra-defensive: this script runs during npm install,
// which means dependencies aren't available yet + we may be inside a
// sandboxed install where binaries can't be located. ALL exceptions
// swallow + exit 0.

(async () => {
  try {
    const { spawnSync } = await import("node:child_process");

    // Try `mneme daemon stop` against any version already on PATH.
    const isWin = process.platform === "win32";
    const exe = isWin ? "mneme.cmd" : "mneme";
    const r = spawnSync(exe, ["daemon", "stop"], {
      shell: isWin,
      windowsHide: true,
      timeout: 10_000,
      stdio: "ignore", // never pollute npm's stdout/stderr
    });
    // Don't even check r.status — the install proceeds regardless.
    void r;
  } catch { /* swallow everything */ }
  process.exit(0);
})();
