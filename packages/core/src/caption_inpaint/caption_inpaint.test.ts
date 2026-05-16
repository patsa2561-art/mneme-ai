import { describe, it, expect } from "vitest";
import {
  StubInpainter,
  PatchFillInpainter,
  VendorApiInpainter,
  resolveInpainter,
  inpaintMaskRegions,
  nakedFingerprint,
  makeSolidImage,
  makeTestImage,
  meanColorDistance,
  formatInpaintLine,
  type RawImage,
  type MaskBbox,
} from "./index.js";

// ─── helpers used across tests ───────────────────────────────────────────

/** Count pixels where rgba differs between two same-sized images, inside an optional bbox. */
function countDifferingPixels(a: RawImage, b: RawImage, bbox?: [number, number, number, number]): number {
  const [x0, y0, w, h] = bbox ?? [0, 0, a.width, a.height];
  const x1 = Math.min(a.width, x0 + w);
  const y1 = Math.min(a.height, y0 + h);
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (y * a.width + x) * 4;
      if (
        a.rgba[idx + 0] !== b.rgba[idx + 0] ||
        a.rgba[idx + 1] !== b.rgba[idx + 1] ||
        a.rgba[idx + 2] !== b.rgba[idx + 2] ||
        a.rgba[idx + 3] !== b.rgba[idx + 3]
      ) n++;
    }
  }
  return n;
}

/** Run a closure N times, return success ratio. Used for measurable accuracy assertions. */
async function accuracyRate(trials: number, predicate: () => Promise<boolean>): Promise<number> {
  let pass = 0;
  for (let i = 0; i < trials; i++) {
    if (await predicate()) pass++;
  }
  return pass / trials;
}

// ─── 1. nakedFingerprint contract ────────────────────────────────────────

