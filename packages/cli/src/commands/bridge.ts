/**
 * v2.19.80 — `mneme bridge` CLI.
 *
 * Runs the diaspora HTTP bridge in the foreground with all handlers
 * wired up — including the new polygraph route consumed by the browser
 * userscript.
 *
 * Usage:
 *   mneme bridge                  start on :11434, Ctrl-C to stop
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
}

const BANNER = "🌉 MNEME BRIDGE";

export async function bridgeCommand(opts: BridgeCommandOptions): Promise<void> {
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
    process.stdout.write(`  routes:  /v1/ping  /v1/health  /v1/openapi.json  /v1/polygraph/verify\n\n`);
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
