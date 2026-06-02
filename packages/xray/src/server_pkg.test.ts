import { describe, it, expect, afterAll } from "vitest";
import { createXRayServer } from "./server.js";
import type { AddressInfo } from "node:net";

const server = createXRayServer();
let base = "";

async function start(): Promise<void> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address() as AddressInfo;
  base = `http://127.0.0.1:${a.port}`;
}
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
});
