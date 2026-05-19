#!/usr/bin/env node
/**
 * v2.19.71 — MNEME postinstall: TWO independent jobs in one script.
 *
 *   JOB 1 — MNEME_LITE prune (Gap 3 workaround #2).
 *     When the user sets MNEME_LITE=1 in the install environment,
 *     remove the optional-dep tree (@huggingface/transformers, sharp,
 *     @img, onnxruntime-*) AFTER npm has extracted it.  Net result:
 *     ~462MB downloaded, ~5MB on-disk.  See v2.19.69 docs/wild_workarounds/02.
 *
 *   JOB 2 — Dual-install detection (N5 fix, v2.19.71).
 *     Some users run two parallel Node version managers (nvm4w +
 *     nvm-windows + Volta + fnm).  Each has its own npm global prefix.
 *     `npm install -g mneme-ai` writes to the ACTIVE prefix; PATH may
 *     resolve `mneme` from a DIFFERENT prefix that has an older copy.
 *     Result: user installs v2.19.70, but `mneme --version` reports
 *     v2.19.69 because PATH wins.  The user perceives "I upgraded but
 *     version didn't change" — invisible distribution failure.
 *
 *     This job runs on every install, scans known npm prefixes for
 *     other mneme-ai installs, and prints a LOUD warning + actionable
 *     remediation if PATH points to a different install than the one
 *     we just landed.  Writes a marker file at
 *     ~/.mneme-global/dual-install-warning.json so the doctor organ
 *     can surface the same diagnosis later.
 *
 *   Both jobs are NON-FATAL — they swallow all errors and always exit
 *   0 so a bug here can never abort an npm install.  Verified by the
 *   source-grep test in packages/cli/tests/postinstall_mneme_lite.test.ts
 *   ("every process.exit is exit 0").
 *
 *   Skip with MNEME_SKIP_DUAL_CHECK=1 (job 2 only) or just don't set
 *   MNEME_LITE (job 1).  CI environments (CI=true) silence job 2 to
 *   avoid spamming build logs that already pin versions exactly.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const here = __dirname;
const mnemeRoot = path.resolve(here, "..");

// ──────────────────────────────────────────────────────────────────────
// JOB 1 — MNEME_LITE prune
// ──────────────────────────────────────────────────────────────────────

function runLitePrune() {
  const LITE = String(process.env.MNEME_LITE || "").trim();
  if (LITE !== "1" && LITE.toLowerCase() !== "true" && LITE.toLowerCase() !== "yes") {
    return; // No-op for the default install path.
  }

  const sub = (p) => path.join(mnemeRoot, "node_modules", p);

  const PRUNE_TARGETS = [
    "@huggingface",
    "@img",
    "sharp",
    "onnxruntime-common",
    "onnxruntime-node",
    "onnxruntime-web",
  ];

  function dirSizeBytes(dirPath) {
    if (!fs.existsSync(dirPath)) return 0;
    let total = 0;
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const ent of entries) {
        const full = path.join(dirPath, ent.name);
        try {
          if (ent.isDirectory()) total += dirSizeBytes(full);
          else if (ent.isFile()) total += fs.statSync(full).size;
        } catch { /* skip */ }
      }
    } catch { /* */ }
    return total;
  }

  const fmtMB = (b) => (b / (1024 * 1024)).toFixed(1) + "MB";

  let prunedBytes = 0;
  const prunedNames = [];
  const skippedNames = [];

  for (const name of PRUNE_TARGETS) {
    const target = sub(name);
    if (!fs.existsSync(target)) {
      skippedNames.push(name);
      continue;
    }
    const sizeBefore = dirSizeBytes(target);
    try {
      fs.rmSync(target, { recursive: true, force: true });
      prunedBytes += sizeBefore;
      prunedNames.push(`${name} (${fmtMB(sizeBefore)})`);
    } catch (err) {
      process.stderr.write(
        `[mneme-lite] could not prune ${name}: ${err && err.message ? err.message : err}\n`,
      );
      skippedNames.push(`${name} (locked)`);
    }
  }

  const summary =
    `[mneme-lite] MNEME_LITE=${LITE} → pruned ${prunedNames.length}/${PRUNE_TARGETS.length} ` +
    `optional-dep directories, ${fmtMB(prunedBytes)} freed.\n` +
    (prunedNames.length > 0 ? `[mneme-lite] removed: ${prunedNames.join(", ")}\n` : "") +
    (skippedNames.length > 0 ? `[mneme-lite] skipped: ${skippedNames.join(", ")}\n` : "") +
    `[mneme-lite] mneme runtime will fall back through OpenAI → Ollama → hash embedder (bundled WASM skipped).\n`;
  process.stdout.write(summary);
}

