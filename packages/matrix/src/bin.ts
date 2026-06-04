#!/usr/bin/env node
/**
 * `mneme-matrix` — serve the Matrix Rail gRPC wire server on 127.0.0.1, or self-test.
 *   mneme-matrix serve [--port 50561]
 *   mneme-matrix selftest
 */
import { createMatrixServer } from "./server.js";
import { grpcGauntlet } from "./gauntlet.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0] ?? "serve";

  if (cmd === "selftest") {
    const g = await grpcGauntlet();
    process.stdout.write(`🛰 MATRIX gRPC self-test — ${g.score}/100\n`);
    for (const c of g.checks) process.stdout.write(`  ${c.pass ? "✓" : "✗"} ${c.name} — ${c.detail}\n`);
    process.stdout.write(`  metrics: health ${g.metrics.healthMs}ms · ping ${g.metrics.pingMs}ms · ${(g.metrics.largePayloadBytes / 1e6).toFixed(1)}MB round-trip ${g.metrics.roundTripMs}ms\n`);
    process.exit(g.score === 100 ? 0 : 2);
  }

  if (cmd === "serve") {
    const pIdx = args.indexOf("--port");
    const port = pIdx >= 0 ? parseInt(args[pIdx + 1] ?? "0", 10) : 50561;
    const srv = await createMatrixServer({ port });
    process.stdout.write(`🛰 Matrix Rail gRPC on 127.0.0.1:${srv.port} (loopback only · proof-carrying · chunked pipe). Ctrl-C to stop.\n`);
    process.on("SIGINT", () => { srv.stop().then(() => process.exit(0)); });
    process.on("SIGTERM", () => { srv.stop().then(() => process.exit(0)); });
    return;
  }

  process.stderr.write(`unknown command: ${cmd}\nusage: mneme-matrix serve [--port N] | selftest\n`);
  process.exit(1);
}

main().catch((e) => { process.stderr.write(`matrix error: ${(e as Error).message}\n`); process.exit(1); });
