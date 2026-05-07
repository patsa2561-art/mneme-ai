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
import kleur from "kleur";
import { ui, header, section, pill, kv, nextSteps } from "../ui.js";
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
  const cmd = `npm install -g --force mneme-ai@${remote}`;
  process.stdout.write(`    ${kleur.cyan().bold(cmd)}\n`);
  process.stdout.write(`    ${kleur.gray("(--force bypasses npm metadata cache; @<exact> bypasses 'latest' tag staleness)")}\n\n`);

  const installed = spawnSync(cmd, {
    shell: true,
    stdio: "inherit",
    timeout: 180000,
  });
  if (installed.status !== 0) {
    ui.error(`Install exited with code ${installed.status}.`);
    process.stdout.write(`  ${kleur.gray("On permission issues (Linux/macOS), try:  sudo npm install -g mneme-ai@" + remote)}\n\n`);
    return installed.status ?? 1;
  }

  // ── 4. Diagnose PATH for stale binaries ──────────────────────────
  process.stdout.write("\n" + section("✦ Diagnosing PATH") + "\n\n");
  const finder = process.platform === "win32" ? "where" : "which -a";
  let pathHits: string[] = [];
  try {
    const out = execSync(`${finder} mneme`, { encoding: "utf8", timeout: 5000 });
    pathHits = out.trim().split(/\r?\n/).filter(Boolean);
  } catch {
    // Some shells return non-zero if `mneme` isn't found — non-fatal.
  }
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
