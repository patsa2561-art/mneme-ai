/**
 * THE LOCAL BRIDGE — how the cloud website reads a LOCAL folder without the
 * code ever leaving the machine.
 *
 * The user runs `npx @mneme-ai/xray bridge` on their own machine. It starts a
 * tiny server bound to 127.0.0.1 only. The website (https://xray.mneme-ai.space)
 * fetches it over localhost — browsers exempt http://localhost from mixed-content
 * blocking, so an https page may call it. The bridge analyses the local path and
 * returns ONLY a signed, raw-free report. The cloud server is never involved;
 * the source never moves. The page renders the report exactly like a cloud scan.
 *
 *   GET  /bridge/ping            → { ok, version }      (the page auto-detects it)
 *   POST /bridge/xray { path }   → build local X-Ray → raw-free gate → sign → return
 */
import { createServer, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildXRay } from "./engine.js";
import { sealXRay } from "./sign.js";
import { xrayLeaksRaw } from "./privacy.js";
import { buildContextPack } from "./pack.js";

const ALLOW = [
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
  /^https:\/\/xray\.mneme-ai\.space$/,
  /^https:\/\/xray\.161\.35\.122\.73\.nip\.io$/,
];
function version(): string {
  try {
    const p = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    return (JSON.parse(readFileSync(p, "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch { return "0.0.0"; }
}
function cors(res: ServerResponse, origin: string | undefined) {
  const ok = origin && ALLOW.some((re) => re.test(origin));
  res.setHeader("access-control-allow-origin", ok ? origin! : "https://xray.mneme-ai.space");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("vary", "origin");
}
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export function runBridge(port = 7799): void {
  const server = createServer(async (req, res) => {
    cors(res, req.headers.origin as string | undefined);
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/bridge/ping") {
      return json(res, 200, { ok: true, agent: "mneme-xray-bridge", version: version() });
    }
    if (req.method === "POST" && url.pathname === "/bridge/xray") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        try {
          const { path } = JSON.parse(body || "{}") as { path?: string };
          if (!path || !existsSync(path)) return json(res, 400, { error: "path does not exist on this machine: " + (path || "(empty)") });
          const report = await buildXRay({ repoPath: path });
          if (xrayLeaksRaw(report).leaks) return json(res, 500, { error: "internal: raw-free gate" });
          const signed = sealXRay(existsSync(path) ? path : process.cwd(), report);
          process.stdout.write(`  ✓ local X-Ray: ${path} → grade ${report.summary.grade} (source never left this machine)\n`);
          return json(res, 200, signed);
        } catch (e) {
          return json(res, 500, { error: (e as Error).message.slice(0, 300) });
        }
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/bridge/pack") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const { path, budget } = JSON.parse(body || "{}") as { path?: string; budget?: number };
          if (!path || !existsSync(path)) return json(res, 400, { error: "path does not exist on this machine: " + (path || "(empty)") });
          const pack = buildContextPack(path, { budget: budget || 120_000 });
          process.stdout.write(`  ✓ local AI Context Pack: ${path} → ~${pack.estTokens} tokens (${pack.secretsRedacted} secrets redacted; source never left this machine)\n`);
          return json(res, 200, pack);
        } catch (e) {
          return json(res, 500, { error: (e as Error).message.slice(0, 300) });
        }
      });
      return;
    }
    json(res, 404, { error: "not found" });
  });
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(
      `\n  🖥  Mneme X-Ray — LOCAL BRIDGE running at http://127.0.0.1:${port}\n` +
      `  Open https://xray.mneme-ai.space → it auto-detects this bridge → scan any local folder.\n` +
      `  Your source never leaves this machine. Ctrl-C to stop.\n\n`,
    );
  });
  process.on("SIGINT", () => { server.close(() => process.exit(0)); });
}
