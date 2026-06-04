import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { createXRayServer } from "./server.js";
import { TrackerHub } from "./tracker_server.js";
import { remoteRef } from "./track.js";
import { buildXRay } from "./engine.js";
import { sealXRay } from "./sign.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function g(dir: string, args: string[]) { return spawnSync("git", args, { cwd: dir, encoding: "utf8" }); }
function commit(dir: string, msg: string) { g(dir, ["add", "-A"]); g(dir, ["commit", "-q", "-m", msg]); }

function post(port: number, path: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method: "POST", headers: { "content-type": "application/json" } }, (res) => {
      res.on("data", () => {}); res.on("end", () => resolve({ status: res.statusCode || 0 }));
    });
    req.on("error", reject); req.end("{}");
  });
}

describe("X-RAY real-time tracking — FULL STACK (HTTP server + SSE + real git change)", () => {
  it("a git push is detected and the analysis change is pushed to a subscribed browser over SSE — no re-click", { retry: 2, timeout: 60_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "xray-e2e-"));
    // local-repo scanner (the hosted server uses the same pipeline on public URLs)
    const hub = new TrackerHub({
      refOf: (target) => remoteRef(target),
      build: async (target) => { const report = await buildXRay({ repoPath: target }); return { report, signed: sealXRay(process.cwd(), report) }; },
    });
    const server = createXRayServer(undefined, hub);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;

    try {
      // 1) a clean repo, registered for tracking
      g(dir, ["init", "-q", "-b", "main"]); g(dir, ["config", "user.email", "t@t.dev"]); g(dir, ["config", "user.name", "T"]);
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "a.js"), "export const a = 1;\n");
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "d", version: "1.0.0" }));
      commit(dir, "clean");
      const { id } = await hub.createTrack(dir);

      // 2) a browser opens the report page → subscribes to live updates over SSE
      let buf = "";
      const sseReq = http.get({ host: "127.0.0.1", port, path: `/api/track/${id}/stream` }, (res) => { res.setEncoding("utf8"); res.on("data", (c) => { buf += c; }); });
      await sleep(300);
      expect(buf).toContain("event: hello");           // subscribed, got current state

      // 3) an AI/teammate pushes a change that introduces a hardcoded secret
      writeFileSync(join(dir, "src", "leak.js"), 'const k="AKIAIOSFODNN7EXAMPLE";const s="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";\n');
      commit(dir, "feat: integrate (leaked a key)");

      // 4) the webhook fires (true real-time path) → the server re-scans + broadcasts
      const wh = await post(port, `/api/track/${id}/webhook`);
      expect(wh.status).toBe(200);

      // 5) the OPEN browser receives the drift over SSE with NO re-click
      for (let i = 0; i < 50 && !buf.includes("event: update"); i++) await sleep(100);
      expect(buf).toContain("event: update");
      const frame = buf.split("event: update")[1];
      const payload = JSON.parse(frame.split("data: ")[1].split("\n\n")[0]);
      expect(payload.delta.drift).toBe("degraded");
      expect(payload.delta.newSecretLeaks).toBeGreaterThan(0);
      expect(payload.delta.highlights[0]).toMatch(/secret leak/);

      sseReq.destroy();
    } finally {
      hub.stop();
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
