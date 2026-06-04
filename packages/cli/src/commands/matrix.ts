/**
 * `mneme matrix` (v2.166.0) — THE MATRIX RAIL pipe core. The transport-agnostic,
 * gRPC-ready pipe that flows ANY payload (0 B → tens of MB, binary, unicode)
 * byte-identical through ordered, compressed, hash-manifested frames — or says
 * exactly why. Run the self-test (pipe integrity + corruption + size A/B) or
 * measure a file's wire cost.
 *
 *   mneme matrix                 # self-test: pipe + corruption + size A/B (gauntlet)
 *   mneme matrix bench <file>    # measure raw-JSON vs rail-wire bytes for a file
 *   mneme matrix --json
 */
import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { matrix } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

export function registerMatrixCommands(program: Command): void {
  const m = program
    .command("matrix")
    .description("🛰 THE MATRIX RAIL — the local-first, gRPC-ready pipe core. Flows ANY payload (0 bytes → tens of MB, raw binary, unicode) byte-identical through ordered, compressed, hash-manifested frames; catches every dropped/reordered/duplicated/tampered chunk; compresses the wire. Run with no args for the self-test (pipe integrity + corruption + size A/B). The transport substance under the gRPC server.")
    .option("--json", "JSON output.")
    .action((opts: { json?: boolean }) => {
      const g = matrix.matrixGauntlet();
      if (opts.json) { out(JSON.stringify(g, null, 2)); if (g.score !== 100) process.exitCode = 2; return; }
      out(`🛰 MATRIX RAIL — pipe self-test  (gauntlet ${g.score}/100)`);
      out("");
      out(`  PIPE INTEGRITY   ${g.pipe.passed}/${g.pipe.cases} pathological payloads round-trip byte-identical (0B · 1B · 5MB · binary · unicode · nested)`);
      out(`  CORRUPTION       ${g.corruption.caught}/${g.corruption.cases} tamper classes caught (dropped · reordered · duplicate · flipped byte · manifest tamper) — no silent pass`);
      out(`  SIZE A/B         raw JSON ${g.ab.rawBytes.toLocaleString()} B → wire ${g.ab.wireBytes.toLocaleString()} B  (−${g.ab.savedPct}% on the wire, ${g.ab.frames} frame(s))`);
      out("");
      for (const c of g.checks) out(`  ${c.pass ? "✓" : "✗"} ${c.name} — ${c.detail}`);
      out("");
      out(`  The pipe is transport-agnostic (gRPC-ready). A large payload auto-splits into frames — gRPC's 4MB cap is not a wall. Every frame is hash-manifested; corruption is caught, never silently passed.`);
      if (g.score !== 100) process.exitCode = 2;
    });

  // The gRPC wire server lives in the optional @mneme-ai/matrix package (it pulls
  // @grpc/grpc-js). Lazy-import + fail-open so the core CLI never hard-depends on it.
  interface Wire {
    createMatrixServer: (o: { port: number }) => Promise<{ port: number; stop: () => Promise<void> }>;
    grpcGauntlet: () => Promise<{ score: number; checks: Array<{ name: string; pass: boolean; detail: string }>; metrics: Record<string, number> }>;
  }
  async function loadWire(): Promise<Wire | null> {
    try { return (await import("@mneme-ai/matrix" as string)) as unknown as Wire; }
    catch { out("🛰 the gRPC wire server needs @mneme-ai/matrix — install it: npm i @mneme-ai/matrix"); return null; }
  }

  m.command("serve")
    .description("Serve the Matrix Rail gRPC wire server on 127.0.0.1 (loopback only). Any AI agent / language connects to reach every Mneme function over HTTP/2 + Protobuf.")
    .option("--port <n>", "port (default 50561)", "50561")
    .action(async (opts: { port?: string }) => {
      const wire = await loadWire(); if (!wire) { process.exitCode = 2; return; }
      const srv = await wire.createMatrixServer({ port: parseInt(opts.port ?? "50561", 10) });
      out(`🛰 Matrix Rail gRPC on 127.0.0.1:${srv.port} (loopback · proof-carrying · chunked pipe). Ctrl-C to stop.`);
      process.on("SIGINT", () => { srv.stop().then(() => process.exit(0)); });
      process.on("SIGTERM", () => { srv.stop().then(() => process.exit(0)); });
    });

  m.command("ensure")
    .description("Idempotent zero-command auto-start: if the rail is already running (live pid in .mneme/matrix.json) do nothing, else spawn it detached. Safe to call every session (e.g. from a SessionStart hook) — never piles up processes.")
    .option("--port <n>", "port (default 50561)", "50561")
    .action(async (opts: { port?: string }) => {
      const cwd = process.cwd();
      const disc = join(cwd, ".mneme", "matrix.json");
      // already up? (pid-alive check prevents the duplicate-process pile-up class)
      try {
        if (existsSync(disc)) {
          const j = JSON.parse(readFileSync(disc, "utf8")) as { pid?: number; port?: number };
          if (j.pid) { try { process.kill(j.pid, 0); out(`🛰 Matrix Rail already up on 127.0.0.1:${j.port}`); return; } catch { /* stale pid → fall through to (re)start */ } }
        }
      } catch { /* */ }
      const wire = await loadWire(); if (!wire) { return; } // fail-open: message printed
      const { spawn } = await import("node:child_process");
      const child = spawn(process.execPath, [process.argv[1] ?? "", "matrix", "serve", "--port", opts.port ?? "50561"], { cwd, detached: true, stdio: "ignore" });
      child.unref();
      out(`🛰 Matrix Rail starting (detached) on 127.0.0.1:${opts.port ?? "50561"} — agents read .mneme/matrix.json`);
    });

  m.command("wire-test")
    .description("Live gRPC self-test: spin up the server on an ephemeral loopback port, round-trip (incl a 5MB+ payload through the chunked pipe), measure, shut down.")
    .action(async () => {
      const wire = await loadWire(); if (!wire) { process.exitCode = 2; return; }
      const g = await wire.grpcGauntlet();
      out(`🛰 MATRIX gRPC wire-test — ${g.score}/100`);
      for (const c of g.checks) out(`  ${c.pass ? "✓" : "✗"} ${c.name} — ${c.detail}`);
      out(`  metrics: health ${g.metrics.healthMs}ms · ping ${g.metrics.pingMs}ms · ${(g.metrics.largePayloadBytes / 1e6).toFixed(1)}MB round-trip ${g.metrics.roundTripMs}ms`);
      if (g.score !== 100) process.exitCode = 2;
    });

  m.command("search <intent...>")
    .description("🧠 WISDOM SEARCH — type what you WANT in plain language; get the right Mneme tool(s) ranked (BM25 + curated-trigger wisdom, no LLM). The autonomous-discovery path an agent uses to pick a tool by intent.")
    .option("--limit <n>", "max hits (default 8)", "8")
    .option("--json", "JSON output.")
    .action(async (intent: string[], opts: { limit?: string; json?: boolean }) => {
      const wire = await loadWire(); if (!wire) { process.exitCode = 2; return; }
      // search runs LOCALLY off the tool registry — no server needed.
      const w = wire as unknown as { buildSearchIndex: (t: unknown[]) => unknown; searchTools: (i: unknown, q: string, n?: number) => Array<{ name: string; description: string; score: number; why: string }> };
      const { buildToolMap } = await import("@mneme-ai/mcp" as string) as { buildToolMap: () => Map<string, unknown> };
      const tools = [...buildToolMap().values()];
      const idx = w.buildSearchIndex(tools);
      const hits = w.searchTools(idx, intent.join(" "), parseInt(opts.limit ?? "8", 10));
      if (opts.json) { out(JSON.stringify(hits, null, 2)); return; }
      if (!hits.length) { out(`no tool matched “${intent.join(" ")}” — try different words`); return; }
      out(`🧠 intent: “${intent.join(" ")}”`);
      for (const h of hits) out(`  ${h.score.toFixed(2)}  ${h.name}  — ${h.why}\n        ${h.description.slice(0, 90)}`);
    });

  m.command("tools [query]")
    .description("📚 List the discoverable tool surface (name + category) — optionally filtered. The CLI peer of the gRPC ListTools self-describing discovery.")
    .option("--limit <n>", "max (default 40)", "40")
    .action(async (query: string | undefined, opts: { limit?: string }) => {
      const { buildToolMap } = await import("@mneme-ai/mcp" as string) as { buildToolMap: () => Map<string, { name: string; category?: string; description?: string }> };
      const q = (query ?? "").toLowerCase();
      let all = [...buildToolMap().values()].filter((t) => t.name);
      const total = all.length;
      if (q) all = all.filter((t) => t.name.toLowerCase().includes(q) || String(t.category ?? "").toLowerCase().includes(q) || String(t.description ?? "").toLowerCase().includes(q));
      all.sort((a, b) => a.name.localeCompare(b.name));
      out(`📚 ${all.length}${q ? `/${total}` : ""} tool(s)${q ? ` matching “${query}”` : ""}:`);
      for (const t of all.slice(0, parseInt(opts.limit ?? "40", 10))) out(`  ${t.name}  · ${t.category ?? ""}`);
    });

  m.command("bench <file>")
    .description("Measure a file's wire cost: raw JSON utf8 bytes vs the rail's compressed frames.")
    .option("--json", "JSON output.")
    .action((file: string, opts: { json?: boolean }) => {
      if (!existsSync(file)) { out(`file not found: ${file}`); process.exitCode = 2; return; }
      let value: unknown;
      const text = readFileSync(file, "utf8");
      try { value = JSON.parse(text); } catch { value = text; } // works for JSON or any text
      const ws = matrix.wireSize(value);
      if (opts.json) { out(JSON.stringify(ws, null, 2)); return; }
      out(`🛰 wire cost of ${file}:`);
      out(`   raw JSON : ${ws.rawBytes.toLocaleString()} B`);
      out(`   rail wire: ${ws.wireBytes.toLocaleString()} B  (−${ws.savedPct}% · ${ws.frames} frame(s))`);
    });
}
