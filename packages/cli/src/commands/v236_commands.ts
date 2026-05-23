/**
 * v2.36.0 — CLI surfaces for HONEST RECEIPT + DOCTOR + WIRING-PROOF.
 *
 * Closes audit-card visibility gaps:
 *   #14 — `mneme wiring_proof` CLI missing (dogfood gap)
 *   #4  — `mneme doctor scan` surface for multi-install
 *   #19 — same: actionability for ambiguous PATH installs
 *   #22 — `mneme honest latency` exposes the real path histogram
 *
 * Every handler is wrapped in try/catch so a bad fs/spawn never
 * crashes the CLI — we always return a structured error to stdout.
 */

import type { Command } from "commander";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

function writeJson(obj: unknown): void {
  try { process.stdout.write(JSON.stringify(obj, null, 2) + "\n"); } catch { /* swallow */ }
}

/**
 * `mneme honest receipt` — snapshot install + emit a sample receipt.
 * `mneme honest latency` — aggregate latency stats from the ledger.
 * `mneme honest verify --receipt <jsonPath>` — offline HMAC verify.
 */
export function registerHonestCommand(program: Command): void {
  const honest = program.command("honest").description("HONEST RECEIPT — tamper-evident snapshots of what Mneme actually ran (install path + version + code path + latency). Closes the marketing-vs-reality drift class.");

  honest.command("snapshot")
    .description("Snapshot the current install (paths, versions, multi-install detection) + emit JSON.")
    .action(async () => {
      try {
        const core = await import("@mneme-ai/core");
        const snap = core.honestReceipt.snapshotInstall();
        writeJson({ ok: true, install: snap });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  honest.command("receipt")
    .description("Build a sample HONEST RECEIPT (snapshot + dummy latency) — useful for testing the format.")
    .action(async () => {
      try {
        const t0 = Date.now();
        const core = await import("@mneme-ai/core");
        const snap = core.honestReceipt.snapshotInstall();
        const totalMs = Date.now() - t0;
        const receipt = core.honestReceipt.buildReceipt({
          cmd: "honest.receipt",
          args: [],
          install: snap,
          latency: {
            totalMs, fastPathMs: 0, fullLoadMs: totalMs,
            codePath: "full-cli",
            pathReason: "honest.receipt sample (full Node load by construction)",
          },
        });
        // Persist + return.
        const repoRoot = resolve(process.cwd());
        const writeResult = core.honestReceipt.appendReceipt(repoRoot, receipt);
        writeJson({ ok: true, receipt, persisted: writeResult });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  honest.command("latency")
    .description("Read latency stats from the receipt ledger (median + p95 + path histogram).")
    .action(async () => {
      try {
        const core = await import("@mneme-ai/core");
        const ledger = core.honestReceipt.readLedger(resolve(process.cwd()), 10000);
        const stats = core.honestReceipt.aggregateLatency(ledger);
        writeJson({ ok: true, ledgerSize: ledger.length, stats });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  honest.command("verify <receiptJson>")
    .description("Offline HMAC verify of a JSON-encoded HonestReceipt.")
    .action(async (receiptJson: string) => {
      try {
        const core = await import("@mneme-ai/core");
        const parsed = JSON.parse(receiptJson) as Parameters<typeof core.honestReceipt.verifyReceipt>[0];
        const r = core.honestReceipt.verifyReceipt(parsed);
        writeJson(r);
        if (!r.ok) process.exitCode = 1;
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });
}

/**
 * `mneme doctor scan` — surface DOCTOR ORGAN findings (multi-install,
 * PATH ambiguity, version mismatch) via CLI. Wired with the HONEST
 * RECEIPT snapshot to provide actionable remediation per row.
 */
export function registerDoctorCommand(program: Command): void {
  // v2.36.0 — `doctor_install` (not `doctor`) since v1.23.1 already owns
  // `doctor` for the env-probe + version-check surface. This new noun is
  // specifically the multi-install / PATH-ambiguity surface.
  const doctor = program.command("doctor_install").description("DOCTOR_INSTALL — diagnose Mneme install (multi-install detection, PATH ambiguity, version mismatch). Distinct from `mneme doctor` which probes Ollama / OpenAI / hardware.");

  doctor.command("fix")
    .description("v2.37.0 — auto-resolve multi-install ambiguity. Default: DRY RUN (--dry-run by default; pass --execute to actually uninstall). Keeps the newest install + uninstalls older / stale ones via `npm uninstall -g mneme-ai --prefix <p>`.")
    .option("--execute", "Actually run the uninstall commands (otherwise dry-run only).", false)
    .option("--keep <path>", "Override which install to keep (default: newest version).")
    .action(async (opts: { execute?: boolean; keep?: string }) => {
      try {
        const core = await import("@mneme-ai/core");
        const snap = core.honestReceipt.snapshotInstall();
        if (!snap.multiVersionDetected && snap.otherInstalls.length === 0) {
          writeJson({ ok: true, action: "noop", reason: "single install — nothing to fix", install: snap });
          return;
        }
        // Build candidate list with parsed semver for "newest" selection.
        const all = [
          { path: snap.packagePath ?? "", version: snap.packageVersion ?? "0.0.0" },
          ...snap.otherInstalls.map((o) => ({ path: o.path, version: o.version ?? "0.0.0" })),
        ].filter((x) => x.path);
        // "Keep" is either the user-specified path OR the highest semver.
        let keep = opts.keep ? all.find((c) => c.path === opts.keep) : undefined;
        if (!keep) {
          keep = all.slice().sort((a, b) => {
            const pa = a.version.split(".").map((n) => parseInt(n, 10) || 0);
            const pb = b.version.split(".").map((n) => parseInt(n, 10) || 0);
            for (let i = 0; i < 3; i++) {
              if ((pb[i] ?? 0) !== (pa[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0);
            }
            return 0;
          })[0];
        }
        const toRemove = all.filter((c) => c.path !== keep!.path);
        const plan: Array<{ path: string; version: string; npmPrefix: string; cmd: string; executed: boolean; ok?: boolean; stderr?: string }> = [];
        for (const r of toRemove) {
          // Derive npm prefix from package.json path: <prefix>/node_modules/mneme-ai/package.json
          const idx = r.path.lastIndexOf("node_modules");
          const prefix = idx > 0 ? r.path.slice(0, idx).replace(/[\\/]+$/, "") : "";
          if (!prefix) {
            plan.push({ path: r.path, version: r.version, npmPrefix: "?", cmd: "(skipped: cannot derive prefix)", executed: false });
            continue;
          }
          const cmd = `npm uninstall -g mneme-ai --prefix "${prefix}"`;
          if (!opts.execute) {
            plan.push({ path: r.path, version: r.version, npmPrefix: prefix, cmd, executed: false });
            continue;
          }
          try {
            const { spawnSync } = await import("node:child_process");
            const sr = spawnSync("npm", ["uninstall", "-g", "mneme-ai", "--prefix", prefix], { encoding: "utf8", timeout: 60_000 });
            const ok = sr.status === 0;
            plan.push({ path: r.path, version: r.version, npmPrefix: prefix, cmd, executed: true, ok, ...(ok ? {} : { stderr: (sr.stderr ?? "").slice(0, 300) }) });
          } catch (e) {
            plan.push({ path: r.path, version: r.version, npmPrefix: prefix, cmd, executed: true, ok: false, stderr: (e as Error).message });
          }
        }
        writeJson({
          ok: true,
          action: opts.execute ? "executed" : "dry-run",
          keep: { path: keep!.path, version: keep!.version },
          plan,
          headline: opts.execute
            ? `Executed ${plan.filter((p) => p.executed && p.ok).length} of ${plan.length} uninstalls; kept ${keep!.version} at ${keep!.path}`
            : `DRY RUN — would uninstall ${plan.length} stale install(s); kept ${keep!.version} at ${keep!.path}. Re-run with --execute to apply.`,
          nextAction: opts.execute
            ? "Re-run `mneme doctor_install scan` to verify single-install state."
            : "Run `mneme doctor_install fix --execute` to apply.",
        });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  doctor.command("scan")
    .description("Scan every known npm prefix for mneme-ai installs + flag ambiguity.")
    .action(async () => {
      try {
        const core = await import("@mneme-ai/core");
        const snap = core.honestReceipt.snapshotInstall();
        const findings: Array<{ severity: string; finding: string; action: string }> = [];
        if (snap.multiVersionDetected) {
          findings.push({
            severity: "warn",
            finding: `multi-install: ${snap.otherInstalls.length + 1} mneme-ai installs across distinct versions`,
            action: "Pick one canonical install; remove others via `npm uninstall -g mneme-ai` from the unwanted prefix, then re-test `mneme --version`.",
          });
        }
        if (!snap.packageVersion) {
          findings.push({
            severity: "block",
            finding: "could not resolve mneme-ai package.json from bin shim",
            action: "Reinstall via `npm install -g mneme-ai@latest`.",
          });
        }
        for (const o of snap.otherInstalls) {
          if (o.version && snap.packageVersion && o.version !== snap.packageVersion) {
            findings.push({
              severity: "warn",
              finding: `secondary install at ${o.path} has version ${o.version} (primary: ${snap.packageVersion})`,
              action: `Either uninstall via that prefix, or remove from PATH so \`mneme\` resolves uniquely.`,
            });
          }
        }
        writeJson({ ok: true, install: snap, findings, summary: findings.length === 0 ? "Clean — single install, no ambiguity." : `${findings.length} finding(s)` });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });
}

/**
 * `mneme wiring_proof check` — runs subprocess assertions against this
 * CLI to prove Layer-0 wiring works end-to-end (paradox detector,
 * fake-hash oracle, truncation surface). Closes audit-card #14 — the
 * test pattern existed in v2.35.0 but had no CLI surface, so users
 * couldn't run it.
 */
export function registerWiringProofCommand(program: Command): void {
  const wp = program.command("wiring_proof").description("WIRING-PROOF — runs subprocess checks that prove Mneme's user-visible CLI surface still wires to its core fixes (closes the WIRING LAG bug class).");

  wp.command("check")
    .description("Fire 3 quick subprocess checks (paradox / fake-hash / truncation) against THIS CLI and report.")
    .action(async () => {
      try {
        const bin = process.argv[1] ?? "mneme";
        const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

        // Check 1 — self-paradox headline
        const c1 = spawnSync(process.execPath, [bin, "verify", "this statement is false", "--json"], {
          encoding: "utf8", timeout: 30_000,
          env: { ...process.env, MNEME_MUSCLE_BYPASS: "0", NO_COLOR: "1" },
        });
        try {
          const j = JSON.parse(c1.stdout ?? "") as { headline?: string };
          const ok = /SELF-PARADOX/i.test(j.headline ?? "");
          checks.push({ name: "self-paradox-headline", ok, detail: ok ? "SELF-PARADOX headline surfaced" : `headline was: ${j.headline ?? "(missing)"}` });
        } catch (e) {
          checks.push({ name: "self-paradox-headline", ok: false, detail: `parse error: ${(e as Error).message}` });
        }

        // Check 2 — fake commit hash REFUTED
        const c2 = spawnSync(process.execPath, [bin, "verify", "commit a1b2c3d4 fixed the auth bug", "--json"], {
          encoding: "utf8", timeout: 30_000,
          env: { ...process.env, MNEME_MUSCLE_BYPASS: "0", NO_COLOR: "1" },
        });
        try {
          const j = JSON.parse(c2.stdout ?? "") as { verdict?: string; acgv?: { caveats?: string[] } };
          const caveats = j.acgv?.caveats ?? [];
          const ok = /IMPOSSIBLE|REFUTED/i.test(j.verdict ?? "") || caveats.some((c) => c.startsWith("FAKE_COMMIT_HASH"));
          checks.push({ name: "fake-commit-hash", ok, detail: ok ? "FAKE_COMMIT_HASH oracle fired" : `verdict was: ${j.verdict ?? "(missing)"}` });
        } catch (e) {
          checks.push({ name: "fake-commit-hash", ok: false, detail: `parse error: ${(e as Error).message}` });
        }

        // Check 3 — truncation headline
        const giant = "x ".repeat(5000);
        const c3 = spawnSync(process.execPath, [bin, "verify", giant, "--json"], {
          encoding: "utf8", timeout: 60_000,
          env: { ...process.env, MNEME_MUSCLE_BYPASS: "0", NO_COLOR: "1" },
        });
        try {
          const j = JSON.parse(c3.stdout ?? "") as { headline?: string; acgv?: { caveats?: string[] } };
          const ok = /truncated/i.test(j.headline ?? "") || (j.acgv?.caveats ?? []).some((c) => c.startsWith("INPUT_TRUNCATED"));
          checks.push({ name: "truncation-surface", ok, detail: ok ? "truncation surfaced in headline / caveat" : `headline was: ${j.headline ?? "(missing)"}` });
        } catch (e) {
          checks.push({ name: "truncation-surface", ok: false, detail: `parse error: ${(e as Error).message}` });
        }

        const pass = checks.filter((c) => c.ok).length;
        writeJson({
          ok: pass === checks.length,
          pass, total: checks.length,
          headline: pass === checks.length
            ? `🟢 WIRING-PROOF — ${pass}/${checks.length} checks pass`
            : `🔴 WIRING-PROOF — ${pass}/${checks.length} (wiring lag detected)`,
          checks,
        });
        if (pass !== checks.length) process.exitCode = 1;
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  wp.command("list")
    .description("List the wiring-proof checks Mneme runs.")
    .action(() => {
      writeJson({
        ok: true,
        checks: [
          { name: "self-paradox-headline", what: "`mneme verify 'this statement is false' --json` → headline contains SELF-PARADOX" },
          { name: "fake-commit-hash",      what: "`mneme verify 'commit a1b2c3d4 fixed auth' --json` → IMPOSSIBLE_REFUTE + FAKE_COMMIT_HASH caveat" },
          { name: "truncation-surface",    what: "`mneme verify <10K claim> --json` → INPUT_TRUNCATED caveat OR truncation headline" },
        ],
      });
    });
}

// (intentionally no further exports)
