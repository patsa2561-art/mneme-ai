import { describe, it, expect, afterEach } from "vitest";
import { spawnBeacon, qrForUrl, formatBeaconPulseLine, pasteCrossWifi, type BeaconResult } from "./index.js";

const pending: BeaconResult[] = [];
afterEach(() => {
  for (const r of pending) { try { r.server?.close(); } catch { /* BE:silent-by-design */ } }
  pending.length = 0;
});

describe("v2.9 BEACON", () => {
  it("spawnBeacon returns a token + clipboard + markdown paths even when no LAN", async () => {
    const r = await spawnBeacon({ payload: "soul prompt", port: 0 });
    pending.push(r);
    expect(r.token).toMatch(/^[0-9a-f]{12}$/);
    expect(r.paths.find((p) => p.id === "clipboard")).toBeDefined();
    expect(r.paths.find((p) => p.id === "markdown")).toBeDefined();
  });

  it("when server binds successfully, surfaces LAN URL(s)", async () => {
    const r = await spawnBeacon({ payload: "hello", port: 0 });
    pending.push(r);
    expect(r.server).not.toBeNull();
    expect(r.port).toBeGreaterThan(0);
    if (r.lanIPs.length > 0) {
      expect(r.paths.some((p) => p.id.startsWith("lan-url"))).toBe(true);
      // Each LAN URL should have an accompanying QR data: URI
      expect(r.paths.some((p) => p.id.startsWith("lan-qr") && p.content.startsWith("data:image/svg+xml;base64,"))).toBe(true);
    }
  });

  it("the served page contains the payload and a Copy button", async () => {
    const payload = "MAGIC-PAYLOAD-TOKEN-12345";
    const r = await spawnBeacon({ payload, port: 0, bindHost: "127.0.0.1" });
    pending.push(r);
    if (!r.port) return; // Skip on platforms where bind failed.
    const url = `http://127.0.0.1:${r.port}/${r.token}`;
    const resp = await fetch(url);
    expect(resp.ok).toBe(true);
    const html = await resp.text();
    expect(html).toContain(payload);
    expect(html).toContain("Copy soul prompt");
    expect(html).toContain("navigator.clipboard.writeText");
  });

  it("server XSS-escapes user-controlled payload + label", async () => {
    const r = await spawnBeacon({ payload: "<script>alert(1)</script>", label: '<img src=x>', port: 0, bindHost: "127.0.0.1" });
    pending.push(r);
    if (!r.port) return;
    const url = `http://127.0.0.1:${r.port}/${r.token}`;
    const html = await (await fetch(url)).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<img src=x>");
  });

  it("server 404s on unknown path", async () => {
    const r = await spawnBeacon({ payload: "x", port: 0, bindHost: "127.0.0.1" });
    pending.push(r);
    if (!r.port) return;
    const resp = await fetch(`http://127.0.0.1:${r.port}/wrong-token`);
    expect(resp.status).toBe(404);
  });

  it("qrForUrl returns a data:image/svg+xml URI for short URLs", () => {
    const uri = qrForUrl("http://192.168.1.10:7741/abc");
    expect(uri).not.toBeNull();
    expect(uri!.startsWith("data:image/svg+xml;base64,")).toBe(true);
  });

  it("formatBeaconPulseLine emits a compact summary", async () => {
    const r = await spawnBeacon({ payload: "x", port: 0 });
    pending.push(r);
    const line = formatBeaconPulseLine(r);
    expect(line).toContain("BEACON");
    expect(line).toContain("token=");
    expect(line).toContain("paths=");
  });

  it("pasteCrossWifi handles fetch failure gracefully", async () => {
    const r = await pasteCrossWifi("x", { fetchImpl: async () => { throw new Error("network down"); } });
    expect(r).toBeNull();
  });

  it("pasteCrossWifi returns null on non-OK response", async () => {
    const r = await pasteCrossWifi("x", { fetchImpl: async () => new Response("err", { status: 503 }) });
    expect(r).toBeNull();
  });

  it("pasteCrossWifi returns url object on success", async () => {
    const fakeFetch = async (): Promise<Response> => new Response("https://dpaste.com/ABC123", { status: 200 });
    const r = await pasteCrossWifi("x", { fetchImpl: fakeFetch });
    expect(r?.url).toBe("https://dpaste.com/ABC123");
    expect(r?.provider).toBe("dpaste");
  });

  it("pasteCrossWifi rejects malformed response body", async () => {
    const fakeFetch = async (): Promise<Response> => new Response("not-a-url", { status: 200 });
    const r = await pasteCrossWifi("x", { fetchImpl: fakeFetch });
    expect(r).toBeNull();
  });
});
