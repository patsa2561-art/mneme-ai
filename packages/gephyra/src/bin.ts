#!/usr/bin/env node
/**
 * `gephyra` — standalone CLI for the GEPHYRA bridge (zero extra deps).
 *
 *   gephyra serve [--port 17742] [--repo PATH]   run the Toll Booth as an HTTP endpoint
 *   gephyra cross --claim "..." --from AGENT      one-shot crossing (prints JSON)
 *   gephyra status [--repo PATH]                  live bridge status
 *   gephyra --version
 */

import { startServer, gephyra, GEPHYRA_DEFAULT_PORT } from "./index.js";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}
function out(s: string): void { process.stdout.write(s + "\n"); }

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const repoRoot = flag(args, "--repo") ?? process.cwd();

  if (args.includes("--version") || args.includes("-v")) {
    // Version is injected at build from package.json import is avoided; read lazily.
    try {
      const { readFileSync } = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      const { dirname, join } = await import("node:path");
      const here = dirname(fileURLToPath(import.meta.url));
      const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { version?: string };
      out(pkg.version ?? "unknown");
    } catch { out("unknown"); }
    return 0;
  }

  if (cmd === "serve") {
    const port = flag(args, "--port") ? Number(flag(args, "--port")) : GEPHYRA_DEFAULT_PORT;
    const handle = await startServer({ repoRoot, port });
    out(`🌉 GEPHYRA serving on http://127.0.0.1:${handle.port}  | POST /cross {claim, fromAgent} · GET /status`);
    out(`   (Ctrl-C to stop. Real-time truth-customs; every crossing recorded + Ed25519-stamped.)`);
    // Keep the process alive until killed.
    await new Promise<void>(() => { /* run forever */ });
    return 0;
  }

  if (cmd === "cross") {
    const claim = flag(args, "--claim");
    const from = flag(args, "--from");
    if (!claim || !from) { out("✗ gephyra cross requires --claim and --from"); return 2; }
    const r = await gephyra.crossBridge(repoRoot, { claim, fromAgent: from }, { verify: gephyra.apoptosisTruthCustoms(repoRoot) });
    out(JSON.stringify({ disposition: r.disposition, verdict: r.verdict, deliveredClaim: r.deliveredClaim, nudges: r.nudges, receiptId: r.receipt?.receiptId }, null, 2));
    return r.disposition === "QUARANTINED" ? 1 : 0;
  }

  if (cmd === "status") {
    out(JSON.stringify(gephyra.bridgeStatus(repoRoot), null, 2));
    return 0;
  }

  out("GEPHYRA — the Toll Booth of Truth");
  out("usage: gephyra serve [--port N] | cross --claim \"...\" --from AGENT | status | --version");
  return cmd ? 2 : 0;
}

main().then((code) => process.exit(code)).catch((e: Error) => { process.stderr.write(`gephyra: ${e.message}\n`); process.exit(1); });