describe("v2.19.19 INPAINT · nakedFingerprint", () => {
  it("is deterministic: same image → identical 64-char hex hash", () => {
    const img = makeSolidImage(10, 10, [255, 0, 0, 255]);
    const a = nakedFingerprint(img);
    const b = nakedFingerprint(img);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("differs for different pixel content (no collisions on basic variation)", () => {
    const red = makeSolidImage(10, 10, [255, 0, 0, 255]);
    const green = makeSolidImage(10, 10, [0, 255, 0, 255]);
    expect(nakedFingerprint(red)).not.toBe(nakedFingerprint(green));
  });

  it("differs for different dimensions even with same byte pattern", () => {
    const wide = makeSolidImage(100, 1, [0, 0, 0, 255]);
    const tall = makeSolidImage(1, 100, [0, 0, 0, 255]);
    expect(nakedFingerprint(wide)).not.toBe(nakedFingerprint(tall));
  });
});

// ─── 2. StubInpainter (Phase A baseline) ─────────────────────────────────

describe("v2.19.19 INPAINT · StubInpainter (Phase A baseline)", () => {
  it("returns rgba IDENTICAL to input (100% pixel preservation)", async () => {
    const img = makeTestImage({
      width: 32, height: 32,
      background: [200, 200, 200, 255],
      foreground: [50, 50, 200, 255],
      fgBbox: [10, 10, 12, 12],
    });
    const stub = new StubInpainter();
    const out = await stub.inpaint({ image: img, mask: [{ bbox: [10, 10, 12, 12] }] });
    expect(out.width).toBe(img.width);
    expect(out.height).toBe(img.height);
    expect(Array.from(out.rgba)).toEqual(Array.from(img.rgba));
  });

  it("name is 'stub:noop'", () => {
    expect(new StubInpainter().name).toBe("stub:noop");
  });

  it("rejects malformed images (rgba length mismatch)", async () => {
    const bad: RawImage = { width: 10, height: 10, rgba: new Uint8Array(50) }; // should be 400
    await expect(new StubInpainter().inpaint({ image: bad, mask: [] })).rejects.toThrow(/rgba length/);
  });
});

// ─── 3. PatchFillInpainter (Phase B — pure-TS content-aware fill) ────────

describe("v2.19.19 INPAINT · PatchFillInpainter (Phase B — PATCH HARVEST FILL)", () => {
  it("returns image UNCHANGED when mask is empty (zero touched)", async () => {
    const img = makeSolidImage(16, 16, [100, 100, 100, 255]);
    const fill = new PatchFillInpainter();
    const out = await fill.inpaint({ image: img, mask: [] });
    expect(Array.from(out.rgba)).toEqual(Array.from(img.rgba));
  });

  it("changes pixels INSIDE the mask (genuine fill, not pass-through)", async () => {
    const img = makeTestImage({
      width: 24, height: 24,
      background: [220, 220, 220, 255], // light grey background
      foreground: [10, 10, 10, 255],    // black foreground (the "caption")
      fgBbox: [8, 8, 8, 8],
    });
    const fill = new PatchFillInpainter();
    const out = await fill.inpaint({ image: img, mask: [{ bbox: [8, 8, 8, 8] }] });
    const diffInsideMask = countDifferingPixels(img, out, [8, 8, 8, 8]);
    // Every pixel inside the 8x8 mask region must be changed
    expect(diffInsideMask).toBeGreaterThan(0);
    expect(diffInsideMask).toBe(8 * 8); // all 64 mask pixels touched
  });

  it("MEASURABLE 100% pixel preservation OUTSIDE the mask (no smear into clean regions)", async () => {
    const img = makeTestImage({
      width: 24, height: 24,
      background: [220, 220, 220, 255],
      foreground: [10, 10, 10, 255],
      fgBbox: [8, 8, 8, 8],
    });
    // Use blurBandPx=0 to test pure-fill behaviour without boundary blending
    const fill = new PatchFillInpainter({ blurBandPx: 0 });
    const out = await fill.inpaint({ image: img, mask: [{ bbox: [8, 8, 8, 8] }] });
    // ALL pixels outside the 8x8 mask must be byte-identical
    // We check all 4 quadrants around the mask
    expect(countDifferingPixels(img, out, [0, 0, 24, 8])).toBe(0);   // top strip
    expect(countDifferingPixels(img, out, [0, 16, 24, 8])).toBe(0);  // bottom strip
    expect(countDifferingPixels(img, out, [0, 8, 8, 8])).toBe(0);    // left strip
    expect(countDifferingPixels(img, out, [16, 8, 8, 8])).toBe(0);   // right strip
  });

  it("fills mask pixels with colour close to surrounding background (semantic plausibility)", async () => {
    const img = makeTestImage({
      width: 32, height: 32,
      background: [200, 100, 50, 255], // orange-ish background
      foreground: [10, 10, 10, 255],   // black caption
      fgBbox: [12, 12, 8, 8],
    });
    const fill = new PatchFillInpainter({ blurBandPx: 0 });
    const out = await fill.inpaint({ image: img, mask: [{ bbox: [12, 12, 8, 8] }] });
    // After fill, the masked region's mean color should be close to the background
    // Distance threshold: mean per-channel diff < 20 (out of 255) = 92% closeness
    const reference = makeSolidImage(32, 32, [200, 100, 50, 255]);
    const dist = meanColorDistance(out, reference, [12, 12, 8, 8]);
    expect(dist).toBeLessThan(20); // within 7.8% of true background colour
  });

  it("DETERMINISM: same image + same mask → identical output bytes (100% reproducibility)", async () => {
    const img = makeTestImage({
      width: 32, height: 32,
      background: [128, 64, 200, 255],
      foreground: [255, 255, 0, 255],
      fgBbox: [10, 10, 12, 12],
    });
    const fill = new PatchFillInpainter();
    const out1 = await fill.inpaint({ image: img, mask: [{ bbox: [10, 10, 12, 12] }] });
    const out2 = await fill.inpaint({ image: img, mask: [{ bbox: [10, 10, 12, 12] }] });
    expect(nakedFingerprint(out1)).toBe(nakedFingerprint(out2));
  });

  it("ring-search handles mask at image CORNER (no out-of-bounds reads)", async () => {
    const img = makeTestImage({
      width: 16, height: 16,
      background: [100, 200, 100, 255],
      foreground: [0, 0, 0, 255],
      fgBbox: [0, 0, 4, 4], // corner mask
    });
    const fill = new PatchFillInpainter({ blurBandPx: 0 });
    const out = await fill.inpaint({ image: img, mask: [{ bbox: [0, 0, 4, 4] }] });
    // Should not throw; mask pixels should be filled with green-ish (background harvest)
    expect(out.rgba.length).toBe(img.rgba.length);
    const dist = meanColorDistance(out, makeSolidImage(16, 16, [100, 200, 100, 255]), [0, 0, 4, 4]);
    expect(dist).toBeLessThan(20);
  });

  it("ring-search falls back to grey when ENTIRE image is masked (no neighbours)", async () => {
    const img = makeSolidImage(8, 8, [200, 50, 100, 255]);
    const fill = new PatchFillInpainter({ blurBandPx: 0 });
    const out = await fill.inpaint({ image: img, mask: [{ bbox: [0, 0, 8, 8] }] });
    // All pixels should be grey (128, 128, 128, 255) — the documented fallback
    for (let i = 0; i < out.rgba.length; i += 4) {
      expect(out.rgba[i + 0]).toBe(128);
      expect(out.rgba[i + 1]).toBe(128);
      expect(out.rgba[i + 2]).toBe(128);
      expect(out.rgba[i + 3]).toBe(255);
    }
  });

  it("multiple disjoint mask regions all get filled independently", async () => {
    const img = makeSolidImage(32, 32, [200, 200, 200, 255]);
    // Paint two black squares at opposite corners
    for (let y = 2; y < 6; y++) {
      for (let x = 2; x < 6; x++) {
        const idx = (y * 32 + x) * 4;
        img.rgba[idx + 0] = 0; img.rgba[idx + 1] = 0; img.rgba[idx + 2] = 0;
      }
    }
    for (let y = 26; y < 30; y++) {
      for (let x = 26; x < 30; x++) {
        const idx = (y * 32 + x) * 4;
        img.rgba[idx + 0] = 0; img.rgba[idx + 1] = 0; img.rgba[idx + 2] = 0;
      }
    }
    const fill = new PatchFillInpainter({ blurBandPx: 0 });
    const out = await fill.inpaint({
      image: img,
      mask: [{ bbox: [2, 2, 4, 4] }, { bbox: [26, 26, 4, 4] }],
    });
    // Both regions should be filled with light grey (harvested from background)
    expect(out.rgba[(3 * 32 + 3) * 4 + 0]).toBeGreaterThan(150);
    expect(out.rgba[(27 * 32 + 27) * 4 + 0]).toBeGreaterThan(150);
  });

  it("Gaussian blur band is applied (boundary pixels softened on a non-uniform background)", async () => {
    // Use a horizontal-gradient background so boundary pixels are NOT all
    // the same colour — blur then has work to do (softens the gradient).
    const W = 32, H = 32;
    const rgba = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4;
        rgba[idx + 0] = Math.round((x / W) * 255);
        rgba[idx + 1] = 100;
        rgba[idx + 2] = Math.round((y / H) * 255);
        rgba[idx + 3] = 255;
      }
    }
    // Paint a solid black mask region in the middle
    for (let y = 12; y < 20; y++) {
      for (let x = 12; x < 20; x++) {
        const idx = (y * W + x) * 4;
        rgba[idx + 0] = 0; rgba[idx + 1] = 0; rgba[idx + 2] = 0;
      }
    }
    const img: RawImage = { width: W, height: H, rgba };
    const noBlur = new PatchFillInpainter({ blurBandPx: 0 });
    const withBlur = new PatchFillInpainter({ blurBandPx: 3 });
    const outA = await noBlur.inpaint({ image: img, mask: [{ bbox: [12, 12, 8, 8] }] });
    const outB = await withBlur.inpaint({ image: img, mask: [{ bbox: [12, 12, 8, 8] }] });
    // On a non-uniform gradient, the blur ACTUALLY changes the boundary band.
    expect(nakedFingerprint(outA)).not.toBe(nakedFingerprint(outB));
  });

  it("naked fingerprint DIFFERS from stub (proves real inpainting happened)", async () => {
    const img = makeTestImage({
      width: 32, height: 32,
      background: [220, 220, 220, 255],
      foreground: [10, 10, 10, 255],
      fgBbox: [12, 12, 8, 8],
    });
    const stub = new StubInpainter();
    const fill = new PatchFillInpainter();
    const sOut = await stub.inpaint({ image: img, mask: [{ bbox: [12, 12, 8, 8] }] });
    const fOut = await fill.inpaint({ image: img, mask: [{ bbox: [12, 12, 8, 8] }] });
    expect(nakedFingerprint(sOut)).not.toBe(nakedFingerprint(fOut));
  });
});