// ──────────────────────────────────────────────────────────────────────
// JOB 2 — Dual-install detection (N5 fix)
// ──────────────────────────────────────────────────────────────────────

function runDualInstallCheck() {
  // Skip in CI / explicit opt-out — these envs have pinned versions
  // and don't care about PATH resolution drift.
  if (process.env.CI === "true" || process.env.MNEME_SKIP_DUAL_CHECK === "1") return;

  let myVersion;
  try {
    myVersion = JSON.parse(fs.readFileSync(path.join(mnemeRoot, "package.json"), "utf8")).version;
  } catch {
    return; // can't read own version, bail silently
  }

  const home = os.homedir();
  const w = process.platform === "win32";
  const candidatePrefixes = w ? [
    path.join(home, "AppData", "Roaming", "npm"),
    "C:\\nvm4w\\nodejs",
    path.join(home, "AppData", "Local", "nvm"),       // nvm-windows
    path.join(home, "AppData", "Local", "pnpm"),
    path.join(home, "AppData", "Local", "Volta"),
    path.join(home, "scoop", "apps", "nodejs", "current"),
  ] : [
    "/usr/local/lib",
    "/usr/lib",
    "/opt/homebrew/lib",                              // Apple Silicon Homebrew
    path.join(home, ".npm-global"),
    path.join(home, ".nvm", "versions", "node"),      // nvm-bash
    path.join(home, ".volta"),
    path.join(home, ".pnpm-global"),
    path.join(home, ".local", "share", "pnpm"),
  ];

  const otherInstalls = [];
  function tryNodeModules(base) {
    const pkg = path.join(base, "node_modules", "mneme-ai", "package.json");
    if (!fs.existsSync(pkg)) return;
    try {
      const v = JSON.parse(fs.readFileSync(pkg, "utf8")).version;
      const installRoot = path.join(base, "node_modules", "mneme-ai");
      if (path.resolve(installRoot) === path.resolve(mnemeRoot)) return; // ourselves
      otherInstalls.push({
        version: v,
        root: installRoot,
        bin: path.join(installRoot, "bin", "mneme.js"),
      });
    } catch { /* */ }
  }
  function scan(dir) {
    if (!fs.existsSync(dir)) return;
    tryNodeModules(dir);
    try {
      for (const entry of fs.readdirSync(dir)) {
        const sub = path.join(dir, entry);
        tryNodeModules(sub);
        tryNodeModules(path.join(sub, "nodejs"));
      }
    } catch { /* */ }
  }
  for (const pfx of candidatePrefixes) scan(pfx);

  // Resolve which install PATH points to (which `mneme` runs by default)
  let pathInstall = null;
  try {
    const r = w
      ? spawnSync("where", ["mneme"], { encoding: "utf8", shell: true, timeout: 5000, windowsHide: true })
      : spawnSync("which", ["mneme"], { encoding: "utf8", timeout: 5000 });
    if (r.status === 0 && r.stdout) {
      const firstLine = r.stdout.split(/\r?\n/)[0].trim();
      if (firstLine) pathInstall = firstLine;
    }
  } catch { /* */ }

  // Persist a marker file even if no warning prints — doctor organ
  // and bin/mneme.js may surface it later.
  try {
    const dir = path.join(home, ".mneme-global");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const marker = {
      v: 1,
      ts: new Date().toISOString(),
      myInstall: { root: mnemeRoot, version: myVersion },
      otherInstalls,
      pathResolvesTo: pathInstall,
    };
    fs.writeFileSync(
      path.join(dir, "dual-install-warning.json"),
      JSON.stringify(marker, null, 2),
      { encoding: "utf8", mode: 0o600 },
    );
  } catch { /* */ }

  if (otherInstalls.length === 0) return; // single install — all good

  // Compute whether PATH points to our install or an other one.
  const myBinCandidates = [
    path.resolve(path.join(mnemeRoot, "bin", "mneme.js")),
    path.resolve(path.join(mnemeRoot, "bin", "mneme.cmd")),
    path.resolve(path.join(path.dirname(mnemeRoot), ".bin", "mneme")),
    path.resolve(path.join(path.dirname(mnemeRoot), ".bin", "mneme.cmd")),
    path.resolve(path.join(path.dirname(mnemeRoot), ".bin", "mneme.ps1")),
  ];
  const normPath = pathInstall ? path.resolve(pathInstall) : null;
  const pathPointsHere = !!normPath && myBinCandidates.includes(normPath);

  // Headline — always tell the user.
  const sep = "\n" + "─".repeat(70);
  const Y = process.stdout.isTTY ? "\x1b[33m" : "";
  const R = process.stdout.isTTY ? "\x1b[31m" : "";
  const B = process.stdout.isTTY ? "\x1b[1m" : "";
  const X = process.stdout.isTTY ? "\x1b[0m" : "";

  const lines = [];
  lines.push(sep);
  lines.push(`${Y}${B}⚠ Mneme: dual-install detected on this machine${X}`);
  lines.push(`  This install:        ${mnemeRoot} (v${myVersion})`);
  for (const o of otherInstalls) {
    const mark = o.version === myVersion ? " (same version)"
      : compareSemver(o.version, myVersion) > 0 ? " (NEWER!)"
      : " (older)";
    lines.push(`  Also found:          ${o.root} (v${o.version})${mark}`);
  }
  if (pathInstall) {
    lines.push(`  'mneme' on PATH:     ${pathInstall}`);
  } else {
    lines.push(`  'mneme' on PATH:     (not found via \`${w ? "where" : "which"} mneme\`)`);
  }

  if (!pathPointsHere && pathInstall) {
    // CRITICAL CASE — user's `mneme` command will NOT run the version
    // they just installed.  Loud + actionable remediation.
    lines.push(``);
    lines.push(`${R}${B}  → \`mneme\` will NOT run v${myVersion} you just installed.${X}`);
    lines.push(`    PATH resolves to a DIFFERENT install.`);
    lines.push(``);
    lines.push(`  ${B}To fix, pick ONE:${X}`);
    lines.push(`    ${B}# Option 1: uninstall the stale path${X}`);
    lines.push(`    npm uninstall -g mneme-ai   # from a shell where 'which mneme' shows the stale one`);
    lines.push(`    npm install -g mneme-ai@${myVersion}`);
    lines.push(``);
    lines.push(`    ${B}# Option 2: invoke this install directly${X}`);
    if (w) {
      lines.push(`    node "${path.join(mnemeRoot, "bin", "mneme.js")}" <args>`);
    } else {
      lines.push(`    node "${path.join(mnemeRoot, "bin", "mneme.js")}" <args>`);
    }
    lines.push(``);
    lines.push(`    ${B}# Option 3: run \`mneme doctor scan\` for a full diagnosis${X}`);
    lines.push(`    node "${path.join(mnemeRoot, "bin", "mneme.js")}" doctor scan --pretty`);
  } else if (pathPointsHere) {
    lines.push(`  ${B}PATH points to this install — you're using v${myVersion} ✓${X}`);
    lines.push(`  (The other installs above are inactive copies; safe to remove with \`npm uninstall -g mneme-ai\` from their respective shells.)`);
  }
  lines.push(sep);

  process.stdout.write(lines.join("\n") + "\n");
}

/** Lexicographic semver-ish compare.  Returns positive if a > b,
 *  negative if a < b, 0 if equal.  Handles "X.Y.Z" + "X.Y.Z-suffix". */
function compareSemver(a, b) {
  const parse = (s) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(String(s));
    if (!m) return [0, 0, 0, ""];
    return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10), m[4] || ""];
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  // Prerelease loses to release (per semver), so "lite" suffix ranks LOWER.
  if (pa[3] === pb[3]) return 0;
  if (pa[3] === "") return 1;
  if (pb[3] === "") return -1;
  return pa[3] < pb[3] ? -1 : 1;
}

// ──────────────────────────────────────────────────────────────────────
// Master invariant: NEVER abort the install.  Both jobs are wrapped.
// ──────────────────────────────────────────────────────────────────────

try { runLitePrune(); } catch (e) {
  try { process.stderr.write(`[mneme-postinstall] lite-prune error (non-fatal): ${e && e.message ? e.message : e}\n`); } catch { /* */ }
}

try { runDualInstallCheck(); } catch (e) {
  try { process.stderr.write(`[mneme-postinstall] dual-install-check error (non-fatal): ${e && e.message ? e.message : e}\n`); } catch { /* */ }
}

process.exit(0);
