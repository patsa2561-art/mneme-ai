/**
 * `mneme upgrade` — bulletproof self-update.
 *
 * Solves three real-world failure modes that bit users on `npm install -g
 * mneme-ai@latest`:
 *
 *   1. npm cache says "latest" is fresh → no re-fetch → still old.
 *   2. Multiple `mneme` binaries on PATH (npx cache + global) → wrong one runs.
 *   3. CI publish lag — user installs before npm registry has the new version.
 *
 * What this command does:
 *
 *   1. Reads current local version from this binary's package.json.
 *   2. Queries the npm registry directly (bypasses local metadata cache)
 *      for the latest published version.
 *   3. If a newer version exists, runs `npm install -g mneme-ai@<exact>`
 *      with `--force` to bypass cache + the explicit version pin.
 *   4. Diagnoses the user's PATH — lists every `mneme` it can find, so
 *      conflicting binaries are visible.
 *   5. Re-runs `mneme --version` in a fresh shell + reports before/after.
 *   6. If versions still mismatch → prints concrete remediation steps.
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { delimiter as pathDelimiter, join as pathJoin } from "node:path";
import kleur from "kleur";
import { ui, header, section, pill, kv, nextSteps } from "../ui.js";

/** v1.23.4 — pure-JS PATH walker; replaces `which -a` (not portable to
 *  macOS BSD which) and `where` (Windows-only). Works identically on
 *  win32 / darwin / linux without shelling out. */
function findOnPath(binName: string): string[] {
  const isWin = process.platform === "win32";
  const exts = isWin
    ? (process.env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD").split(";").map((e) => e.toLowerCase())
    : [""]; // POSIX: no extension required
  const dirs = (process.env["PATH"] ?? "").split(pathDelimiter).filter(Boolean);
  const hits: string[] = [];
  const seen = new Set<string>();
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = pathJoin(dir, binName + ext);
      try {
        if (!existsSync(full)) continue;
        const st = statSync(full);
        if (!st.isFile()) continue;
        // De-duplicate (PATH may list same dir twice).
        if (seen.has(full)) continue;
        seen.add(full);
        hits.push(full);
      } catch { /* unreachable file — skip */ }
    }
  }
  return hits;
}
import { getVersion } from "../version.js";

export interface UpgradeOptions {
  cwd: string;
  /** Force re-install even when versions match (useful after CI publish lag). */
  force?: boolean;
}

