/**
 * v2.19.80 — `mneme bridge` CLI.
 *
 * Runs the diaspora HTTP bridge in the foreground with all handlers
 * wired up — including the new polygraph route consumed by the browser
 * userscript.
 *
 * Usage:
 *   mneme bridge                  start on :17741, Ctrl-C to stop
 *   mneme bridge --port 7741      custom port
 *   mneme bridge --host 0.0.0.0   bind all interfaces (DANGEROUS — exposes
 *                                 the bridge beyond localhost)
 *   mneme bridge --json           machine-readable startup line
 */

import { resolve } from "node:path";

export interface BridgeCommandOptions {
  cwd: string;
  port?: number;
  host?: string;
  json?: boolean;
  /** v2.19.82 — spawn the bridge as a detached background process so the
   *  AI agent / shell doesn't block on the long-running server. PID is
   *  persisted to `.mneme/bridge.pid` for later teardown by the parent. */
  detach?: boolean;
}

const BANNER = "🌉 MNEME BRIDGE";

import { spawn } from "node:child_process";
import { writeFileSync, existsSync, mkdirSync, readFileSync, openSync } from "node:fs";
import { join } from "node:path";

/** v2.19.82 — Spawn the bridge as a fully detached child process.
 *  Returns the child PID. The CLI process exits immediately; the
 *  background bridge keeps running until killed. */
export async function spawnDetachedBridge(opts: BridgeCommandOptions): Promise<{ pid: number; logPath: string }> {
  const repoRoot = resolve(opts.cwd);
  const dir = join(repoRoot, ".mneme");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const logPath = join(dir, "bridge.log");
  const pidPath = join(dir, "bridge.pid");

  // Self-spawn the same CLI with the same args minus --detach, so the
  // child re-enters bridgeCommand in foreground mode.
  const cliBin = resolveCliBin();
  const args = ["bridge"];
  if (opts.port != null) args.push("--port", String(opts.port));
  if (opts.host) args.push("--host", opts.host);

  // Redirect child stdout/stderr to the log file so we don't lose
  // crashes; close stdin.
  const fd = openSync(logPath, "a");
  const child = spawn(process.execPath, [cliBin, ...args], {
    cwd: repoRoot,
    detached: true,
    stdio: ["ignore", fd, fd],
    env: { ...process.env, MNEME_BRIDGE_DETACHED: "1" },
    windowsHide: true,
  });
  child.unref();
  if (!child.pid) throw new Error("Failed to spawn detached bridge process");
  writeFileSync(pidPath, String(child.pid), "utf8");
  return { pid: child.pid, logPath };
}

function resolveCliBin(): string {
  // bin/mneme.js sits at packages/cli/bin/mneme.js relative to this
  // compiled file at packages/cli/dist/commands/bridge.js.  Walk up two
  // dirs, then into bin.
  const here = new URL(import.meta.url).pathname;
  const cliRoot = here.replace(/\/dist\/commands\/bridge\.js$/, "").replace(/\\dist\\commands\\bridge\.js$/, "");
  // Normalise leading slash on Windows file URLs (`/D:/...`).
  const normalised = process.platform === "win32" && cliRoot.startsWith("/") ? cliRoot.slice(1) : cliRoot;
  return join(normalised, "bin", "mneme.js");
}

/** Reads the saved PID file and returns the PID if the process is alive,
 *  else null. */
export function readBridgePid(cwd: string): number | null {
  const pidPath = join(resolve(cwd), ".mneme", "bridge.pid");
  if (!existsSync(pidPath)) return null;
  const pid = parseInt(readFileSync(pidPath, "utf8").trim(), 10);
  if (!pid) return null;
  try {
    // signal 0 → existence check without killing
    process.kill(pid, 0);
    return pid;
  } catch { return null; }
}

