import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { createXRayServer } from "./server.js";
import { buildXRay } from "./engine.js";
import { sealXRay } from "./sign.js";
import { publishReport } from "./publish.js";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// isolate the server's data dir so the bridge test doesn't touch real data
process.env.XRAY_DATA_DIR = mkdtempSync(join(tmpdir(), "xray-test-"));
const server = createXRayServer();
let base = "";

async function start(): Promise<void> {
  if (base) return;
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address() as AddressInfo;
  base = `http://127.0.0.1:${a.port}`;
}
beforeAll(start);
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("@mneme-ai/xray server (no network)", () => {
  it("health, UI, and input validation wire up correctly", async () => {
    await start();

    const health = await (await fetch(`${base}/api/health`)).json();
    expect(health.ok).toBe(true);

    const ui = await (await fetch(`${base}/`)).text();
    expect(ui).toContain("Repo X-Ray");

    // private/credentialed/non-allowlisted URLs are refused BEFORE any clone
    const bad = await fetch(`${base}/api/xray`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ gitUrl: "https://evil.example.com/a/b" }),
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/public/i);

    const board = await (await fetch(`${base}/api/board`)).json();
    expect(Array.isArray(board.board)).toBe(true);
  }, 30_000);

  it("THE BRIDGE: publishes a locally-built signed report; rejects tampered/leaking", async () => {
    await start();
    // build a real report on THIS repo locally, sign it (the local-agent step)
    const report = await buildXRay({ repoPath: repoRoot });
    const signed = sealXRay(repoRoot, report);
    const token = "test-key-123";

    // publish via the client → server verifies signature + raw-free, files under profile
    const pr = await publishReport(base, token, signed);
    expect(pr.ok).toBe(true);
    expect(pr.fingerprint).toBe(report.fingerprint);

    // it now appears in that token's profile
    const prof = await (await fetch(`${base}/api/profile/${pr.profileId}`)).json();
    expect(prof.reports.some((x: { fingerprint: string }) => x.fingerprint === report.fingerprint)).toBe(true);

    // deep-view: the full signed report is retrievable by fingerprint
    const full = await (await fetch(`${base}/api/report/${report.fingerprint}`)).json();
    expect(full.report.fingerprint).toBe(report.fingerprint);

    // tampering the report breaks the signature → ingest refuses
    const tampered = { receipt: signed.receipt, report: { ...report, summary: { ...report.summary, grade: "A" } } };
    const bad = await fetch(`${base}/api/ingest`, {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token },
      body: JSON.stringify(tampered),
    });
    expect(bad.status).toBe(422);

    // missing token → 401
    const noTok = await fetch(`${base}/api/ingest`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(signed),
    });
    expect(noTok.status).toBe(401);
  }, 120_000);
});
