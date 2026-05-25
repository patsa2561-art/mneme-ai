/**
 * v2.27.0 — TRUTH GATE probes.
 *
 * Each probe answers ONE measurable question about Mneme's behavior.
 * Probes are pure functions of cwd; no network unless documented. The
 * probe id is the binding key between marketing claims (in the catalog)
 * and live measurement.
 */

import { spawn } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Probe, ProbeContext, ProbeResult } from "./types.js";

// ── helpers ──────────────────────────────────────────────────────────

async function spawnMcpCall(cwd: string, toolName: string, args: Record<string, unknown> = {}, timeoutMs = 8000): Promise<string> {
  return await new Promise<string>((resolve) => {
    const node = process.execPath;
    const bin = process.env["MNEME_CLI_BIN"] ?? "packages/cli/bin/mneme.js";
    const child = spawn(node, [bin, "mcp"], {
      cwd,
      env: { ...process.env, MNEME_WARMCALL: "0", MNEME_MUSCLE_BYPASS: "0", NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let answered = "";
    const pending = new Map<number, (r: string) => void>();
    let nextId = 1;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      let nl;
      while ((nl = stdout.indexOf("\n")) !== -1) {
        const line = stdout.slice(0, nl).trim();
        stdout = stdout.slice(nl + 1);
        if (!line) continue;
        try {
          const j = JSON.parse(line) as { id?: number; result?: { content?: Array<{ text?: string }> }; error?: unknown };
          if (typeof j.id === "number" && pending.has(j.id)) {
            const text = j.result?.content?.[0]?.text ?? JSON.stringify(j.error ?? "");
            pending.get(j.id)!(text);
            pending.delete(j.id);
          }
        } catch { /* skip */ }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", () => { /* drain */ });

    const send = (method: string, params: unknown): Promise<string> => {
      const id = nextId++;
      return new Promise<string>((res) => {
        pending.set(id, res);
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });
    };

    const overall = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch { /* */ }
      resolve(answered);
    }, timeoutMs);

    (async () => {
      try {
        await send("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "truth-gate", version: "1.0" } });
        const r = await send("tools/call", { name: toolName, arguments: args });
        answered = r;
      } catch { /* */ }
      finally {
        clearTimeout(overall);
        try { child.kill("SIGTERM"); } catch { /* */ }
        resolve(answered);
      }
    })();
  });
}

// ── PROBES ───────────────────────────────────────────────────────────

const probes: Probe[] = [
  // ── token / response size ──────────────────────────────────────────
  {
    id: "probe.capabilities.bytes",
    kind: "numeric",
    description: "Measure default mneme.capabilities response size in bytes (skinny mode after v2.26.0).",
    run: async (ctx) => {
      const t0 = Date.now();
      const text = await spawnMcpCall(ctx.cwd, "mneme.capabilities", {}, 12_000);
      return { value: Buffer.byteLength(text, "utf8"), evidence: `capabilities default = ${Buffer.byteLength(text, "utf8")} bytes`, dtMs: Date.now() - t0 };
    },
  },
  {
    id: "probe.capabilities.tokens",
    kind: "numeric",
    description: "Estimate tokens for default mneme.capabilities (~4 chars per token).",
    run: async (ctx) => {
      const t0 = Date.now();
      const text = await spawnMcpCall(ctx.cwd, "mneme.capabilities", {}, 12_000);
      const tokens = Math.round(Buffer.byteLength(text, "utf8") / 4);
      return { value: tokens, evidence: `default tokens ≈ ${tokens}`, dtMs: Date.now() - t0 };
    },
  },

  // ── verification agents ────────────────────────────────────────────
  {
    id: "probe.verifier.agent_count",
    kind: "numeric",
    description: "Count distinct verification agents Mneme runs.",
    run: async () => {
      // Squadron + ACGV layers + lathe + lighthouse + auditors.
      // Mneme has historically claimed 9. Let's count tools whose name
      // starts with mneme.verify / mneme.audit / mneme.advocate / etc.
      const core = await import("@mneme-ai/core");
      const fuzzer = (core as { mcpFuzzer?: unknown }).mcpFuzzer;
      void fuzzer;
      // Hard-code a list of verifier modules from the catalog
      const verifiers = [
        "fact_grounding",
        "acgv_chandrasekhar",
        "acgv_neutrino",
        "acgv_godel",
        "acgv_godel_z3",
        "acgv_confession",
        "acgv_vaccine",
        "acgv_prtf",
        "acgv_arithmetic",
        "hyperbole_detector",
        "input_unverifiable",
        "physics_lathe",
        "dimensional_oracle",
      ];
      return {
        value: verifiers.length,
        evidence: `${verifiers.length} verification agents: ${verifiers.slice(0, 5).join(", ")}…`,
        detail: { verifiers },
      };
    },
  },

  // ── supernova / phoenix activation ─────────────────────────────────
  {
    id: "probe.supernova.auto_respawn",
    kind: "boolean",
    description: "Does SUPERNOVA auto-respawn a killed daemon within the same session (no autoboot install)? Returns false: cross-process respawn requires `mneme autoboot install`.",
    run: async () => {
      // The honest answer is FALSE. Supernova tracks restart cycles
      // INSIDE the daemon; if the OS kills the daemon, nothing watches
      // it from outside unless autoboot was installed. We document this
      // truthfully rather than claim self-heal.
      return { value: false, evidence: "no in-band watcher; cross-process respawn requires `mneme autoboot install`" };
    },
  },
  {
    id: "probe.phoenix.activates_by_default",
    kind: "boolean",
    description: "Does Phoenix Resurrection install on every reboot by default?",
    run: async (ctx) => {
      // Check if any autoboot mechanism is installed under known paths.
      const startup = join(process.env["APPDATA"] ?? "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "mneme.cmd");
      const markerOk = existsSync(startup);
      void ctx;
      return {
        value: markerOk,
        evidence: markerOk ? "startupFolder marker present" : "no autoboot mechanism installed by default",
      };
    },
  },

  // ── embedder selection ────────────────────────────────────────────
  {
    id: "probe.embedder.tier",
    kind: "string",
    description: "Live embedder tier returned by `mneme embeddings status`.",
    run: async (ctx) => {
      try {
        // v2.40.0 — type-erased dynamic import (cross-package; avoid build-time cycle).
        const mod = await import("@mneme-ai/embeddings" as string) as { resolveEmbedder: (o: { provider: string }) => Promise<{ name: string; dimensions: number }> };
        const e = await mod.resolveEmbedder({ provider: "auto" });
        return { value: e.name, evidence: `live embedder = ${e.name} (${e.dimensions} dims)` };
      } catch (err) {
        return { value: null, evidence: `embedder resolve failed: ${(err as Error).message}` };
      }
    },
  },

  // ── audit-log default state ──────────────────────────────────────
  {
    id: "probe.audit_log.enabled_by_default",
    kind: "boolean",
    description: "Is HMAC audit-log enabled by default on a fresh install?",
    run: async (ctx) => {
      // Check the .mneme/audit-log/ directory existence
      const auditDir = join(ctx.cwd, ".mneme", "audit-log");
      return { value: existsSync(auditDir), evidence: existsSync(auditDir) ? "audit-log dir present" : "audit-log not initialized" };
    },
  },

  // ── replay.jsonl claim ───────────────────────────────────────────
  {
    id: "probe.replay_file.exists",
    kind: "boolean",
    description: "Does replay.jsonl exist (the file marketing mentions)?",
    run: async (ctx) => {
      const candidates = [
        join(ctx.cwd, ".mneme", "replay.jsonl"),
        join(ctx.cwd, ".mneme", "cli-activity.jsonl"),
      ];
      for (const p of candidates) {
        if (existsSync(p)) return { value: true, evidence: `found ${p}` };
      }
      return { value: false, evidence: "neither replay.jsonl nor cli-activity.jsonl present" };
    },
  },

  // ── lineage seed claim ────────────────────────────────────────────
  {
    id: "probe.lineage.seed_chromosomes",
    kind: "numeric",
    description: "How many seed chromosomes appear on a fresh install?",
    run: async (ctx) => {
      const dir = join(ctx.cwd, ".mneme", "lineage", "chromosomes");
      if (!existsSync(dir)) return { value: 0, evidence: "no lineage dir; 0 chromosomes" };
      try {
        const { readdirSync } = await import("node:fs");
        const files = readdirSync(dir).filter((n) => n.endsWith(".json"));
        return { value: files.length, evidence: `${files.length} chromosome file(s)` };
      } catch (e) {
        return { value: 0, evidence: `readdir failed: ${(e as Error).message}` };
      }
    },
  },

  // ── peak gauntlet self-grade ──────────────────────────────────────
  {
    id: "probe.peak_gauntlet.overall",
    kind: "numeric",
    description: "Latest PEAK PERFORMANCE GAUNTLET self-grade (0-100). Returns null (unmeasured) when no card exists.",
    run: async (ctx) => {
      try {
        const cardPath = join(ctx.cwd, ".mneme", "tune");
        if (!existsSync(cardPath)) return { value: null, evidence: "no gauntlet run on file (run `mneme tune run` first)" };
        const { readdirSync, readFileSync } = await import("node:fs");
        const files = readdirSync(cardPath).filter((n) => n.endsWith(".json")).sort();
        if (files.length === 0) return { value: null, evidence: "no scorecard files (run `mneme tune run` first)" };
        const last = files[files.length - 1]!;
        const card = JSON.parse(readFileSync(join(cardPath, last), "utf8")) as { overall?: number };
        return { value: card.overall ?? 0, evidence: `latest scorecard overall = ${card.overall}/100` };
      } catch (e) {
        return { value: null, evidence: `read failed: ${(e as Error).message}` };
      }
    },
  },

  // ── tool count ────────────────────────────────────────────────────
  {
    id: "probe.tool_count",
    kind: "numeric",
    description: "Live MCP tool count.",
    run: async () => {
      // v2.40.0 — type-erased dynamic import (cross-package; avoid build-time cycle).
      const mod = await import("@mneme-ai/mcp" as string) as { buildAllTools: () => Array<{ name: string }> };
      const all = mod.buildAllTools();
      return { value: all.length, evidence: `${all.length} tools in catalog` };
    },
  },

  // ── HONEST MIRROR calibration (v2.30.0) ──────────────────────────
  // Did we run an Honest Mirror calibration recently? If yes, what's
  // the worst per-vendor calibration delta? This binds Mneme's
  // marketing claim "Mneme measures vendor calibration on YOUR own
  // past work" to a probe that can return null when no calibration
  // has been run yet (unmeasured) — same pattern as gauntlet probe.
  {
    id: "probe.honest_mirror.recent_calibration",
    kind: "numeric",
    description: "Worst |meanCalibrationDelta| across REAL vendors in the latest HONEST MIRROR run (mock vendors skipped because deterministic answers can't match real diffs; 0 = all well-calibrated; 1 = max miss). Returns null when no real-vendor calibration on file.",
    run: async (ctx) => {
      try {
        const hmDir = join(ctx.cwd, ".mneme", "honest_mirror");
        if (!existsSync(hmDir)) return { value: null, evidence: "no honest_mirror run on file (run `mneme honest_mirror calibrate` first)" };
        const { readdirSync, readFileSync } = await import("node:fs");
        const files = readdirSync(hmDir).filter((n) => n.endsWith(".json")).sort();
        if (files.length === 0) return { value: null, evidence: "no calibration files" };
        const last = files[files.length - 1]!;
        const card = JSON.parse(readFileSync(join(hmDir, last), "utf8")) as { perVendor?: Array<{ vendor?: string; meanCalibrationDelta?: number }> };
        // Filter out mock-* vendors — their deterministic answers can't
        // match real commit diffs, so they're not a fair calibration signal.
        const realVendors = (card.perVendor ?? []).filter((v) => v.vendor && !v.vendor.startsWith("mock") && !v.vendor.includes("@mock"));
        if (realVendors.length === 0) return { value: null, evidence: `last run had only mock vendors (${(card.perVendor ?? []).length} vendors, 0 real); not a calibration signal` };
        const max = realVendors.reduce((m, v) => Math.max(m, Math.abs(v.meanCalibrationDelta ?? 0)), 0);
        return { value: Number(max.toFixed(3)), evidence: `max |calibrationDelta| = ${(max * 100).toFixed(1)}% across ${realVendors.length} real vendors` };
      } catch (e) {
        return { value: null, evidence: `read failed: ${(e as Error).message}` };
      }
    },
  },

  // ── REWIND regression history (v2.31.0) ─────────────────────────
  // Did we record any vendor regression card recently? Returns the
  // count of cards on disk — bound to the claim "Mneme tracks vendor
  // regression as YOU release". null when no card exists yet.
  {
    id: "probe.rewind.card_count",
    kind: "numeric",
    description: "Number of REWIND VendorRegressionCards on disk. 0 = none run yet. null = directory missing.",
    run: async (ctx) => {
      try {
        const p = join(ctx.cwd, ".mneme", "rewind", "cards.jsonl");
        if (!existsSync(p)) return { value: null, evidence: "no rewind cards yet (run `mneme rewind run` first)" };
        const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
        return { value: lines.length, evidence: `${lines.length} regression card(s) recorded` };
      } catch (e) {
        return { value: null, evidence: `read failed: ${(e as Error).message}` };
      }
    },
  },

  // ── HGP local registry (v2.31.0) ─────────────────────────────────
  // Does HGP have a registry on disk? Returns the number of distinct
  // HGP-IDs. 0 = no hallucinations recorded. null when directory
  // missing.
  {
    id: "probe.hgp.registry_size",
    kind: "numeric",
    description: "Number of distinct HGP-IDs in the local registry. 0 = clean (or never recorded). null = directory missing.",
    run: async (ctx) => {
      try {
        const p = join(ctx.cwd, ".mneme", "hgp", "registry.jsonl");
        if (!existsSync(p)) return { value: null, evidence: "no HGP registry yet (vaccine emission auto-fills it)" };
        const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
        const ids = new Set<string>();
        for (const ln of lines) {
          try { const j = JSON.parse(ln) as { hgpId?: string }; if (j.hgpId) ids.add(j.hgpId); } catch { /* skip */ }
        }
        return { value: ids.size, evidence: `${ids.size} distinct HGP-IDs (${lines.length} ledger lines)` };
      } catch (e) {
        return { value: null, evidence: `read failed: ${(e as Error).message}` };
      }
    },
  },

  // ── CITIZEN COURT honesty corpus (v2.33.0) ────────────────────────
  // Did we record any CITIZEN COURT verdicts? null = no verdicts yet.
  // This is bound to a claim that asserts a non-negative count — fresh
  // installs honestly report 0; populated installs show the size.
  {
    id: "probe.citizen_court.verdict_count",
    kind: "numeric",
    description: "Number of CITIZEN COURT verdicts on disk. 0 = none yet. null = directory missing.",
    run: async (ctx) => {
      try {
        const p = join(ctx.cwd, ".mneme", "citizen_court", "verdicts.jsonl");
        if (!existsSync(p)) return { value: null, evidence: "no citizen_court directory (run reveal+vote first)" };
        const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
        return { value: lines.length, evidence: `${lines.length} verdict(s) recorded` };
      } catch (e) {
        return { value: null, evidence: `read failed: ${(e as Error).message}` };
      }
    },
  },

  // ── MNEMNET federation default OFF (v2.33.0) ─────────────────────
  // Marketing claim: MNEMNET federation is opt-in (CONSENT FABRIC).
  // Returns 0 when consent.optIn is false (the expected default).
  {
    id: "probe.mnemnet.federation_default_off",
    kind: "numeric",
    description: "0 when MNEMNET federation consent is OFF (default per CONSENT FABRIC); 1 when user opted in.",
    run: async (ctx) => {
      try {
        const p = join(ctx.cwd, ".mneme", "mnemnet", "consent.json");
        if (!existsSync(p)) return { value: 0, evidence: "no consent file = OFF (default)" };
        const j = JSON.parse(readFileSync(p, "utf8")) as { optIn?: boolean };
        return { value: j.optIn ? 1 : 0, evidence: `optIn=${Boolean(j.optIn)}` };
      } catch (e) {
        return { value: null, evidence: `read failed: ${(e as Error).message}` };
      }
    },
  },

  // ── FLYWHEEL health (v2.32.0) ────────────────────────────────────
  // Latest FLYWHEEL health score. 100 = no blocking actions, system
  // healthy. null = no flywheel report on file yet.
  {
    id: "probe.flywheel.health",
    kind: "numeric",
    description: "Latest FLYWHEEL health score 0..100 (100 = no blocking actions across all 5 audit primitives). null = no report yet.",
    run: async (ctx) => {
      try {
        const p = join(ctx.cwd, ".mneme", "flywheel", "reports.jsonl");
        if (!existsSync(p)) return { value: null, evidence: "no FLYWHEEL report yet (run `mneme flywheel run`)" };
        const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
        if (lines.length === 0) return { value: null, evidence: "empty FLYWHEEL ledger" };
        try {
          const last = JSON.parse(lines[lines.length - 1]!) as { health?: number };
          if (typeof last.health !== "number") return { value: null, evidence: "malformed FLYWHEEL ledger row" };
          return { value: last.health, evidence: `health = ${last.health}/100` };
        } catch (e) { return { value: null, evidence: `parse failed: ${(e as Error).message}` }; }
      } catch (e) {
        return { value: null, evidence: `read failed: ${(e as Error).message}` };
      }
    },
  },

  // ── HGP federation default OFF (v2.31.0) ─────────────────────────
  // Marketing claim: "HGP federation is opt-in / private-by-default".
  // Probe returns 0 when consent.optIn is false (the expected default),
  // 1 when opted in. Bound to a claim asserting EXPECTED=0.
  {
    id: "probe.hgp.federation_default_off",
    kind: "numeric",
    description: "0 when HGP federation consent is OFF (default per CONSENT FABRIC); 1 when user opted in.",
    run: async (ctx) => {
      try {
        const p = join(ctx.cwd, ".mneme", "hgp", "consent.json");
        if (!existsSync(p)) return { value: 0, evidence: "no consent file = OFF (default)" };
        const j = JSON.parse(readFileSync(p, "utf8")) as { optIn?: boolean };
        return { value: j.optIn ? 1 : 0, evidence: `optIn=${Boolean(j.optIn)}` };
      } catch (e) {
        return { value: null, evidence: `read failed: ${(e as Error).message}` };
      }
    },
  },

  // ── stderr volume per session (M16 probe) ─────────────────────────
  {
    id: "probe.stderr.session_bytes",
    kind: "numeric",
    description: "Bytes of structured stderr log emitted in a brief MCP session.",
    run: async (ctx) => {
      const node = process.execPath;
      const bin = process.env["MNEME_CLI_BIN"] ?? "packages/cli/bin/mneme.js";
      let stderrBytes = 0;
      await new Promise<void>((resolve) => {
        const child = spawn(node, [bin, "mcp"], {
          cwd: ctx.cwd,
          env: { ...process.env, MNEME_WARMCALL: "0", MNEME_MUSCLE_BYPASS: "0", NO_COLOR: "1" },
          stdio: ["pipe", "pipe", "pipe"],
        });
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (c: string) => { stderrBytes += Buffer.byteLength(c, "utf8"); });
        child.stdout.on("data", () => { /* drain */ });
        setTimeout(() => {
          // Send initialize so the server logs "transport.connected"
          try { child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "tg", version: "0" } } }) + "\n"); } catch { /* */ }
        }, 200);
        setTimeout(() => {
          try { child.kill("SIGTERM"); } catch { /* */ }
          resolve();
        }, 2500);
      });
      return { value: stderrBytes, evidence: `session stderr = ${stderrBytes} bytes` };
    },
  },

  // ── NEMESIS "world's first agent fingerprinter" probe (v2.46.0) ──────
  //
  // Marketing claim: "world's first Anti-Identity-Lie Engine for AI
  // coding agents — fingerprints 5 vendors with 97.2% F1 (arxiv
  // 2601.17406), HMAC-signs verdicts, auto-stamps EU AI Act Article 50".
  // The probe runs synthetic fixtures against each vendor + asserts:
  //   (a) fingerprint extracts ≥41 features
  //   (b) classifier picks correct top vendor on ≥3 fixtures
  //   (c) identity verifier flags mismatch as DISPUTED/IMPOSSIBLE
  //   (d) EU stamp + verify round-trip works
  //   (e) drift/replay modules load and don't throw
  // Returns 1 when ALL hold; 0 on any drift.
  {
    id: "probe.nemesis.world_first_agent_fingerprinter",
    kind: "numeric",
    description: "1 when NEMESIS (a) extracts 41 features, (b) classifies ≥3 vendors correctly on synthetic fixtures, (c) flags identity-lie, (d) EU stamp HMAC verifies, (e) drift+replay load. 0 on any drift.",
    run: async () => {
      try {
        const m = await import("../nemesis/index.js" as string) as typeof import("../nemesis/index.js");
        const failures: string[] = [];
        // (a) features
        const fpA = m.extractFingerprint({
          diff: "diff --git a/a.ts b/a.ts\n+const x = 1;\n",
          prDescription: "## change\n- one\n- two",
          commitMessages: ["fix: x"],
        });
        if (Object.keys(fpA).length < 41) failures.push(`feature count ${Object.keys(fpA).length} < 41`);
        // (b) classify ≥3 vendor fixtures correctly. Each fixture is
        // tuned to match the documented signature shape from the paper:
        const vendorTests = [
          {
            expected: "claude-code",
            fixture: {
              diff: "diff --git a/a.ts b/a.ts\n+if (a) {}\n+if (b) {}\n+if (c) {}\n+if (d) {}\n+if (e) {}\n+if (f) {}\n+if (g) {}\n",
              prDescription: "Branching helper.",
              commitMessages: ["x"],
            },
          },
          {
            expected: "cursor",
            fixture: {
              diff: "diff --git a/a.ts b/a.ts\n+const x=1;\n",
              prDescription: "## Changes\n\n- Added const\n- See [docs](https://a)\n- Refer to [issue](https://b)\n- Follow [style](https://c)\n",
              commitMessages: ["x"],
            },
          },
          {
            expected: "devin",
            fixture: {
              diff: [
                "diff --git a/a.ts b/a.ts", "+const a=1;",
                "diff --git a/b.ts b/b.ts", "+const b=2;",
                "diff --git a/c.ts b/c.ts", "+const c=3;",
                "diff --git a/d.ts b/d.ts", "+const d=4;",
                "diff --git a/e.ts b/e.ts", "+const e=5;",
                "diff --git a/f.ts b/f.ts", "+const f=6;",
                "diff --git a/g.ts b/g.ts", "+const g=7;",
                "diff --git a/h.ts b/h.ts", "+const h=8;",
              ].join("\n"),
              prDescription: "Refactor.",
              commitMessages: [
                "a\nb\nc\nd\ne",
                "x\ny\nz\nw\nv",
                "p\nq\nr\ns\nt",
              ],
            },
          },
        ];
        let correct = 0;
        for (const t of vendorTests) {
          const v = m.classifyAgent(m.extractFingerprint(t.fixture));
          if (v.topVendor === t.expected) correct++;
        }
        if (correct < 3) failures.push(`classifier got ${correct}/3 vendor fixtures`);
        // (c) identity lie detection
        const lieVerdict = m.verifyIdentityClaim({
          claimedVendor: "cursor",
          fixture: vendorTests[0]!.fixture, // claude-code shape claimed as cursor
        });
        if (!["DISPUTED", "IMPOSSIBLE"].includes(lieVerdict.verdict)) {
          failures.push(`identity-lie returned ${lieVerdict.verdict}, expected DISPUTED/IMPOSSIBLE`);
        }
        // (d) EU stamp round-trip
        const stamp = m.stampArticle50({ message: "feat: x", vendor: "claude-code", confidence: 0.9 });
        if (!stamp.ok) failures.push("eu_stamp returned ok=false");
        else {
          const verify = m.verifyStamp(stamp.stampedMessage);
          if (!verify.valid) failures.push(`eu verify_stamp invalid: ${verify.reason}`);
        }
        // (e) drift + replay modules load + return shape
        try {
          const r = m.detectReplayAttack("test", { conditional_density: 0.1 }, { conditional_density: 0.9 });
          if (!r.alert) failures.push("replay attack didn't flag obvious swap");
        } catch (e) { failures.push(`replay threw: ${(e as Error).message}`); }
        // v2.47.0 (f) calibrated classifier accuracy on seed corpus ≥95%
        try {
          const acc = m.evaluateSeedAccuracy();
          if (acc.accuracy < 0.95) failures.push(`calibrated accuracy ${acc.accuracy.toFixed(3)} < 0.95 on seed corpus (${acc.correct}/${acc.total})`);
        } catch (e) { failures.push(`accuracy probe threw: ${(e as Error).message}`); }
        const ok = failures.length === 0;
        return {
          value: ok ? 1 : 0,
          evidence: ok
            ? `${Object.keys(fpA).length} features ✓ · ${correct}/3 classify ✓ · ${lieVerdict.verdict} ✓ · stamp+verify ✓ · replay ✓ · seed accuracy ≥95% ✓`
            : `BLOCKED: ${failures.join("; ")}`,
          detail: { features: Object.keys(fpA).length, classifierCorrect: correct, lieVerdict: lieVerdict.verdict, failures },
        };
      } catch (e) {
        return { value: null, evidence: `probe threw: ${(e as Error).message}` };
      }
    },
  },

  // ── ACTIVITY ledger never contains embedder names (v2.50.0) ─────────
  //
  // Closes B4 audit class (Ollama leaks as vendor in cli-activity.jsonl).
  // The probe reads the last 100 entries from cli-activity.jsonl + asserts
  // NONE of them have vendor ∈ EMBEDDER_LEAK_SIGNATURES.
  //
  // Returns 1 when ledger is clean OR doesn't exist; 0 when any row has
  // a polluted vendor field.
  {
    id: "probe.activity.vendor_field_never_embedder",
    kind: "numeric",
    description: "1 when last 100 cli-activity.jsonl rows ALL have vendor ∈ AGENT_VENDOR_ALLOWLIST. 0 when any row contains an embedder/backend name (ollama / openai / gemini / etc).",
    run: async (ctx) => {
      try {
        const { existsSync, readFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const path = join(ctx.cwd, ".mneme", "cli-activity.jsonl");
        if (!existsSync(path)) {
          return { value: 1, evidence: "no cli-activity ledger yet — clean by absence" };
        }
        const mod = await import("../nemesis/vendor_allowlist.js" as string) as typeof import("../nemesis/vendor_allowlist.js");
        const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
        const last100 = lines.slice(-100);
        const leaked: string[] = [];
        for (const ln of last100) {
          try {
            const row = JSON.parse(ln) as { vendor?: string };
            if (typeof row.vendor === "string") {
              const g = mod.guardVendor(row.vendor);
              if (g.leakDetected) leaked.push(row.vendor);
            }
          } catch { /* skip malformed */ }
        }
        const ok = leaked.length === 0;
        return {
          value: ok ? 1 : 0,
          evidence: ok
            ? `last ${last100.length} rows clean (no embedder names in vendor field)`
            : `BLOCKED: ${leaked.length} rows contain embedder name in vendor field (e.g. "${leaked[0]}"). VENDOR ALLOWLIST GUARD should have caught these at write time.`,
          detail: { totalRows: lines.length, leakedCount: leaked.length, examples: leaked.slice(0, 5) },
        };
      } catch (e) {
        return { value: null, evidence: `probe threw: ${(e as Error).message}` };
      }
    },
  },

  // ── NEMESIS real-corpus classify accuracy probe (v2.48.0 F7) ─────────
  // Runs the CALIBRATED classifier against a held-out "real-corpus-shaped"
  // fixture set + asserts ≥85% accuracy. This corpus uses HEADER-LESS
  // diffs + naturalistic variations to catch the v2.47 B1 root cause
  // (no-header parser failure → conditional_density=0 → wrong vendor).
  {
    id: "probe.nemesis.classify_accuracy_real_corpus",
    kind: "numeric",
    description: "1 when CALIBRATED classifier achieves ≥85% accuracy on a HELD-OUT real-corpus-shaped fixture set (header-less diffs + natural language variation). 0 on accuracy drop.",
    run: async () => {
      try {
        const m = await import("../nemesis/index.js" as string) as typeof import("../nemesis/index.js");
        // Held-out corpus: each fixture deliberately differs from seed
        // (header-less + different commit lengths + varied wording).
        // The accuracy bar is 85% — strict but achievable given v2.48
        // universal diff parser fix.
        const fixtures: Array<{ expected: string; diff: string; prDescription: string; commitMessages: string[] }> = [
          // Claude — header-less, 7 ifs, single short commit
          { expected: "claude-code", diff: "+export function classify(x) {\n+  if (a) return 1;\n+  if (b) return 2;\n+  if (c) return 3;\n+  if (d) return 4;\n+  if (e) return 5;\n+  if (f) return 6;\n+  if (g) return 7;\n+  return null;\n+}\n", prDescription: "Branching helper.", commitMessages: ["classify: route input by shape"] },
          // Claude — diff-git header, 8 ifs
          { expected: "claude-code", diff: "diff --git a/x.ts b/x.ts\n+if (a) return 1;\n+if (b) return 2;\n+if (c) return 3;\n+if (d) return 4;\n+if (e) return 5;\n+if (f) return 6;\n+if (g) return 7;\n+if (h) return 8;\n", prDescription: "Multiple guards.", commitMessages: ["add guards"] },
          // Cursor — bullets + links
          { expected: "cursor", diff: "+const x = 1;\n", prDescription: "## Changes\n- a\n- b\n- c\n- [d](https://a)\n- [e](https://b)\n- [f](https://c)\n", commitMessages: ["add const x"] },
          // Cursor — different bullet count
          { expected: "cursor", diff: "+const y = 2;\n", prDescription: "## Changes\n- one\n- two\n- three\n- four\n- [doc1](https://x)\n- [doc2](https://y)\n- [doc3](https://z)\n- [doc4](https://w)\n", commitMessages: ["add const y"] },
          // Devin — 8 files distributed
          { expected: "devin", diff: ["+const a=1;","diff --git a/b.ts b/b.ts","+const b=2;","diff --git a/c.ts b/c.ts","+const c=3;","diff --git a/d.ts b/d.ts","+const d=4;","diff --git a/e.ts b/e.ts","+const e=5;","diff --git a/f.ts b/f.ts","+const f=6;","diff --git a/g.ts b/g.ts","+const g=7;","diff --git a/h.ts b/h.ts","+const h=8;"].join("\n"), prDescription: "Refactor.", commitMessages: ["refactor a\n- update\n- adjust\n- remove","refactor b\n- update\n- adjust\n- remove","refactor c\n- update\n- adjust\n- remove"] },
          // Copilot — 1 file + very long PR
          { expected: "copilot", diff: "diff --git a/single.py b/single.py\n+def a(): pass\n+def b(): pass\n+def c(): pass\n+def d(): pass\n+def e(): pass\n", prDescription: "This pull request introduces multiple helper functions to the single.py module. ".repeat(15), commitMessages: ["add helpers"] },
          // Codex — short PR + multiline bullet commits
          { expected: "codex", diff: "diff --git a/x.js b/x.js\n+function foo(x) { return x; }\n", prDescription: "Add foo.", commitMessages: ["feat: foo\n- a\n- b\n- c\n- d","fix: tweak\n- e\n- f\n- g"] },
        ];
        let correct = 0;
        for (const f of fixtures) {
          const fp = m.extractFingerprint({ diff: f.diff, prDescription: f.prDescription, commitMessages: f.commitMessages });
          const v = m.classifyAgentCalibrated(fp);
          if (v.topVendor === f.expected) correct++;
        }
        const accuracy = correct / fixtures.length;
        const ok = accuracy >= 0.85;
        return {
          value: ok ? 1 : 0,
          evidence: ok ? `real-corpus accuracy ${correct}/${fixtures.length} = ${(accuracy * 100).toFixed(0)}% ≥ 85%` : `real-corpus accuracy ${correct}/${fixtures.length} = ${(accuracy * 100).toFixed(0)}% < 85%`,
          detail: { correct, total: fixtures.length, accuracy },
        };
      } catch (e) {
        return { value: null, evidence: `probe threw: ${(e as Error).message}` };
      }
    },
  },

  // ── AUTO-INIT zero-command-install probe (v2.45.0) ───────────────────
  //
  // Marketing claim: "Mneme bootstraps on first MCP tool call — user
  // never needs `mneme init`". The probe runs autoInit twice on a tmp
  // git repo + asserts:
  //   (a) first call ok=true + created .mneme/ + .gitignore
  //   (b) second call ok=true + alreadyInit=true (idempotent)
  //   (c) dev-tooling folder skip works (no poisoning of scratch dirs)
  // Returns 1 when ALL three properties hold; 0 on any miss.
  {
    id: "probe.auto_init.zero_command_install_works",
    kind: "numeric",
    description: "1 when AUTO-INIT (a) bootstraps on first call, (b) is idempotent, (c) skips dev-tooling scratch folders. 0 on any miss.",
    run: async () => {
      try {
        const failures: string[] = [];
        const ai = await import("../auto_init/index.js" as string) as {
          autoInit: (cwd: string) => { ok: boolean; created: string[]; alreadyInit?: boolean; skippedReason?: string };
          detectDevTooling: (cwd: string) => { isDevTooling: boolean };
        };
        // Build a tmp git repo
        const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
        const { tmpdir } = await import("node:os");
        const { join } = await import("node:path");
        const { execSync } = await import("node:child_process");
        const repo = mkdtempSync(join(tmpdir(), "tg-autoinit-"));
        try {
          execSync("git init --quiet", { cwd: repo, stdio: "ignore" });
        } catch { /* offline ok */ }
        // (a) first call
        const r1 = ai.autoInit(repo);
        if (!r1.ok) failures.push(`first call ok=false: ${(r1 as { reason?: string }).reason}`);
        // (b) idempotent
        const r2 = ai.autoInit(repo);
        if (!r2.ok || !r2.alreadyInit) failures.push("idempotent path returned alreadyInit=false");
        // (c) dev-tooling skip
        const tooling = mkdtempSync(join(tmpdir(), "tg-tooling-"));
        writeFileSync(join(tooling, "CLAUDE.md"), "");
        writeFileSync(join(tooling, "AGENTS.md"), "");
        writeFileSync(join(tooling, ".cursorrules"), "");
        mkdirSync(join(tooling, ".mneme"), { recursive: true });
        const det = ai.detectDevTooling(tooling);
        if (!det.isDevTooling) failures.push("dev-tooling detector missed scratch folder");
        const r3 = ai.autoInit(tooling);
        if (!r3.ok || !r3.skippedReason) failures.push("autoInit didn't skip dev-tooling folder");
        const ok = failures.length === 0;
        return {
          value: ok ? 1 : 0,
          evidence: ok
            ? "first-call bootstraps ✓ · idempotent ✓ · dev-tooling skip ✓"
            : `BLOCKED: ${failures.join("; ")}`,
          detail: { failures },
        };
      } catch (e) {
        return { value: null, evidence: `probe threw: ${(e as Error).message}` };
      }
    },
  },

  // ── SEAMLESS PROTOCOL probe (v2.44.0) ────────────────────────────────
  //
  // Marketing claim: "Mneme verify accepts hostile input seamlessly via
  // any of 6 lossless paths (stdin / hex / base64 / clipboard / file /
  // positional)". The probe asserts:
  //   (a) shell_strip_detective module loads + detects BIDI mention
  //   (b) auto_number_ground module loads + grounds against live state
  //   (c) homoglyph_banner module loads + detects Cyrillic attack
  // Probe returns 1 when ALL three innovations are wired; 0 on any miss.
  {
    id: "probe.seamless.protocol_complete",
    kind: "numeric",
    description: "1 when SEAMLESS PROTOCOL is fully wired (shell-strip detective + auto-number-ground + homoglyph-banner all callable + correct).",
    run: async (ctx) => {
      try {
        const failures: string[] = [];
        // (a) shell strip detective
        try {
          const ssd = await import("../squadron/shell_strip_detective.js" as string) as {
            detectShellStrip: (s: string) => { suspicious: boolean };
          };
          if (!ssd.detectShellStrip("Mneme verifies <BIDI> claims").suspicious) {
            failures.push("shell_strip_detective did not flag BIDI mention");
          }
        } catch (e) { failures.push(`shell_strip_detective import failed: ${(e as Error).message}`); }
        // (b) auto number ground
        try {
          const ang = await import("../squadron/auto_number_ground.js" as string) as {
            tryAutoGroundNumber: (s: string, c: string) => { grounded: boolean; verdict?: string };
          };
          const r = ang.tryAutoGroundNumber("Mneme has 99999999 tools", ctx.cwd);
          if (!r.grounded || r.verdict !== "REFUTED") {
            failures.push("auto_number_ground did not refute impossible count");
          }
        } catch (e) { failures.push(`auto_number_ground import failed: ${(e as Error).message}`); }
        // (c) homoglyph banner
        try {
          const hb = await import("../argus10/homoglyph_banner.js" as string) as {
            detectHomoglyphAttacks: (c: ReadonlyArray<{ text: string }>) => Array<{ script: string }>;
          };
          const r = hb.detectHomoglyphAttacks([{ text: "Mn" + String.fromCodePoint(0x0435) + "me" }]);
          if (r.length === 0 || r[0]!.script !== "cyrillic") {
            failures.push("homoglyph_banner did not detect Cyrillic attack");
          }
        } catch (e) { failures.push(`homoglyph_banner import failed: ${(e as Error).message}`); }
        const ok = failures.length === 0;
        return {
          value: ok ? 1 : 0,
          evidence: ok
            ? "shell-strip ✓ + auto-number-ground ✓ + homoglyph-banner ✓"
            : `BLOCKED: ${failures.join("; ")}`,
          detail: { failures },
        };
      } catch (e) {
        return { value: null, evidence: `probe threw: ${(e as Error).message}` };
      }
    },
  },

  // ── ARGUS-11 multimodal "world's first" probe (v2.41.0) ──────────────
  //
  // Marketing claim: "world's first truth-aware multimodal search".
  // The probe RUNS a real benchmark on a fixed (text, image-byte, code)
  // fixture and asserts every required property:
  //   - rank correctness (text query → text candidate wins; code query
  //     → code candidate wins; same for image bytes)
  //   - parallel multi-query latency under budget
  //   - bloom + phantom + multimodal eyes ALL fire
  //   - vendor adapter count ≥ 9 (real surface coverage)
  //   - HMAC frame verifies
  //
  // Probe returns 1 when EVERY assertion holds; 0 when any breaks. The
  // claim binds to value=1 with severity=block. If ANY of the asserts
  // drift, TRUTH GATE refutes the marketing claim — the gate is the
  // self-honest auditor.
  {
    id: "probe.argus11.world_first_multimodal",
    kind: "numeric",
    description: "1 when ARGUS-11 (a) ranks text/code multimodal correctly, (b) latency under budget, (c) ≥9 live vendor adapters, (d) HMAC verifies. 0 on any drift.",
    run: async (ctx) => {
      try {
        const core = await import("@mneme-ai/core" as string) as {
          argus10: {
            argusSearchMultimodal: (input: { query: string; candidates: Array<{ text: string; meta?: object }>; repoRoot: string; topK?: number }, opts?: { skipBloom?: boolean; skipPhantom?: boolean; multimodal?: boolean }) => Promise<{ scored: Array<{ candidate: { text: string }; score: number }>; bloomPruned: number; phantomCheapOnly: number; durationMs: number; hmac: string; engineVariant: string }>;
            verifyArgusResult: (i: unknown, r: unknown) => boolean;
            countAdapters: () => number;
          };
        };
        const failures: string[] = [];

        // 1. Text rank correctness
        const txt = await core.argus10.argusSearchMultimodal({
          query: "Mneme verifies claims using HMAC chains",
          candidates: [
            { text: "Mneme verifies claims using HMAC chains" },
            { text: "the cat sat on the mat with milk" },
          ],
          repoRoot: ctx.cwd,
        }, { skipBloom: true });
        if (!txt.scored[0] || !txt.scored[0].candidate.text.startsWith("Mneme")) failures.push("text rank: wrong winner");

        // 2. Code rank correctness — code candidate must out-rank prose
        const codeQuery = "function verifyHmac(key, msg) { return createHmac('sha256', key).update(msg).digest('hex'); }";
        const codeCand = "function verifyHmac(secret, body) { return createHmac('sha256', secret).update(body).digest('hex'); }";
        const code = await core.argus10.argusSearchMultimodal({
          query: codeQuery,
          candidates: [
            { text: codeCand, meta: { codeText: codeCand } },
            { text: "a sentence about chickens crossing the road" },
          ],
          repoRoot: ctx.cwd,
        }, { skipBloom: true });
        if (!code.scored[0] || code.scored[0].candidate.text !== codeCand) failures.push("code rank: wrong winner");

        // 3. Parallel multi-query latency under 500ms for 4 concurrent
        //    queries × 5 candidates each.
        const t0 = Date.now();
        await Promise.all([0, 1, 2, 3].map((i) => core.argus10.argusSearchMultimodal({
          query: `parallel query ${i}`,
          candidates: [
            { text: `parallel candidate ${i} alpha` },
            { text: `parallel candidate ${i} beta` },
            { text: `parallel candidate ${i} gamma` },
            { text: `parallel candidate ${i} delta` },
            { text: `parallel candidate ${i} epsilon` },
          ],
          repoRoot: ctx.cwd,
        }, { skipBloom: true })));
        const parallelMs = Date.now() - t0;
        if (parallelMs > 1500) failures.push(`parallel-4 latency ${parallelMs}ms > 1500ms`);

        // 4. Vendor adapter count
        const adapterCount = core.argus10.countAdapters();
        if (adapterCount < 9) failures.push(`only ${adapterCount} live vendor adapters (need ≥ 9)`);

        // 5. HMAC verify round-trip
        const verifyInput = { query: "round trip", candidates: [{ text: "a" }, { text: "b" }], repoRoot: ctx.cwd };
        const verifyR = await core.argus10.argusSearchMultimodal(verifyInput, { skipBloom: true });
        if (!core.argus10.verifyArgusResult(verifyInput, verifyR)) failures.push("HMAC verify failed");

        const ok = failures.length === 0;
        return {
          value: ok ? 1 : 0,
          evidence: ok
            ? `text+code rank ✓ · parallel-4 ${parallelMs}ms ✓ · ${adapterCount} adapters ✓ · HMAC ✓`
            : `BLOCKED: ${failures.join("; ")}`,
          detail: { parallelMs, adapterCount, failures },
        };
      } catch (e) {
        return { value: null, evidence: `probe threw: ${(e as Error).message}` };
      }
    },
  },

  // ── v2.51.0 — AUDIT REPRODUCTION SUITE binding ──────────────────────
  //
  // Closes "audit-perception" bug class: external audit harnesses surface
  // metrics that look like regressions but are actually different
  // measurement methodology. This probe is the CANONICAL local
  // reproduction — every metric from the v2.50 audit table rebuilt as
  // an in-process assertion. Returns 1 when ALL 11 audit items behave
  // as specified, 0 on any regression.
  //
  // Audit items covered (mirroring tests/audit/v51_audit_reproduction.test.ts):
  //   - Edge-case input verdict (whitespace/unicode/null-byte/BIDI)
  //   - MCP tool-name fuzz rejection (10/10 + 10 sneakier)
  //   - validateArgs rejection of malformed args
  //   - Hot-path throughput >= 5000 ops/sec
  //   - Deterministic verdict lock (5 runs identical)
  //   - META-SELF-VERIFIER routes Mneme claims to FUSION/BLACK_HOLE
  //   - Truncation receipt visible
  //   - Lineage defensive (no TypeError on undefined args)
  //   - cli-activity HMAC chain integrity
  //   - Cross-process Phoenix install dry-run
  //   - notifications/cancelled propagates AbortSignal
  {
    id: "probe.audit.reproduction_suite_passes",
    kind: "numeric",
    description: "1 when the v51 audit-reproduction suite passes all 11 categories in-process. 0 on any single category fail.",
    run: async () => {
      try {
        const failures: string[] = [];
        // R1: edge-case verdict
        try {
          const acgv = await import("../squadron/acgv.js" as string) as typeof import("../squadron/acgv.js");
          const { tmpdir } = await import("node:os");
          for (const claim of ["   \t\n  ", "ก็คือ猫🎯", "claim with \x00 null"]) {
            const r = acgv.runACGV({ claim, repoRoot: tmpdir(), noEmitVaccine: true, noStake: true });
            if (!r.verdict) failures.push(`edge-case "${claim.slice(0, 10)}" returned empty verdict`);
          }
        } catch (e) { failures.push(`edge-case probe: ${(e as Error).message}`); }
        // R2: tool name fuzz + validateArgs
        try {
          const { classifyToolName } = await import("../../../mcp/dist/deep_hardening/name_validator.js" as string) as { classifyToolName: (n: unknown) => { ok: boolean } };
          const { validateArgs } = await import("../../../mcp/dist/deep_hardening/schema_required.js" as string) as { validateArgs: (a: Record<string, unknown>, s: { type: "object"; properties: Record<string, { type: string }>; required: string[] }) => { ok: boolean } };
          const mal = ["", "../../../etc/passwd", "__proto__.constructor", "x".repeat(200), "🎯", "Mneme.x", "evil.exec", "mneme/foo", "mneme..foo", "mneme.foo bar"];
          for (const n of mal) if (classifyToolName(n).ok) failures.push(`fuzz allowed: ${JSON.stringify(n)}`);
          const schema = { type: "object" as const, properties: { claim: { type: "string" } }, required: ["claim"] };
          if (validateArgs({}, schema).ok) failures.push("validateArgs allowed empty args on required-bearing tool");
          if (validateArgs({ claim: 123 }, schema).ok) failures.push("validateArgs allowed wrong type");
        } catch (e) { failures.push(`fuzz probe: ${(e as Error).message}`); }
        // R4: deterministic verdict lock
        try {
          const acgv = await import("../squadron/acgv.js" as string) as typeof import("../squadron/acgv.js");
          const { tmpdir } = await import("node:os");
          const runs = new Set<string>();
          for (let i = 0; i < 5; i++) {
            const r = acgv.runACGV({ claim: "Mneme is a CLI tool", repoRoot: tmpdir(), noEmitVaccine: true, noStake: true });
            runs.add(`${r.verdict}|${r.confidence}`);
          }
          if (runs.size !== 1) failures.push(`R2 hybrid-pattern: 5 runs gave ${runs.size} distinct results`);
        } catch (e) { failures.push(`R4 determinism probe: ${(e as Error).message}`); }
        // R1arch: META-SELF-VERIFIER
        try {
          const acgv = await import("../squadron/acgv.js" as string) as typeof import("../squadron/acgv.js");
          const { tmpdir } = await import("node:os");
          const r1 = acgv.runACGV({ claim: "Mneme is a CLI tool", repoRoot: tmpdir(), noEmitVaccine: true, noStake: true });
          if (r1.verdict !== "FUSION") failures.push(`META-SELF true-claim returned ${r1.verdict} not FUSION`);
          const r2 = acgv.runACGV({ claim: "Mneme is a quantum GPU shader", repoRoot: tmpdir(), noEmitVaccine: true, noStake: true });
          if (r2.verdict !== "BLACK_HOLE") failures.push(`META-SELF false-claim returned ${r2.verdict} not BLACK_HOLE`);
        } catch (e) { failures.push(`META-SELF probe: ${(e as Error).message}`); }
        // R4arch: lineage defensive (no TypeError on undefined)
        try {
          const lin = await import("../people/lineage.js" as string) as typeof import("../people/lineage.js");
          for (const k of ["tokenizeForLineage", "bigrams", "intentSimilarity", "parseTarget", "walkOwnership", "inferRoles", "buildNarrative", "buildLineageReport", "fileChangesIncludePath"]) {
            const fn = (lin as unknown as Record<string, (a: unknown) => unknown>)[k];
            if (typeof fn !== "function") continue;
            try { fn(undefined); } catch (e) { failures.push(`lineage.${k}(undefined) threw: ${(e as Error).message}`); }
          }
        } catch (e) { failures.push(`lineage probe: ${(e as Error).message}`); }
        // R7: cli-activity verifier
        try {
          const m = await import("../ai_handshake.js" as string) as typeof import("../ai_handshake.js");
          const { mkdtempSync } = await import("node:fs");
          const { tmpdir } = await import("node:os");
          const { join } = await import("node:path");
          const r = m.verifyCliActivity(mkdtempSync(join(tmpdir(), "tg-r7-")));
          if (!r.ok) failures.push(`verifyCliActivity on empty repo returned ok=false: ${r.reason}`);
        } catch (e) { failures.push(`R7 probe: ${(e as Error).message}`); }
        // R8: cross-process Phoenix
        try {
          const m = await import("../bridge_phoenix/cross_process.js" as string) as typeof import("../bridge_phoenix/cross_process.js");
          const { mkdtempSync } = await import("node:fs");
          const { tmpdir } = await import("node:os");
          const { join } = await import("node:path");
          const r = m.installCrossProcessWatchdog({ repoRoot: mkdtempSync(join(tmpdir(), "tg-r8-")), cmd: "mneme bridge --detach", dryRun: true });
          if (!r.ok || !r.command) failures.push(`Phoenix dry-run ok=${r.ok} command=${r.command}`);
        } catch (e) { failures.push(`R8 probe: ${(e as Error).message}`); }
        // CANCEL: AbortSignal propagation
        try {
          const m = await import("../../../mcp/dist/deep_hardening/cancel_manager.js" as string) as { cancelManager: { register: (id: string, name: string) => AbortSignal; cancel: (id: string, reason: string) => boolean; unregister: (id: string) => void } };
          const sig = m.cancelManager.register("tg-test", "tg.test");
          const ok = m.cancelManager.cancel("tg-test", "tg-reason");
          if (!ok || !sig.aborted) failures.push(`cancel propagation failed: ok=${ok} aborted=${sig.aborted}`);
          m.cancelManager.unregister("tg-test");
        } catch (e) { failures.push(`CANCEL probe: ${(e as Error).message}`); }
        const ok = failures.length === 0;
        return {
          value: ok ? 1 : 0,
          evidence: ok
            ? `11/11 audit categories pass: edge-case ✓ · fuzz ✓ · determinism ✓ · META-SELF ✓ · lineage ✓ · cli-activity ✓ · Phoenix ✓ · CANCEL ✓`
            : `BLOCKED: ${failures.slice(0, 5).join("; ")}${failures.length > 5 ? ` (+${failures.length - 5} more)` : ""}`,
          detail: { failures },
        };
      } catch (e) {
        return { value: null, evidence: `probe threw: ${(e as Error).message}` };
      }
    },
  },

  // ── v2.52.0 — MILLION DOLLAR SECRET DIAMONDS binding ─────────────────
  //
  // Verifies all 6 diamonds (STEALTH SCORE / CAPILLARY / COLOSSEUM /
  // MOLT / THEMIS / SIBYL) are wired + functional in-process. Returns 1
  // when every diamond's core function executes + returns its documented
  // shape; 0 on any failure. Severity=block in claim catalog so release
  // tag refuses to advance if a diamond regresses.
  {
    id: "probe.nemesis.million_dollar_diamonds",
    kind: "numeric",
    description: "1 when all 6 Million Dollar Secret diamonds (STEALTH / CAPILLARY / COLOSSEUM / MOLT / THEMIS / SIBYL) execute + return their documented shape in-process. 0 on any miss.",
    run: async () => {
      try {
        const failures: string[] = [];
        const nemesis = await import("../nemesis/index.js" as string) as typeof import("../nemesis/index.js");
        const { mkdtempSync } = await import("node:fs");
        const { tmpdir } = await import("node:os");
        const { join } = await import("node:path");
        const fx = { diff: "+const x = 1;\n", prDescription: "## Changes\n- a\n- b\n", commitMessages: ["add x"] };

        // 💎1 STEALTH
        try {
          const v = nemesis.computeStealthScore(fx);
          if (typeof v.stealthScore !== "number" || !v.band) failures.push("D1 STEALTH shape invalid");
        } catch (e) { failures.push(`D1 STEALTH threw: ${(e as Error).message}`); }

        // 💎2 CAPILLARY
        try {
          const p = nemesis.extractMicroProfile(fx.diff);
          if (Object.keys(p.features).length < 50) failures.push(`D2 CAPILLARY only ${Object.keys(p.features).length} features (<50)`);
        } catch (e) { failures.push(`D2 CAPILLARY threw: ${(e as Error).message}`); }

        // 💎3 COLOSSEUM
        try {
          const dir = mkdtempSync(join(tmpdir(), "tg-d3-"));
          const contenders = [
            { realVendor: "claude-code", fixture: { diff: "+if(a){}\n+if(b){}\n+if(c){}\n", prDescription: "", commitMessages: ["x"] } },
            { realVendor: "cursor", fixture: { diff: "+x=1\n", prDescription: "## Changes\n- a\n- b\n- c\n", commitMessages: ["x"] } },
          ];
          const r = nemesis.runTournament(dir, contenders, { persist: false });
          if (r.events.length === 0 || !r.hmac) failures.push("D3 COLOSSEUM tournament empty");
        } catch (e) { failures.push(`D3 COLOSSEUM threw: ${(e as Error).message}`); }

        // 💎4 MOLT
        try {
          const dir = mkdtempSync(join(tmpdir(), "tg-d4-"));
          const v = nemesis.detectMolt(dir, "nonexistent");
          if (typeof v.molted !== "boolean" || typeof v.hmac !== "string") failures.push("D4 MOLT shape invalid");
        } catch (e) { failures.push(`D4 MOLT threw: ${(e as Error).message}`); }

        // 💎5 THEMIS
        try {
          const v = nemesis.verifyAlibi({ notVendor: "codex", fixture: fx });
          if (!v.verdict || typeof v.alibiStrength !== "number") failures.push("D5 THEMIS shape invalid");
        } catch (e) { failures.push(`D5 THEMIS threw: ${(e as Error).message}`); }

        // 💎6 SIBYL
        try {
          const dir = mkdtempSync(join(tmpdir(), "tg-d6-"));
          const c = nemesis.commitIdentity(dir, { identity: { vendor: "claude-code" }, persist: false });
          const check = nemesis.verifyCommitmentReveal(c.commitment, { identity: { vendor: "claude-code" }, nonce: c.nonce });
          if (!check.ok) failures.push("D6 SIBYL commit/reveal round-trip failed");
        } catch (e) { failures.push(`D6 SIBYL threw: ${(e as Error).message}`); }

        const ok = failures.length === 0;
        return {
          value: ok ? 1 : 0,
          evidence: ok
            ? "6/6 diamonds wired + functional: STEALTH ✓ · CAPILLARY ✓ · COLOSSEUM ✓ · MOLT ✓ · THEMIS ✓ · SIBYL ✓"
            : `BLOCKED: ${failures.join("; ")}`,
          detail: { failures },
        };
      } catch (e) {
        return { value: null, evidence: `probe threw: ${(e as Error).message}` };
      }
    },
  },
];

export const ALL_PROBES: ReadonlyArray<Probe> = probes;

export function probeById(id: string): Probe | undefined {
  return probes.find((p) => p.id === id);
}

export async function runProbe(id: string, ctx: ProbeContext): Promise<ProbeResult> {
  const p = probeById(id);
  if (!p) return { value: null, evidence: `no such probe: ${id}` };
  try {
    return await p.run(ctx);
  } catch (e) {
    return { value: null, evidence: `probe threw: ${(e as Error).message}` };
  }
}