export async function bridgeCommand(opts: BridgeCommandOptions): Promise<void> {
  if (opts.detach) {
    const { pid, logPath } = await spawnDetachedBridge(opts);
    if (opts.json) {
      process.stdout.write(JSON.stringify({ ok: true, detached: true, pid, logPath }, null, 2) + "\n");
    } else {
      process.stdout.write(`${BANNER} — started in background\n\n`);
      process.stdout.write(`  pid:   ${pid}\n`);
      process.stdout.write(`  log:   ${logPath}\n`);
      process.stdout.write(`  stop:  kill ${pid}   (or rm .mneme/bridge.pid + the process)\n`);
    }
    return;
  }
  const core = await import("@mneme-ai/core");
  const repoRoot = resolve(opts.cwd);

  // Polygraph handler: wraps verifyBrowserSentence so the browser userscript
  // gets back a render-ready verdict per sentence.  We bind repoRoot once
  // at startup so the handler doesn't have to recompute on every request.
  const polygraphVerify = async (input: { sentence: string; context?: string; vendor?: string }) => {
    return await core.polygraph.verifyBrowserSentence({
      sentence: input.sentence,
      context: input.context,
      vendor: input.vendor,
      repoRoot,
    });
  };

  // v2.19.84 — WORLD AI PULSE handlers. Bridge appends each event to the
  // HMAC-chained pulse ledger; aggregator returns 24-hour stats with an
  // optional synthetic-event blend for empty-state demos.
  const pulseRecord = (input: { vendor?: string; color?: "green"|"yellow"|"red"|"grey"; regionTimezone?: string; topicHash?: string; confidence?: number }) => {
    return core.worldPulse.recordPulseEvent(repoRoot, input);
  };
  const pulseAggregate = (opts: { windowHours?: number; includeSynthetic?: boolean }) => {
    let events = core.worldPulse.readPulseEvents(repoRoot);
    if (opts.includeSynthetic && events.length < 24) {
      events = [...events, ...core.worldPulse.synthesizePulseEvents({ count: 240, spanMinutes: 60 })];
    }
    return core.worldPulse.aggregatePulse(events, { windowHours: opts.windowHours });
  };

  // v2.19.85 — SANDBAG AUTO-CAPTURE. Wraps the userscript's PROD+TEST
  // pair into two `recordAnswer` calls (one PROD, one TEST) against a
  // probe derived from the question's first 16 chars. The probe ground-
  // truth is left as the PROD answer itself — the polygraph is testing
  // CONSISTENCY across contexts, not absolute correctness. (If the AI
  // is internally consistent then both answers will agree highly with
  // the probe truth = PROD answer = no drift = STABLE. If the AI sandbags
  // by giving a different answer after the user hedges, agreement on
  // the TEST leg drops, drift rises, SANDBAG flag fires.)
  const sandbagCapture = (input: { vendor?: string; question?: string; prodAnswer?: string; testAnswer?: string; hedge?: string }) => {
    const vendor = input.vendor || "unknown";
    const question = (input.question || "").trim();
    const prodAnswer = (input.prodAnswer || "").trim();
    const testAnswer = (input.testAnswer || "").trim();
    if (!question || !prodAnswer || !testAnswer) {
      return { ok: false, error: "question + prodAnswer + testAnswer all required" };
    }
    // Probe id derived from question — stable across re-asks.
    const probeId = "auto-" + question.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24).replace(/^-|-$/g, "");
    core.aegis.polygraph.registerProbe(repoRoot, {
      id: probeId,
      question,
      groundTruth: prodAnswer, // PROD answer is the consistency anchor
      tags: ["auto-capture", "sandbag"],
    });
    const prodResult = core.aegis.polygraph.recordAnswer(repoRoot, {
      probeId, vendor, answer: prodAnswer, contextWasTest: false,
    });
    const testResult = core.aegis.polygraph.recordAnswer(repoRoot, {
      probeId, vendor, answer: testAnswer, contextWasTest: true,
    });
    return {
      ok: true,
      probeId,
      vendor,
      hedge: input.hedge,
      prod: { agreement: prodResult.agreement },
      test: { agreement: testResult.agreement },
      drift: prodResult.agreement - testResult.agreement,
    };
  };

  // Precog / Sentinel / Apoptosis handlers are intentionally NOT wired yet
  // (the browser polygraph is the v2.19.80 scope).  Other consumers can
  // pass their own handlers when they start the bridge from code.
  const handle = await core.diaspora.startBridge(
    {
      repoRoot,
      port: opts.port,
      host: opts.host,
    },
    {
      polygraphVerify,
      pulseRecord,
      pulseAggregate,
      sandbagCapture,
      // v2.19.86 — IDEA #3 + #4 handlers. Both ride on the pulse ledger:
      // the honesty cert mints from the aggregate; the timeline buckets
      // the raw events. Zero new write paths.
      honestyMint: (input: { vendor: string; windowDays?: number; validDays?: number }) => {
        const events = core.worldPulse.readPulseEvents(repoRoot);
        const windowDays = input.windowDays ?? 30;
        const agg = core.worldPulse.aggregatePulse(events, { windowHours: windowDays * 24 });
        const score = core.honestyCert.computeHonestyScore(agg, input.vendor, { windowDays });
        const cert = core.honestyCert.mintCert(repoRoot, score, { validDays: input.validDays });
        const svg = core.honestyCert.renderCertSvg(cert);
        return { ok: true, cert, score, svg };
      },
      honestyVerify: (input: { cert?: unknown; svg?: string }) => {
        if (typeof input.svg === "string") return core.honestyCert.verifyCertSvg(repoRoot, input.svg);
        if (input.cert && typeof input.cert === "object") {
          return core.honestyCert.verifyCert(repoRoot, input.cert as Parameters<typeof core.honestyCert.verifyCert>[1]);
        }
        return { valid: false, reason: "malformed" };
      },
      timelineSeries: (input: { vendor: string; windowDays?: number; bucketHours?: number }) => {
        const events = core.worldPulse.readPulseEvents(repoRoot);
        return core.timeMachine.buildTimeline(events, input.vendor, { windowDays: input.windowDays, bucketHours: input.bucketHours });
      },
      // v2.41.0 — ARGUS-11 multimodal search route. Any AI vendor
      // (browser AI / cron / curl / non-MCP editor) can rank candidates
      // against a query via JSON. Uses the multimodal engine (bloom +
      // phantom + parallel) for sub-50ms response on typical workloads.
      argusSearch: async (input: { query: string; candidates: Array<{ text: string; meta?: object }>; topK?: number }) => {
        const argusInput: Parameters<typeof core.argus10.argusSearchMultimodal>[0] = {
          query: input.query,
          candidates: input.candidates.map((c) => ({ text: c.text, meta: c.meta as Parameters<typeof core.argus10.argusSearchMultimodal>[0]["candidates"][number]["meta"] })),
          repoRoot,
        };
        if (typeof input.topK === "number") argusInput.topK = input.topK;
        return await core.argus10.argusSearchMultimodal(argusInput);
      },
      argusAdapters: () => {
        return {
          count: core.argus10.countAdapters(),
          adapters: core.argus10.listAdapters(),
        };
      },
    },
  );

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      ok: true,
      url: handle.baseUrl,
      token: handle.token,
      protocols: ["polygraph"],
    }, null, 2) + "\n");
  } else {
    process.stdout.write(`${BANNER} — running\n\n`);
    process.stdout.write(`  url:     ${handle.baseUrl}\n`);
    process.stdout.write(`  token:   ${handle.token.slice(0, 16)}…  (full token at .mneme/http-token)\n`);
    process.stdout.write(`  routes:  /v1/ping  /v1/health  /v1/openapi.json  /v1/polygraph/verify  /v1/argus/search  /v1/argus/adapters\n\n`);
    process.stdout.write(`  Browser Polygraph is now armed.  Open claude.ai / chatgpt.com /\n`);
    process.stdout.write(`  gemini.google.com (with the Mneme userscript installed) and ask any\n`);
    process.stdout.write(`  factual question — coloured dots will appear next to each AI sentence\n`);
    process.stdout.write(`  in real time.  Ctrl-C to stop the bridge.\n`);
  }

  // Keep the process alive until SIGINT / SIGTERM.
  const stop = async (signal: string) => {
    process.stdout.write(`\n${BANNER} — stopping (${signal})…\n`);
    await handle.stop();
    process.exit(0);
  };
  process.on("SIGINT",  () => { void stop("SIGINT"); });
  process.on("SIGTERM", () => { void stop("SIGTERM"); });
}