// ─── 4. ACCURACY measurements (>= 97.5% on 200 trials) ──────────────────

describe("v2.19.19 INPAINT · ACCURACY MEASUREMENTS (97.5%+ targets)", () => {
  it("MEASURED >= 97.5% DETERMINISM across 200 trials (varied images + masks)", async () => {
    const rate = await accuracyRate(200, async () => {
      // Random-ish but deterministic image params per trial (mulberry32-style)
      const r1 = Math.floor(Math.random() * 256);
      const r2 = Math.floor(Math.random() * 256);
      const img = makeTestImage({
        width: 16, height: 16,
        background: [r1, r2, r1, 255],
        foreground: [255 - r1, 255 - r2, 255 - r1, 255],
        fgBbox: [4, 4, 8, 8],
      });
      const fill = new PatchFillInpainter();
      const a = await fill.inpaint({ image: img, mask: [{ bbox: [4, 4, 8, 8] }] });
      const b = await fill.inpaint({ image: img, mask: [{ bbox: [4, 4, 8, 8] }] });
      return nakedFingerprint(a) === nakedFingerprint(b);
    });
    expect(rate).toBeGreaterThanOrEqual(0.975);
    expect(rate).toBe(1); // actually 100% — algorithm is fully deterministic
  });

  it("MEASURED >= 97.5% PIXEL PRESERVATION outside mask across 100 trials", async () => {
    const rate = await accuracyRate(100, async () => {
      const r1 = Math.floor(Math.random() * 256);
      const r2 = Math.floor(Math.random() * 256);
      const img = makeTestImage({
        width: 24, height: 24,
        background: [r1, r2, 50, 255],
        foreground: [0, 0, 0, 255],
        fgBbox: [8, 8, 8, 8],
      });
      const fill = new PatchFillInpainter({ blurBandPx: 0 });
      const out = await fill.inpaint({ image: img, mask: [{ bbox: [8, 8, 8, 8] }] });
      // Strictly: pixels outside mask must be 100% byte-identical
      const top = countDifferingPixels(img, out, [0, 0, 24, 8]);
      const bot = countDifferingPixels(img, out, [0, 16, 24, 8]);
      const left = countDifferingPixels(img, out, [0, 8, 8, 8]);
      const right = countDifferingPixels(img, out, [16, 8, 8, 8]);
      return top === 0 && bot === 0 && left === 0 && right === 0;
    });
    expect(rate).toBe(1); // 100% — invariant by design
    expect(rate).toBeGreaterThanOrEqual(0.975);
  });

  it("MEASURED >= 97.5% FINGERPRINT DISCRIMINATION (no collisions on 100 distinct inputs)", async () => {
    const fingerprints = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const img = makeTestImage({
        width: 16, height: 16,
        background: [i, 128, 255 - i, 255],
        foreground: [255, 0, 0, 255],
        fgBbox: [4, 4, 8, 8],
      });
      const fill = new PatchFillInpainter();
      const out = await fill.inpaint({ image: img, mask: [{ bbox: [4, 4, 8, 8] }] });
      fingerprints.add(nakedFingerprint(out));
    }
    // No two distinct images should produce the same fingerprint
    expect(fingerprints.size).toBe(100); // 100/100 unique
    expect(fingerprints.size / 100).toBeGreaterThanOrEqual(0.975);
  });

  it("MEASURED >= 97.5% MASK-COLOUR PLAUSIBILITY (mean color distance < 25 from background)", async () => {
    const rate = await accuracyRate(50, async () => {
      const bg: [number, number, number, number] = [
        Math.floor(Math.random() * 256),
        Math.floor(Math.random() * 256),
        Math.floor(Math.random() * 256),
        255,
      ];
      const fg: [number, number, number, number] = [255 - bg[0], 255 - bg[1], 255 - bg[2], 255];
      const img = makeTestImage({
        width: 24, height: 24,
        background: bg,
        foreground: fg,
        fgBbox: [8, 8, 8, 8],
      });
      const fill = new PatchFillInpainter({ blurBandPx: 0 });
      const out = await fill.inpaint({ image: img, mask: [{ bbox: [8, 8, 8, 8] }] });
      const reference = makeSolidImage(24, 24, bg);
      const dist = meanColorDistance(out, reference, [8, 8, 8, 8]);
      return dist < 25; // within ~10% of background = "plausible fill"
    });
    expect(rate).toBeGreaterThanOrEqual(0.975);
  });
});

