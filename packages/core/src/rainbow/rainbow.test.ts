import { describe, it, expect } from "vitest";

import { probeChannels, buildDataBridgeUrl } from "./handoff.js";

const fakeSoul = { text: "# SOUL\nbody", estTokens: 100, id: "abc", hmac: null };

describe("v1.89 RAINBOW · channel probe", () => {
  it("data-bridge recommended when both LAN + dpaste available", () => {
    const r = probeChannels(fakeSoul, { lanUrl: "http://192.168.1.10:7741", dpasteUrl: "https://dpaste.com/x" });
    expect(r.recommended).toBe("data-bridge");
    expect(r.channels.find((c) => c.id === "data-bridge")?.available).toBe(true);
    expect(r.channels.find((c) => c.id === "lan")?.available).toBe(true);
    expect(r.channels.find((c) => c.id === "dpaste-raw")?.available).toBe(true);
  });

  it("falls back to LAN when no dpaste", () => {
    const r = probeChannels(fakeSoul, { lanUrl: "http://192.168.1.10:7741", dpasteUrl: null });
    expect(r.recommended).toBe("lan");
    expect(r.channels.find((c) => c.id === "data-bridge")?.available).toBe(false);
  });

  it("falls back to dpaste-raw when no LAN", () => {
    const r = probeChannels(fakeSoul, { lanUrl: null, dpasteUrl: "https://dpaste.com/x" });
    // data-bridge actually wins because it works any-network without LAN.
    expect(r.recommended).toBe("data-bridge");
  });

  it("returns null recommendation when no channels available", () => {
    const r = probeChannels(fakeSoul, { lanUrl: null, dpasteUrl: null });
    expect(r.recommended).toBeNull();
  });

  it("roadmap channels (ggwave/cloudflared/webrtc) reported as not-yet-live", () => {
    const r = probeChannels(fakeSoul, { lanUrl: null, dpasteUrl: null });
    for (const id of ["ggwave", "cloudflared", "webrtc"] as const) {
      const c = r.channels.find((x) => x.id === id);
      expect(c?.available).toBe(false);
      expect(c?.reason).toContain("v1.90");
    }
  });

  it("scenario coverage matches matrix", () => {
    const r = probeChannels(fakeSoul, { lanUrl: "x", dpasteUrl: "y" });
    expect(r.channels.find((c) => c.id === "lan")?.scenarios).toEqual([1, 4, 5]);
    expect(r.channels.find((c) => c.id === "data-bridge")?.scenarios).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("summary mentions live channel count", () => {
    const r = probeChannels(fakeSoul, { lanUrl: "x", dpasteUrl: "y" });
    expect(r.summary).toContain("3/3");
  });
});

describe("v1.89 RAINBOW · data: URL bridge", () => {
  it("buildDataBridgeUrl wraps a dpaste URL into a data: HTML page", () => {
    const url = buildDataBridgeUrl("https://dpaste.com/abc.txt");
    expect(url.startsWith("data:text/html")).toBe(true);
    const decoded = decodeURIComponent(url.slice("data:text/html;charset=utf-8,".length));
    expect(decoded).toContain("https://dpaste.com/abc.txt");
    expect(decoded).toContain("navigator.share");
    expect(decoded).toContain("Mneme handoff");
  });

  it("data: URL stays under 2KB (fits comfortably in QR)", () => {
    const url = buildDataBridgeUrl("https://dpaste.com/abcdefghij.txt");
    expect(url.length).toBeLessThan(2048);
  });
});
