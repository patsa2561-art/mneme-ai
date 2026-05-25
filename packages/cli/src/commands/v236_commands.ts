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

/**
 * v2.39.0 — `mneme zzzzz` CLI surface.
 *
 *   mneme zzzzz probe --text "..." | --image <path> | --code "..."
 *   mneme zzzzz arm [--reason "..."]
 *   mneme zzzzz status
 *   mneme zzzzz verdict [--limit N]
 *   mneme zzzzz verify <jsonReport>
 */
export function registerZzzzzCommand(program: Command): void {
  const z = program.command("zzzzz").description("💎 Zzzzz-PROBE (The Sleepwalking Oracle) — multi-modal anti-entropy detector. 4 text + 5 image signals. REFUTED → auto-HGP id.");

  z.command("probe")
    .description("Probe text / code / image for AI-generation signals.")
    .option("--text <text>", "Text/code to analyze.")
    .option("--image <path>", "Image file path to analyze.")
    .option("--code <code>", "Code snippet to analyze (alias for --text but modality=code).")
    .option("--vendor <vendor>", "Vendor id for HGP attribution.")
    .action(async (opts: { text?: string; image?: string; code?: string; vendor?: string }) => {
      try {
        const { readFileSync, existsSync } = await import("node:fs");
        const core = await import("@mneme-ai/core");
        const repoRoot = process.cwd();
        let input: Parameters<typeof core.zzzzzProbe.probeArtifact>[0];
        if (opts.image) {
          if (!existsSync(opts.image)) {
            writeJson({ ok: false, error: `image not found: ${opts.image}` });
            process.exitCode = 1;
            return;
          }
          input = { modality: "image", imageBytes: new Uint8Array(readFileSync(opts.image)) };
        } else if (opts.code) {
          input = { modality: "code", text: opts.code };
        } else if (opts.text) {
          input = { modality: "text", text: opts.text };
        } else {
          writeJson({ ok: false, error: "pass --text, --code, or --image <path>" });
          process.exitCode = 1;
          return;
        }
        if (opts.vendor) input.vendor = opts.vendor;
        const report = await core.zzzzzProbe.probeArtifact(input, repoRoot);
        writeJson({ ok: true, report });
        if (report.verdict === "REFUTED" || report.verdict === "IMPOSSIBLE_REFUTE") process.exitCode = 2;
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  z.command("arm")
    .description("Mark Zzzzz-PROBE armed (advisory).")
    .option("--reason <reason>", "Free-form reason.")
    .action(async (opts: { reason?: string }) => {
      try {
        const core = await import("@mneme-ai/core");
        const state = core.zzzzzProbe.arm(process.cwd(), opts.reason);
        writeJson({ ok: true, state });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  z.command("status")
    .description("Show armed state + OS polygraph classification + ledger size + last verdict.")
    .action(async () => {
      try {
        const core = await import("@mneme-ai/core");
        const repoRoot = process.cwd();
        const armed = core.zzzzzProbe.isArmed(repoRoot);
        const ledger = core.zzzzzProbe.readLedger(repoRoot, 10000);
        const os = await core.zzzzzProbe.classifyOS();
        writeJson({ ok: true, armed, ledgerSize: ledger.length, last: ledger[ledger.length - 1] ?? null, os });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  z.command("verdict")
    .description("Read N most-recent reports from the Zzzzz ledger.")
    .option("--limit <n>", "How many reports. Default 20.", "20")
    .action(async (opts: { limit?: string }) => {
      try {
        const core = await import("@mneme-ai/core");
        const limit = parseInt(opts.limit ?? "20", 10);
        const list = core.zzzzzProbe.readLedger(process.cwd(), Number.isFinite(limit) ? limit : 20);
        writeJson({ ok: true, count: list.length, reports: list });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  z.command("verify <reportJson>")
    .description("Offline HMAC verify of a pasted ZzzzzReport (JSON string).")
    .action(async (reportJson: string) => {
      try {
        const core = await import("@mneme-ai/core");
        const r = JSON.parse(reportJson) as Parameters<typeof core.zzzzzProbe.verifyReport>[0];
        const v = core.zzzzzProbe.verifyReport(r);
        writeJson(v);
        if (!v.ok) process.exitCode = 1;
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });
}

/**
 * v2.40.0 — `mneme argus` CLI surface.
 *
 *   mneme argus eyes                     List the 10-eye bundle + weights.
 *   mneme argus search --query "..." --candidates "a||b||c"
 *                                         10-eyed weighted search;
 *                                         "||"-separated candidates.
 *   mneme argus hydra --strains <json>   Spawn HYDRA eyes from strain JSON.
 *   mneme argus verify --in <json> --out <json>
 *                                         Offline HMAC verify of a result.
 */
export function registerArgusCommand(program: Command): void {
  const a = program.command("argus").description("👁×10 ARGUS-10 — 10-eyed memory search (5 surface + 5 truth) with softmax-rebalancing Guardian + HMAC-signed audit frame. Pure stateless.");

  a.command("eyes")
    .description("List the 10-eye bundle with nominal weights + layers.")
    .action(async () => {
      try {
        const core = await import("@mneme-ai/core");
        const surface = core.argus10.SURFACE_EYES.map((e) => ({ id: e.id, layer: e.layer, weight: e.weight }));
        const truth = core.argus10.TRUTH_EYES.map((e) => ({ id: e.id, layer: e.layer, weight: e.weight }));
        const sum = [...surface, ...truth].reduce((s, e) => s + e.weight, 0);
        writeJson({ ok: true, surface, truth, totalWeight: Number(sum.toFixed(3)) });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  a.command("search")
    .description("Rank candidates against a query with 10 eyes.")
    .option("--query <query>", "User query.")
    .option("--candidates <list>", "Plain text candidates separated by '||' (e.g. 'a||b||c').")
    .option("--candidates-json <json>", "JSON array of {text, meta?} candidates for rich metadata (vendor / recencyDays / inHmacChain / source).")
    .option("--topK <n>", "Cap returned candidates.")
    .action(async (opts: { query?: string; candidates?: string; candidatesJson?: string; topK?: string }) => {
      try {
        const core = await import("@mneme-ai/core");
        const q = opts.query ?? "";
        let cands: Array<{ text: string; meta?: object }> = [];
        if (opts.candidatesJson) {
          try { cands = JSON.parse(opts.candidatesJson) as Array<{ text: string; meta?: object }>; }
          catch (e) { writeJson({ ok: false, error: `--candidates-json invalid: ${(e as Error).message}` }); process.exitCode = 1; return; }
        } else if (opts.candidates) {
          cands = opts.candidates.split("||").map((s) => s.trim()).filter(Boolean).map((t) => ({ text: t }));
        }
        if (!q || cands.length === 0) {
          writeJson({ ok: false, error: "pass --query AND (--candidates 'a||b||c' OR --candidates-json '[{\"text\":\"a\"}]')" });
          process.exitCode = 1;
          return;
        }
        const result = await core.argus10.argusSearch({
          query: q,
          candidates: cands.map((c) => ({ text: String(c.text ?? ""), meta: c.meta as Parameters<typeof core.argus10.argusSearch>[0]["candidates"][number]["meta"] })),
          repoRoot: process.cwd(),
          ...(opts.topK ? { topK: parseInt(opts.topK, 10) } : {}),
        });
        writeJson({ ok: true, result });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  a.command("hydra")
    .description("Spawn HYDRA eyes from AV strains (JSON array).")
    .option("--strains <json>", "JSON array of {name,regex,precision,recall} strains.")
    .action(async (opts: { strains?: string }) => {
      try {
        const core = await import("@mneme-ai/core");
        const arr = opts.strains ? JSON.parse(opts.strains) : [];
        const eyes = core.argus10.autoSpawnHydra(arr);
        writeJson({ ok: true, spawned: eyes.length, eyes: eyes.map((e) => ({ id: e.id, weight: e.weight, layer: e.layer })) });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  a.command("verify")
    .description("Offline HMAC verify of a pasted ArgusSearchResult given its input.")
    .option("--in <json>", "ArgusSearchInput JSON.")
    .option("--out <json>", "ArgusSearchResult JSON.")
    .action(async (opts: { in?: string; out?: string }) => {
      try {
        const core = await import("@mneme-ai/core");
        if (!opts.in || !opts.out) {
          writeJson({ ok: false, error: "pass --in and --out" });
          process.exitCode = 1;
          return;
        }
        const inp = JSON.parse(opts.in) as Parameters<typeof core.argus10.verifyArgusResult>[0];
        const outRes = JSON.parse(opts.out) as Parameters<typeof core.argus10.verifyArgusResult>[1];
        const ok = core.argus10.verifyArgusResult(inp, outRes);
        writeJson({ ok });
        if (!ok) process.exitCode = 1;
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  // v2.41.0 — multimodal subcommand: candidates can be JSON with image+code meta.
  a.command("multimodal")
    .description("ARGUS-11 multimodal search — text + image + code in one ranked result. Includes bloom pre-filter + PHANTOM EYE lazy eval + parallel fan-out. Pass --candidates-json for full Candidate objects with meta.")
    .option("--query <query>", "User query.")
    .option("--candidates <list>", "Plain '||'-separated text candidates.")
    .option("--candidates-json <json>", "JSON array of {text, meta:{codeText?, imageBytes?, imagePath?, vendor?, recencyDays?}}.")
    .option("--topK <n>", "Cap returned candidates.")
    .option("--skip-bloom", "Skip the bloom pre-filter.")
    .option("--skip-phantom", "Skip phantom-eye optimization (always run all eyes).")
    .action(async (opts: { query?: string; candidates?: string; candidatesJson?: string; topK?: string; skipBloom?: boolean; skipPhantom?: boolean }) => {
      try {
        const core = await import("@mneme-ai/core");
        const q = opts.query ?? "";
        if (!q) { writeJson({ ok: false, error: "pass --query" }); process.exitCode = 1; return; }
        let cands: Array<{ text: string; meta?: object }> = [];
        if (opts.candidatesJson) cands = JSON.parse(opts.candidatesJson) as Array<{ text: string; meta?: object }>;
        else if (opts.candidates) cands = opts.candidates.split("||").map((s) => s.trim()).filter(Boolean).map((t) => ({ text: t }));
        if (cands.length === 0) { writeJson({ ok: false, error: "pass --candidates or --candidates-json" }); process.exitCode = 1; return; }
        const input: Parameters<typeof core.argus10.argusSearchMultimodal>[0] = {
          query: q,
          candidates: cands.map((c) => ({ text: c.text, meta: c.meta as Parameters<typeof core.argus10.argusSearchMultimodal>[0]["candidates"][number]["meta"] })),
          repoRoot: process.cwd(),
        };
        if (opts.topK) input.topK = parseInt(opts.topK, 10);
        const r = await core.argus10.argusSearchMultimodal(input, {
          ...(opts.skipBloom ? { skipBloom: true } : {}),
          ...(opts.skipPhantom ? { skipPhantom: true } : {}),
        });
        writeJson({ ok: true, result: r });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  a.command("adapters")
    .description("List ARGUS-11 vendor adapters (editors / web AIs / direct HTTP).")
    .option("--transport <t>", "Filter: mcp | http-bridge | userscript | cli.")
    .action(async (opts: { transport?: string }) => {
      try {
        const core = await import("@mneme-ai/core");
        const t = opts.transport as "mcp" | "http-bridge" | "userscript" | "cli" | undefined;
        const list = t ? core.argus10.adaptersByTransport(t) : core.argus10.listAdapters();
        const live = list.filter((x) => x.status === "live").length;
        writeJson({ ok: true, total: list.length, live, adapters: list });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });
}

/**
 * v2.46.0 — `mneme nemesis` CLI surface.
 *
 *   mneme nemesis classify          --stdin / --json
 *   mneme nemesis verify_identity   --stdin / --claim X
 *   mneme nemesis eu_stamp          --message X --vendor Y
 *   mneme nemesis verify_stamp      --stamped <text>
 *   mneme nemesis install_hook      [--execute]
 *   mneme nemesis env_scan
 */
export function registerNemesisCommand(program: Command): void {
  const n = program.command("nemesis").description("👁 NEMESIS — world's first Anti-Identity-Lie Engine for AI agents. 5 organs: fingerprinter / lie detector / EU AI Act Article 50 stamper / model drift timeline / replay attack detector.");

  async function readStdinJson(): Promise<{ diff?: string; prDescription?: string; commitMessages?: string[]; claimedVendor?: string; fixture?: { diff?: string; prDescription?: string; commitMessages?: string[] } } | null> {
    try {
      const chunks: Buffer[] = [];
      for await (const c of process.stdin) chunks.push(c as Buffer);
      const body = Buffer.concat(chunks).toString("utf8").trim();
      if (!body) return null;
      return JSON.parse(body);
    } catch { return null; }
  }

  n.command("classify")
    .description("Predict the AI vendor from a diff/PR/commits fixture (--stdin: pass JSON {diff,prDescription,commitMessages}). v2.47+ uses CALIBRATED log-likelihood classifier (≥95% accuracy on seed corpus).")
    .option("--stdin", "Read JSON fixture from stdin.")
    .option("--json", "Force JSON output (default already JSON).")
    .option("--heuristic", "Use v2.46.0 heuristic classifier instead of v2.47 calibrated.")
    .action(async (opts: { stdin?: boolean; json?: boolean; heuristic?: boolean }) => {
      try {
        const core = await import("@mneme-ai/core");
        const f = opts.stdin ? await readStdinJson() : null;
        if (!f) { writeJson({ ok: false, error: "pass --stdin with JSON fixture {diff,prDescription,commitMessages}" }); process.exitCode = 1; return; }
        const fp = core.nemesis.extractFingerprint({ diff: f.diff ?? "", prDescription: f.prDescription ?? "", commitMessages: f.commitMessages ?? [] });
        const v = opts.heuristic ? core.nemesis.classifyAgent(fp) : core.nemesis.classifyAgentCalibrated(fp);
        writeJson({ ok: true, result: v, fingerprint: fp });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  n.command("verify_identity")
    .description("Compare claimed vendor vs detected fingerprint; HMAC-signed verdict.")
    .option("--stdin", "Read JSON {claimedVendor, fixture:{diff,prDescription,commitMessages}} from stdin.")
    .option("--claim <vendor>", "Claimed vendor (if not via stdin).")
    .action(async (opts: { stdin?: boolean; claim?: string }) => {
      try {
        const core = await import("@mneme-ai/core");
        const f = opts.stdin ? await readStdinJson() : null;
        const claimedVendor = opts.claim ?? f?.claimedVendor ?? "";
        const fixture = f?.fixture ?? { diff: f?.diff ?? "", prDescription: f?.prDescription ?? "", commitMessages: f?.commitMessages ?? [] };
        if (!claimedVendor) { writeJson({ ok: false, error: "pass --claim <vendor> or --stdin with claimedVendor" }); process.exitCode = 1; return; }
        const r = core.nemesis.verifyIdentityClaim({ claimedVendor, fixture: { diff: fixture.diff ?? "", prDescription: fixture.prDescription ?? "", commitMessages: fixture.commitMessages ?? [] } });
        writeJson({ ok: true, result: r });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  n.command("eu_stamp")
    .description("Append EU AI Act Article 50 disclosure block to a message; HMAC-signed.")
    .option("--message <text>", "The commit message / content to stamp.")
    .option("--vendor <v>", "Vendor that produced the content (claude-code / codex / cursor / copilot / devin).")
    .option("--confidence <n>", "Attribution confidence 0..1.", "0.9")
    .action(async (opts: { message?: string; vendor?: string; confidence?: string }) => {
      try {
        const core = await import("@mneme-ai/core");
        const r = core.nemesis.stampArticle50({
          message: opts.message ?? "",
          vendor: opts.vendor ?? "",
          confidence: parseFloat(opts.confidence ?? "0.9"),
        });
        writeJson(r);
        if (!r.ok) process.exitCode = 1;
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  n.command("verify_stamp")
    .description("Verify a pasted EU AI Act Article 50 stamped message (HMAC check).")
    .option("--stamped <text>", "Stamped message text.")
    .action(async (opts: { stamped?: string }) => {
      try {
        const core = await import("@mneme-ai/core");
        const r = core.nemesis.verifyStamp(opts.stamped ?? "");
        writeJson(r);
        if (!r.valid) process.exitCode = 1;
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  n.command("install_hook")
    .description("Install git prepare-commit-msg hook that auto-stamps every commit with EU AI Act Article 50 disclosure. DRY-RUN default.")
    .option("--execute", "Actually install (default: dry-run shows the plan only).", false)
    .action(async (opts: { execute?: boolean }) => {
      try {
        const core = await import("@mneme-ai/core");
        const r = core.nemesis.installPreCommitHook({ repoRoot: process.cwd(), dryRun: !opts.execute });
        writeJson(r);
        if (!r.ok) process.exitCode = 1;
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  n.command("env_scan")
    .description("Scan process.env for AI-vendor signature markers.")
    .option("--json", "Force JSON output (default already JSON).")
    .action(async () => {
      try {
        const core = await import("@mneme-ai/core");
        writeJson({ ok: true, result: core.nemesis.scanEnv() });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  // v2.47.0 — detect dev-tooling folder (CLI verb wiring closed audit gap).
  n.command("detect_tooling")
    .description("v2.47 — Detect whether the current (or --path) folder is an AI-dev scratch folder vs a real git repo. Heuristic: !isGitRepo && ≥3 AI-fingerprint files at root.")
    .option("--path <dir>", "Folder to check (default: process.cwd()).")
    .option("--json", "Force JSON output.")
    .action(async (opts: { path?: string }) => {
      try {
        const core = await import("@mneme-ai/core");
        const path = opts.path ?? process.cwd();
        const r = core.autoInit.detectDevTooling(path);
        writeJson({ ok: true, path, result: r });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  // v2.47.0 — calibration status (corpus size, accuracy, opt-in state).
  n.command("calibration_status")
    .description("v2.47 — Show NEMESIS calibration corpus size, learning-loop opt-in state, and ≥95% seed accuracy probe.")
    .option("--json", "Force JSON output.")
    .action(async () => {
      try {
        const core = await import("@mneme-ai/core");
        const status = core.nemesis.calibrationStatus(process.cwd());
        const accuracy = core.nemesis.evaluateSeedAccuracy();
        writeJson({ ok: true, result: { ...status, accuracy } });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  // v2.46.0 — relocated `mneme nemesis` engineering-friction-detector
  // (was top-level in v2.45) into `nemesis pairs` subcommand so the
  // parent `nemesis` namespace hosts both legacy + new functionality.
  // ──────────────────────────────────────────────────────────────────
  //  v2.52.0 — Million Dollar Secret diamonds (1-6)
  //  Each diamond inspired by the Netflix identity-deception show:
  //  contestants who hide their identity vs. behavioral-fingerprint
  //  detection. NEMESIS turned into a competitive primitive game.
  // ──────────────────────────────────────────────────────────────────

  // Diamond 1 — STEALTH SCORE + anonymity-credit ledger
  n.command("stealth_score")
    .description("💎1 STEALTH SCORE — inverse of fingerprint confidence. 0=obvious, 1=ghost. Pair with anonymity-credit ledger for tamper-evident anonymity budget. Use --stdin with JSON {diff, prDescription, commitMessages}.")
    .option("--stdin", "Read fixture JSON from stdin")
    .option("--earn", "Earn anonymity credits when band ≥ stealth")
    .option("--context <ref>", "Context ref for ledger row (commit sha / file path)", "stealth_score-cli")
    .action(async (opts: { stdin?: boolean; earn?: boolean; context?: string }) => {
      try {
        const core = await import("@mneme-ai/core");
        const f = opts.stdin ? await readStdinJson() : null;
        if (!f) { writeJson({ ok: false, error: "pass --stdin with JSON fixture {diff, prDescription, commitMessages}" }); process.exitCode = 1; return; }
        const verdict = core.nemesis.computeStealthScore({ diff: f.diff ?? "", prDescription: f.prDescription ?? "", commitMessages: f.commitMessages ?? [] });
        const out: Record<string, unknown> = { ok: true, verdict };
        if (opts.earn) {
          const earn = core.nemesis.earnAnonymityCredits(process.cwd(), verdict, opts.context ?? "cli");
          out.earned = earn;
        }
        writeJson(out);
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  n.command("stealth_spend")
    .description("💎1 STEALTH SCORE — spend anonymity credits to record an anonymization action. Refuses on insufficient balance.")
    .requiredOption("--amount <n>", "Credits to spend", (v) => Number(v))
    .requiredOption("--context <ref>", "What you spent it on (commit sha / disclosure)")
    .action(async (opts: { amount: number; context: string }) => {
      try {
        const core = await import("@mneme-ai/core");
        const out = core.nemesis.spendAnonymityCredits(process.cwd(), opts.amount, opts.context);
        writeJson({ ok: !out.rejected, ...out });
        if (out.rejected) process.exitCode = 1;
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  n.command("stealth_status")
    .description("💎1 STEALTH SCORE — current anonymity-credit balance + total earned/spent + last 10 ledger rows.")
    .action(async () => {
      try {
        const core = await import("@mneme-ai/core");
        const out = core.nemesis.stealthCreditStatus(process.cwd());
        const chain = core.nemesis.verifyStealthLedger(process.cwd());
        writeJson({ ok: chain.ok, ...out, chain });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  // Diamond 2 — CAPILLARY micro-tell fingerprinter
  n.command("capillary")
    .description("💎2 CAPILLARY — extract 50+ MICRO style tells (whitespace / quote / naming / comma / brace) from a diff. Spoof-resistant: vendors must mimic all 50+ tells coherently to fake another vendor. Use --stdin with JSON {diff}.")
    .option("--stdin", "Read JSON {diff} from stdin")
    .option("--top <n>", "Show top-N non-zero features", (v) => Number(v), 15)
    .action(async (opts: { stdin?: boolean; top?: number }) => {
      try {
        const core = await import("@mneme-ai/core");
        const f = opts.stdin ? await readStdinJson() : null;
        if (!f) { writeJson({ ok: false, error: "pass --stdin with JSON {diff: '...'}" }); process.exitCode = 1; return; }
        const profile = core.nemesis.extractMicroProfile(f.diff ?? "");
        const entries = (Object.entries(profile.features) as Array<[string, number]>).filter(([, v]) => v !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
        const top = entries.slice(0, opts.top ?? 15);
        writeJson({ ok: true, language: profile.language, totalLines: profile.totalLines, totalFeatures: Object.keys(profile.features).length, nonZeroFeatures: entries.length, top: Object.fromEntries(top), allFeatures: profile.features });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  n.command("anti_capillary")
    .description("💎2 ANTI-CAPILLARY — given current diff + target vendor profile, suggest rewrites to mask source vendor's micro-tells (privacy primitive). Use --stdin with JSON {current: {diff}, target: {diff}}.")
    .option("--stdin", "Read JSON from stdin")
    .option("--max <n>", "Max hints to return", (v) => Number(v), 10)
    .action(async (opts: { stdin?: boolean; max?: number }) => {
      try {
        const core = await import("@mneme-ai/core");
        const f = opts.stdin ? await readStdinJson() : null;
        if (!f) { writeJson({ ok: false, error: "pass --stdin with JSON {current: {diff}, target: {diff}}" }); process.exitCode = 1; return; }
        const cur = core.nemesis.extractMicroProfile((f as { current?: { diff?: string } }).current?.diff ?? "");
        const tgt = core.nemesis.extractMicroProfile((f as { target?: { diff?: string } }).target?.diff ?? "");
        const distance = core.nemesis.microDistance(cur, tgt);
        const hints = core.nemesis.suggestAntiCapillary(cur, tgt, { maxHints: opts.max ?? 10 });
        writeJson({ ok: true, distance, hintsCount: hints.length, hints });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  // Diamond 3 — COLOSSEUM auto-tournament + 3-axis leaderboard
  n.command("colosseum")
    .description("💎3 COLOSSEUM — auto-tournament: each contender wears every other vendor's disguise + NEMESIS classifies. ELO + 3-axis (deception/detectability/mimicry) HMAC leaderboard. Use --stdin with JSON {contenders: [{realVendor, alias?, fixture: {diff, prDescription, commitMessages}}, ...]}.")
    .option("--stdin", "Read contenders JSON from stdin")
    .option("--no-persist", "Run dry; do not write to .mneme/nemesis/colosseum/")
    .option("--tournament-id <id>", "Override tournament id")
    .action(async (opts: { stdin?: boolean; persist?: boolean; tournamentId?: string }) => {
      try {
        const core = await import("@mneme-ai/core");
        const f = opts.stdin ? await readStdinJson() : null;
        if (!f) { writeJson({ ok: false, error: "pass --stdin with JSON {contenders: [{realVendor, alias?, fixture:{...}}]}" }); process.exitCode = 1; return; }
        const contenders = (f as { contenders?: unknown }).contenders;
        if (!Array.isArray(contenders) || contenders.length < 2) {
          writeJson({ ok: false, error: "contenders must be an array of ≥ 2" });
          process.exitCode = 1; return;
        }
        const result = core.nemesis.runTournament(process.cwd(), contenders as Parameters<typeof core.nemesis.runTournament>[1], { tournamentId: opts.tournamentId, persist: opts.persist !== false });
        writeJson({ ok: true, tournamentId: result.tournamentId, rounds: result.rounds, champion: result.champion, leaderboard: result.leaderboard, hmac: result.hmac, eventCount: result.events.length });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  n.command("colosseum_board")
    .description("💎3 COLOSSEUM — read current leaderboard (signed) + total events.")
    .action(async () => {
      try {
        const core = await import("@mneme-ai/core");
        const b = core.nemesis.readColosseumLeaderboard(process.cwd());
        const chain = core.nemesis.verifyColosseumChain(process.cwd());
        writeJson({ ok: chain.ok, ...b, chain });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  n.command("colosseum_replay")
    .description("💎3 COLOSSEUM — spectator mode: replay last N events from the tournament chain.")
    .option("--n <n>", "Number of events to replay", (v) => Number(v), 20)
    .action(async (opts: { n?: number }) => {
      try {
        const core = await import("@mneme-ai/core");
        const events = core.nemesis.spectatorReplay(process.cwd(), opts.n ?? 20);
        writeJson({ ok: true, eventCount: events.length, events });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  // Diamond 4 — MOLT silent model-rotation detector
  n.command("molt")
    .description("💎4 MOLT — silent-model-rotation detector. Reads drift-<vendor>.jsonl ledger, splits into prior/post windows, surfaces dominant Welch-style feature shifts (z≥3.0). HMAC-signed forensic verdict. Use --vendor + (optional) --since-ms / --min-z.")
    .requiredOption("--vendor <id>", "Vendor to inspect (e.g. cursor, claude-code)")
    .option("--since-ms <ms>", "Filter entries newer than this epoch ms", (v) => Number(v))
    .option("--min-z <n>", "Minimum z-score for shift to be dominant", (v) => Number(v), 3.0)
    .option("--webhook <url>", "POST signed verdict JSON to this URL on molt detected")
    .action(async (opts: { vendor: string; sinceMs?: number; minZ?: number; webhook?: string }) => {
      try {
        const core = await import("@mneme-ai/core");
        const v = core.nemesis.detectMolt(process.cwd(), opts.vendor, {
          sinceMs: opts.sinceMs,
          minZ: opts.minZ ?? 3.0,
        });
        const out: Record<string, unknown> = { ok: true, verdict: v };
        if (opts.webhook && v.molted) {
          const w = await core.nemesis.emitMoltWebhook(v, opts.webhook);
          out.webhook = w;
        }
        writeJson(out);
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  n.command("molt_verify")
    .description("💎4 MOLT — verify the HMAC on a MoltVerdict JSON. Use --stdin with a verdict body.")
    .option("--stdin", "Read MoltVerdict JSON from stdin")
    .action(async (opts: { stdin?: boolean }) => {
      try {
        const core = await import("@mneme-ai/core");
        const v = opts.stdin ? await readStdinJson() : null;
        if (!v) { writeJson({ ok: false, error: "pass --stdin with MoltVerdict JSON" }); process.exitCode = 1; return; }
        const valid = core.nemesis.verifyMoltVerdict(v as Parameters<typeof core.nemesis.verifyMoltVerdict>[0]);
        writeJson({ ok: valid, valid });
        if (!valid) process.exitCode = 1;
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  // Diamond 5 — THEMIS alibi verifier
  n.command("themis")
    .description("💎5 THEMIS — alibi verifier: prove a fixture is NOT vendor X. Returns star-rated evidence + HMAC-signed ALIBI_CONFIRMED/DENIED/INCONCLUSIVE. EU AI Act compliance defense primitive. Use --stdin with JSON {notVendor, fixture}.")
    .option("--stdin", "Read JSON {notVendor, fixture:{diff, prDescription, commitMessages}} from stdin")
    .option("--not-vendor <id>", "Override: vendor you are denying (if not via stdin)")
    .option("--min-stars <n>", "Minimum stars to include feature in evidence", (v) => Number(v), 3)
    .action(async (opts: { stdin?: boolean; notVendor?: string; minStars?: number }) => {
      try {
        const core = await import("@mneme-ai/core");
        const j = opts.stdin ? await readStdinJson() : null;
        const notVendor = opts.notVendor ?? (j as { notVendor?: string } | null)?.notVendor;
        if (!notVendor) { writeJson({ ok: false, error: "missing notVendor (pass --not-vendor or via --stdin JSON)" }); process.exitCode = 1; return; }
        const fixture = (j as { fixture?: { diff?: string; prDescription?: string; commitMessages?: string[] } } | null)?.fixture;
        if (!fixture) { writeJson({ ok: false, error: "missing fixture (pass via --stdin JSON)" }); process.exitCode = 1; return; }
        const r = core.nemesis.verifyAlibi({
          notVendor,
          fixture: { diff: fixture.diff ?? "", prDescription: fixture.prDescription ?? "", commitMessages: fixture.commitMessages ?? [] },
          minStars: opts.minStars,
        });
        writeJson({ ok: true, result: r });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  n.command("themis_verify")
    .description("💎5 THEMIS — verify HMAC on a ThemisResult JSON. Use --stdin.")
    .option("--stdin", "Read ThemisResult JSON from stdin")
    .action(async (opts: { stdin?: boolean }) => {
      try {
        const core = await import("@mneme-ai/core");
        const j = opts.stdin ? await readStdinJson() : null;
        if (!j) { writeJson({ ok: false, error: "pass --stdin with ThemisResult JSON" }); process.exitCode = 1; return; }
        const valid = core.nemesis.verifyAlibiSignature(j as Parameters<typeof core.nemesis.verifyAlibiSignature>[0]);
        writeJson({ ok: valid, valid });
        if (!valid) process.exitCode = 1;
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  // Diamond 6 — SIBYL ZK identity commitment
  n.command("sibyl_commit")
    .description("💎6 SIBYL — commit identity at session start (hash-commitment: SHA-256(identity||nonce||sessionId)). Returns commitment + nonce (save it; needed to reveal). Supports nested commits via --no-* flags.")
    .requiredOption("--vendor <id>", "Vendor identity to commit")
    .option("--model <name>", "Optional model identity to nest in commit")
    .option("--version <v>", "Optional version identity to nest in commit")
    .option("--session-id <id>", "Override session id (default auto)")
    .option("--no-persist", "Do not persist commitment to .mneme/nemesis/sibyl/")
    .action(async (opts: { vendor: string; model?: string; version?: string; sessionId?: string; persist?: boolean }) => {
      try {
        const core = await import("@mneme-ai/core");
        const r = core.nemesis.commitIdentity(process.cwd(), {
          identity: { vendor: opts.vendor, model: opts.model, version: opts.version },
          sessionId: opts.sessionId,
          persist: opts.persist !== false,
        });
        writeJson({ ok: true, commitment: r.commitment, nonce: r.nonce, identitySnapshot: r.identitySnapshot, hint: "SAVE the nonce — it is required at reveal time and is NOT recoverable." });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  n.command("sibyl_reveal")
    .description("💎6 SIBYL — reveal identity at session end. Recomputes commitment hash from (identity, nonce, sessionId) and verifies it matches the original. Use --stdin with JSON {sessionId, identity, nonce}.")
    .option("--stdin", "Read reveal JSON from stdin")
    .option("--no-persist", "Do not persist the reveal to chain")
    .action(async (opts: { stdin?: boolean; persist?: boolean }) => {
      try {
        const core = await import("@mneme-ai/core");
        const j = opts.stdin ? await readStdinJson() : null;
        if (!j) { writeJson({ ok: false, error: "pass --stdin with JSON {sessionId, identity:{vendor[,model][,version]}, nonce}" }); process.exitCode = 1; return; }
        const payload = j as { sessionId?: string; identity?: { vendor?: string; model?: string; version?: string }; nonce?: string };
        if (!payload.sessionId || !payload.identity || !payload.nonce) {
          writeJson({ ok: false, error: "sessionId / identity / nonce all required" }); process.exitCode = 1; return;
        }
        const r = core.nemesis.revealIdentity(process.cwd(), {
          sessionId: payload.sessionId,
          identity: { vendor: payload.identity.vendor ?? "", model: payload.identity.model, version: payload.identity.version },
          nonce: payload.nonce,
          persist: opts.persist !== false,
        });
        writeJson({ ok: r.matches, ...r });
        if (!r.matches) process.exitCode = 1;
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  n.command("sibyl_chain")
    .description("💎6 SIBYL — verify HMAC chain on commitments + reveals; list open (un-revealed) commitments.")
    .action(async () => {
      try {
        const core = await import("@mneme-ai/core");
        const chain = core.nemesis.verifySibylChain(process.cwd());
        const open = core.nemesis.listOpenCommitments(process.cwd());
        writeJson({ ok: chain.ok, chain, openCommitments: open });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  // ──────────────────────────────────────────────────────────────────
  //  v2.53.0 — PATCH OPEN WOUNDS (P0/P1)
  //  Adds key wizard, augmented-corpus accuracy probe, JANUS organ,
  //  release-gate threshold knob, wiring-lag gate, catalog count.
  // ──────────────────────────────────────────────────────────────────

  n.command("key_setup")
    .description("v2.53 P0-1 HMAC key wizard — generate a 64-char hex key in .mneme/nemesis/hmac.key (mode 0600) OR ~/.mneme/nemesis/hmac.key. Idempotent (skips if env var already set or key already present).")
    .option("--target <where>", "Where to write: 'repo' (default) or 'user'", (v) => v as "repo" | "user", "repo")
    .option("--force", "Overwrite existing key (dangerous — invalidates past receipts)", false)
    .option("--dry-run", "Compute path + key length without writing", false)
    .action(async (opts: { target?: "repo" | "user"; force?: boolean; dryRun?: boolean }) => {
      try {
        const core = await import("@mneme-ai/core");
        const r = core.nemesis.runKeyWizard({
          repoRoot: process.cwd(),
          target: opts.target ?? "repo",
          force: opts.force ?? false,
          dryRun: opts.dryRun ?? false,
        });
        writeJson(r);
        if (!r.ok) process.exitCode = 1;
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  n.command("key_check")
    .description("v2.53 P0-1 — verify HMAC key permissions + STRICT mode status.")
    .action(async () => {
      try {
        const core = await import("@mneme-ai/core");
        const perms = core.nemesis.checkKeyPermissions(process.cwd());
        let strict: { ok: boolean; usingDefault: boolean; message: string } | { error: string };
        try { strict = core.nemesis.strictKeyCheck(process.cwd()); }
        catch (e) { strict = { error: (e as Error).message }; }
        writeJson({ ok: perms.ok, permissions: perms, strict });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  n.command("classify_augmented")
    .description("v2.53 P1-2 — evaluate calibrated classifier on 6x-augmented corpus (header-less + naturalistic + sparse + dense + whitespace noise). Reports per-kind accuracy + sample failures.")
    .option("--max-failing <n>", "Max failures to surface", (v) => Number(v), 10)
    .action(async (opts: { maxFailing?: number }) => {
      try {
        const core = await import("@mneme-ai/core");
        const r = core.nemesis.evaluateAugmentedAccuracy({ maxFailing: opts.maxFailing ?? 10 });
        writeJson({ ok: r.accuracy >= 0.85, ...r });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  n.command("janus_observe")
    .description("v2.53 P1-3 JANUS — locate which vendor cluster a fixture's fingerprint sits in (basin + margin to second-nearest). Use --stdin with JSON {diff, prDescription, commitMessages}.")
    .option("--stdin", "Read fixture from stdin")
    .action(async (opts: { stdin?: boolean }) => {
      try {
        const core = await import("@mneme-ai/core");
        const f = opts.stdin ? await readStdinJson() : null;
        if (!f) { writeJson({ ok: false, error: "pass --stdin with JSON fixture" }); process.exitCode = 1; return; }
        const obs = core.nemesis.observe({ diff: f.diff ?? "", prDescription: f.prDescription ?? "", commitMessages: f.commitMessages ?? [] });
        writeJson({ ok: true, observation: obs });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  n.command("janus_swap")
    .description("v2.53 P1-3 JANUS — given a SEQUENCE of fixtures (JSON array), detect cross-cluster boundary transitions ('Eve started looking like Codex mid-session'). HMAC-signed verdict.")
    .option("--stdin", "Read JSON {fixtures: [{diff, prDescription, commitMessages}, ...]} from stdin")
    .option("--min-margin <n>", "Minimum margin to second-nearest for swap to count", (v) => Number(v), 0.5)
    .action(async (opts: { stdin?: boolean; minMargin?: number }) => {
      try {
        const core = await import("@mneme-ai/core");
        const f = opts.stdin ? await readStdinJson() : null;
        const fixtures = (f as { fixtures?: Array<{ diff?: string; prDescription?: string; commitMessages?: string[] }> } | null)?.fixtures;
        if (!Array.isArray(fixtures) || fixtures.length < 2) {
          writeJson({ ok: false, error: "fixtures array of ≥2 required" }); process.exitCode = 1; return;
        }
        const obs = fixtures.map((fx) => core.nemesis.observe({ diff: fx.diff ?? "", prDescription: fx.prDescription ?? "", commitMessages: fx.commitMessages ?? [] }));
        const r = core.nemesis.detectIdentitySwap(obs, { minMargin: opts.minMargin });
        writeJson({ ok: true, swap: r });
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  n.command("cleanse_ledger")
    .description("v2.50.0 — RETROACTIVE LEDGER CLEANSE: coerce historical embedder-leak rows in .mneme/cli-activity.jsonl to vendor:'unknown' + re-chain HMACs + back up original to .pre-v50.bak. Idempotent.")
    .option("--dry-run", "Compute the plan without writing.", false)
    .option("--no-rechain", "Skip HMAC re-chaining (drops prev/hmac fields).", false)
    .action(async (opts: { dryRun?: boolean; rechain?: boolean }) => {
      try {
        const core = await import("@mneme-ai/core");
        const km = core.nemesis.resolveHmacKey(process.cwd());
        const r = core.nemesis.cleanseLedger({
          repoRoot: process.cwd(),
          hmacKey: (opts.rechain === false) ? undefined : km.key,
          dryRun: opts.dryRun ?? false,
        });
        writeJson(r);
        if (!r.ok) process.exitCode = 1;
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });

  n.command("pairs")
    .description("Engineering friction detector — pairs of authors who consistently revert/rewrite each other's work (use for team formation, NOT performance reviews).")
    .option("--top <n>", "show top-N friction pairs", (v) => Number(v), 5)
    .option("--window <days>", "consider only events within N days", (v) => Number(v), 365)
    .option("--author <email>", "filter pairs containing this author")
    .option("--json", "machine-readable output", false)
    .option("--verbose", "expand the details tier", false)
    .action(async (opts: { top?: number; window?: number; author?: string; json?: boolean; verbose?: boolean }) => {
      try {
        const { nemesisCommand } = await import("./nemesis.js");
        process.exit(
          await nemesisCommand({
            cwd: process.cwd(),
            topN: opts.top,
            windowDays: opts.window,
            authorFilter: opts.author,
            json: opts.json,
            verbose: opts.verbose,
          }),
        );
      } catch (e) {
        writeJson({ ok: false, error: (e as Error).message });
        process.exitCode = 1;
      }
    });
}