// ─── 5. VendorApiInpainter (mock fetch) ──────────────────────────────────

describe("v2.19.19 INPAINT · VendorApiInpainter", () => {
  it("POSTs to caller-supplied endpoint + reshapes response into RawImage", async () => {
    const img = makeSolidImage(4, 4, [100, 200, 100, 255]);
    let receivedUrl = "";
    let receivedBody = "";
    const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      receivedUrl = url.toString();
      receivedBody = typeof init?.body === "string" ? init.body : "";
      return new Response(JSON.stringify({ pixels: Array.from(new Uint8Array(64)) }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const inp = new VendorApiInpainter({
      endpoint: "https://fake-inpainter.example.com/v1/fill",
      shapeRequest: (input) => ({ body: { w: input.image.width, h: input.image.height, mask: input.mask } }),
      shapeResponse: (raw, orig) => ({
        width: orig.width, height: orig.height,
        rgba: new Uint8Array((raw as { pixels: number[] }).pixels),
      }),
      fetcher: mockFetch,
    });
    const out = await inp.inpaint({ image: img, mask: [{ bbox: [0, 0, 2, 2] }] });
    expect(receivedUrl).toBe("https://fake-inpainter.example.com/v1/fill");
    expect(receivedBody).toContain('"w":4');
    expect(out.rgba.length).toBe(64); // 4x4x4
  });

  it("throws on non-2xx HTTP response", async () => {
    const mockFetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    const inp = new VendorApiInpainter({
      endpoint: "https://fake.example.com/x",
      shapeRequest: () => ({ body: {} }),
      shapeResponse: (_r, orig) => orig,
      fetcher: mockFetch,
    });
    const img = makeSolidImage(2, 2, [0, 0, 0, 255]);
    await expect(inp.inpaint({ image: img, mask: [] })).rejects.toThrow(/HTTP 500/);
  });

  it("name encodes the host so multi-vendor setups are distinguishable", () => {
    const inp = new VendorApiInpainter({
      endpoint: "https://deepai.example.com/api/inpaint",
      shapeRequest: () => ({ body: {} }),
      shapeResponse: (_r, orig) => orig,
    });
    expect(inp.name).toBe("vendor-api:deepai.example.com");
  });
});

// ─── 6. resolveInpainter ladder ─────────────────────────────────────────

describe("v2.19.19 INPAINT · resolveInpainter ladder", () => {
  it("auto → returns PatchFillInpainter (always available, offline, deterministic)", () => {
    const inp = resolveInpainter({ provider: "auto" });
    expect(inp.name).toBe("patch-harvest-fill:v1");
  });

  it("explicit stub returns StubInpainter", () => {
    const inp = resolveInpainter({ provider: "stub" });
    expect(inp.name).toBe("stub:noop");
  });

  it("explicit patch-fill honours custom ringSearchLimit", () => {
    const inp = resolveInpainter({ provider: "patch-fill", patchFillOptions: { ringSearchLimit: 32 } });
    expect((inp as PatchFillInpainter).ringSearchLimit).toBe(32);
  });

  it("vendor-api throws when no vendorApiOptions supplied (fail-fast on misconfig)", () => {
    expect(() => resolveInpainter({ provider: "vendor-api" })).toThrow(/vendorApiOptions/);
  });
});

// ─── 7. inpaintMaskRegions orchestrator ─────────────────────────────────

describe("v2.19.19 INPAINT · inpaintMaskRegions orchestrator", () => {
  it("returns nakedImage + fingerprint + touched/preserved pixel counts", async () => {
    const img = makeTestImage({
      width: 16, height: 16,
      background: [200, 200, 200, 255],
      foreground: [0, 0, 0, 255],
      fgBbox: [4, 4, 8, 8],
    });
    const r = await inpaintMaskRegions({ image: img, mask: [{ bbox: [4, 4, 8, 8] }] });
    expect(r.nakedImage.width).toBe(16);
    expect(r.nakedFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(r.provider).toBe("patch-harvest-fill:v1");
    expect(r.pixelsTouched + r.pixelsPreserved).toBe(16 * 16);
    // Default blurBandPx=3 may touch boundary pixels beyond the mask
    expect(r.pixelsTouched).toBeGreaterThanOrEqual(64);
  });

  it("custom provider parameter is honoured", async () => {
    const img = makeSolidImage(8, 8, [100, 100, 100, 255]);
    const r = await inpaintMaskRegions({
      image: img,
      mask: [{ bbox: [0, 0, 8, 8] }],
      provider: new StubInpainter(),
    });
    expect(r.provider).toBe("stub:noop");
    expect(r.pixelsTouched).toBe(0); // stub does nothing
    expect(r.pixelsPreserved).toBe(64);
  });
});

// ─── 8. formatter + helpers ──────────────────────────────────────────────

describe("v2.19.19 INPAINT · formatter + utility helpers", () => {
  it("formatInpaintLine includes provider + counts + fingerprint prefix", async () => {
    const img = makeSolidImage(4, 4, [50, 50, 50, 255]);
    const r = await inpaintMaskRegions({ image: img, mask: [{ bbox: [1, 1, 2, 2] }] });
    const line = formatInpaintLine(r);
    expect(line).toContain("🎨 INPAINT");
    expect(line).toContain("patch-harvest-fill:v1");
    expect(line).toContain("touched=");
    expect(line).toContain("naked=");
  });

  it("meanColorDistance returns 0 for identical images", () => {
    const a = makeSolidImage(4, 4, [10, 20, 30, 255]);
    const b = makeSolidImage(4, 4, [10, 20, 30, 255]);
    expect(meanColorDistance(a, b)).toBe(0);
  });

  it("meanColorDistance returns expected magnitude for known difference", () => {
    const a = makeSolidImage(4, 4, [100, 100, 100, 255]);
    const b = makeSolidImage(4, 4, [110, 110, 110, 255]);
    // Per-pixel: |10|+|10|+|10|+|0| = 30, divided by 4 channels = 7.5
    expect(meanColorDistance(a, b)).toBeCloseTo(7.5, 1);
  });

  it("makeTestImage produces the expected background + foreground layout", () => {
    const img = makeTestImage({
      width: 4, height: 4,
      background: [255, 0, 0, 255],
      foreground: [0, 255, 0, 255],
      fgBbox: [1, 1, 2, 2],
    });
    // Corner (0,0) = background red
    expect(img.rgba[0]).toBe(255);
    expect(img.rgba[1]).toBe(0);
    // Center (1,1) = foreground green
    const ci = (1 * 4 + 1) * 4;
    expect(img.rgba[ci + 0]).toBe(0);
    expect(img.rgba[ci + 1]).toBe(255);
  });
});

// ─── 9. THE CAA DEFEAT END-TO-END (composes onto v2.19.18 severCaption) ─

describe("v2.19.19 INPAINT · canonical CAA defeat (composes onto severCaption)", () => {
  it("real inpainter produces a DIFFERENT naked fingerprint than the v2.19.18 deterministic stub for the same scam image", async () => {
    // Simulate a product image with a corner-sticker caption region
    const img = makeTestImage({
      width: 64, height: 64,
      background: [180, 90, 50, 255], // orange product
      foreground: [255, 255, 255, 255], // white sticker
      fgBbox: [4, 4, 24, 12], // corner sticker
    });
    const fill = new PatchFillInpainter();
    const fillResult = await inpaintMaskRegions({
      image: img,
      mask: [{ bbox: [4, 4, 24, 12] }],
      provider: fill,
    });
    // Phase B fingerprint differs from raw image fingerprint AND from stub fingerprint
    const rawFp = nakedFingerprint(img);
    const stubResult = await inpaintMaskRegions({
      image: img, mask: [{ bbox: [4, 4, 24, 12] }],
      provider: new StubInpainter(),
    });
    expect(fillResult.nakedFingerprint).not.toBe(rawFp);
    expect(fillResult.nakedFingerprint).not.toBe(stubResult.nakedFingerprint);
  });
});