export async function upgradeCommand(opts: UpgradeOptions): Promise<number> {
  ui.banner();
  process.stdout.write(header(
    "🔄",
    "Mneme Upgrade — bulletproof self-update",
    "queries npm directly · bypasses cache · diagnoses PATH conflicts",
    "Why a separate command? `npm install -g mneme-ai@latest` sometimes silently keeps the old version. This forces a fresh install + verifies it stuck.",
  ) + "\n\n");

  const local = getVersion();
  process.stdout.write(kv("currently installed", kleur.bold(local)) + "\n");

  // ── 1. Query npm registry directly (no metadata cache) ────────────
  let remote: string | undefined;
  try {
    process.stdout.write(`  ${kleur.gray("checking npm registry...")}\n`);
    remote = execSync("npm view mneme-ai version --json", {
      encoding: "utf8",
      timeout: 15000,
    })
      .trim()
      .replace(/^"|"$/g, "");
  } catch (err) {
    ui.error(`Cannot reach npm registry: ${(err as Error).message}`);
    process.stdout.write(`  ${kleur.gray("Check your internet connection or proxy.")}\n\n`);
    return 1;
  }
  process.stdout.write(kv("npm registry latest", kleur.bold(remote ?? "(unknown)")) + "\n\n");

  // ── 2. Compare ────────────────────────────────────────────────────
  if (!remote) {
    ui.error("npm did not return a version.");
    return 1;
  }

  if (local === remote && !opts.force) {
    process.stdout.write(`  ${pill("UP TO DATE", "ok")}  ${kleur.green(`You're on ${remote} — the latest published.`)}\n`);
    process.stdout.write(`  ${kleur.gray("To force re-install (e.g. corrupted node_modules):")} ${kleur.cyan("mneme upgrade --force")}\n\n`);
    return 0;
  }

  if (local !== remote) {
    process.stdout.write(`  ${pill("OUTDATED", "warn")}  ${kleur.yellow(`local ${local} → npm has ${remote}`)}\n\n`);
  } else {
    process.stdout.write(`  ${pill("FORCE", "low")}  ${kleur.gray("Re-installing same version per --force")}\n\n`);
  }

  // ── 3. Force-fresh install bypassing npm metadata cache ──────────
  process.stdout.write(section("✦ Installing") + "\n\n");
  // Security hardening (v1.11.0): validate the version from npm registry against
  // strict semver before passing it to spawn. Refuse anything that looks like
  // shell metacharacter injection.
  if (!/^\d+\.\d+\.\d+([.\-+][a-zA-Z0-9.\-]+)?$/.test(remote)) {
    ui.error(`Refusing to install: remote version "${remote}" is not a clean semver string.`);
    return 1;
  }
  const cmd = `npm install -g --force mneme-ai@${remote}`;
  process.stdout.write(`    ${kleur.cyan().bold(cmd)}\n`);
  process.stdout.write(`    ${kleur.gray("(--force bypasses npm metadata cache; @<exact> bypasses 'latest' tag staleness)")}\n\n`);

  // Security hardening (v1.11.0): argv-only invocation. No `shell: true` —
  // npm.cmd is resolved via PATH, args passed as separate argv tokens so
  // the OS shell never interprets them. Eliminates command-injection surface.
  const npmExe = process.platform === "win32" ? "npm.cmd" : "npm";
  const installed = spawnSync(npmExe, ["install", "-g", "--force", `mneme-ai@${remote}`], {
    stdio: "inherit",
    timeout: 180000,
  });
  if (installed.status !== 0) {
    ui.error(`Install exited with code ${installed.status}.`);
    // v1.23.4 — give the right remediation per platform. Windows
    // file-lock + macOS/Linux permission errors look the same to npm
    // but need different fixes.
    if (process.platform === "win32") {
      process.stdout.write(`  ${kleur.gray("On Windows, the running mneme.cmd may be locked by this very process.")}\n`);
      process.stdout.write(`  ${kleur.gray("Workaround: open a NEW PowerShell window and run:")}\n`);
      process.stdout.write(`     ${kleur.cyan().bold("npm install -g --force mneme-ai@" + remote)}\n\n`);
    } else {
      process.stdout.write(`  ${kleur.gray("On Linux/macOS permission issues:  sudo npm install -g mneme-ai@" + remote)}\n\n`);
    }
    return installed.status ?? 1;
  }

  // ── 4. Diagnose PATH for stale binaries (pure JS, no shell) ──────
  process.stdout.write("\n" + section("✦ Diagnosing PATH") + "\n\n");
  const pathHits = findOnPath("mneme");
  if (pathHits.length === 0) {
    process.stdout.write(`    ${kleur.yellow("⚠")}  No \`mneme\` found on PATH after install. Restart your terminal.\n\n`);
  } else if (pathHits.length === 1) {
    process.stdout.write(`    ${kleur.green("✓")}  Single binary on PATH:  ${kleur.gray(pathHits[0]!)}\n\n`);
  } else {
    process.stdout.write(`    ${kleur.yellow("⚠")}  Multiple \`mneme\` binaries on PATH — older ones may run first:\n`);
    for (let i = 0; i < pathHits.length; i++) {
      const tag = i === 0 ? kleur.green("[active]") : kleur.gray("[shadowed]");
      process.stdout.write(`      ${tag} ${pathHits[i]}\n`);
    }
    process.stdout.write(`\n    ${kleur.gray("→ remove the shadowed entries (or reorder PATH) to ensure the global install runs.")}\n\n`);
  }

  // ── 5. Verify by spawning a fresh `mneme --version` ──────────────
  process.stdout.write(section("✦ Verifying installed version") + "\n\n");
  let verified: string | undefined;
  try {
    const out = execSync("mneme --version", {
      encoding: "utf8",
      timeout: 10000,
      // Force a fresh resolution rather than reusing the current process's
      // already-loaded version
      env: { ...process.env },
    });
    verified = out.trim();
  } catch (err) {
    ui.error(`Could not run \`mneme --version\` after install: ${(err as Error).message}`);
    return 1;
  }

  if (verified === remote) {
    // v1.27.4 -- invalidate the version-check cache. Without this, the
    // next pulse / selfcheck run still sees `latest=<old>` from the
    // cache and emits a misleading "(latest: v<old>)" annotation
    // (or worse, a false-positive AUTO-ACTION self-loop pre-v1.27.3).
    // We DELETE the cache file so the next probe forces a fresh fetch
    // from npm.
    try {
      const { unlinkSync, existsSync } = await import("node:fs");
      const { join } = await import("node:path");
      const cachePath = join(process.cwd(), ".mneme/version-check.json");
      if (existsSync(cachePath)) {
        unlinkSync(cachePath);
        process.stdout.write(`    ${pill("CACHE", "ok")}  invalidated .mneme/version-check.json\n`);
      }
    } catch { /* best-effort */ }
    process.stdout.write(`    ${pill("SUCCESS", "ok")}  ${kleur.green().bold(`mneme --version → ${verified}`)}\n\n`);
    return 0;
  }

  // ── 6. Versions still mismatched — concrete remediation ─────────
  process.stdout.write(`    ${pill("MISMATCH", "critical")}  ${kleur.red(`expected ${remote} but got ${verified}`)}\n\n`);
  process.stdout.write(section("✦ Why this happens (and how to fix)") + "\n\n");
  process.stdout.write(`    ${kleur.bold("1. Stale npx cache")} — if you ever ran \`npx mneme-ai\` it's cached.\n`);
  process.stdout.write(`       ${kleur.cyan("npx clear-npx-cache  ||  rm -rf ~/.npm/_npx")}\n\n`);
  process.stdout.write(`    ${kleur.bold("2. Multiple Node versions")} (nvm/fnm/volta) — each has its own globals.\n`);
  process.stdout.write(`       ${kleur.cyan("which node && npm root -g")}  ${kleur.gray("→ verify the install went to the active Node")}\n\n`);
  process.stdout.write(`    ${kleur.bold("3. Shell PATH ordering")} — older binary shadows the new one.\n`);
  process.stdout.write(`       Above: list of mneme binaries. Remove shadowing entries.\n\n`);
  process.stdout.write(`    ${kleur.bold("4. Restart the shell")} — sometimes PATH refresh is needed.\n\n`);
  return 1;
}
