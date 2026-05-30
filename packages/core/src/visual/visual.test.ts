import { describe, it, expect } from "vitest";
import { detectCaps, gradientText, sparkline, renderKnowledgeMap, visualGauntlet, type TermCaps, type MapState } from "./index.js";

const TRUE: TermCaps = { truecolor: true, color256: true, color: true, unicode: true, width: 80 };
const MONO: TermCaps = { truecolor: false, color256: false, color: false, unicode: true, width: 80 };
const ASCII: TermCaps = { truecolor: false, color256: false, color: false, unicode: false, width: 80 };
const hasEsc = (s: string) => s.includes("\x1b");
const isAscii = (s: string) => { for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) return false; return true; };

const STATE: MapState = {
  version: "2.116.0",
  nodes: [{ label: "TRUTH", status: "ok" }, { label: "SAVINGS", status: "ok" }, { label: "LOOP", status: "warn" }, { label: "CORTEX", status: "idle" }],
  savingsSpark: [1, 3, 2, 6, 5, 8, 7, 9],
  headline: "12,403 input tokens saved (−88.1%)",
  signed: true,
};

describe("v2.116 VISUAL KNOWLEDGE MAP — portable, deterministic renderer", () => {
  describe("skeleton — caps detection", () => {
    it("NO_COLOR disables color", () => {
      expect(detectCaps({ NO_COLOR: "1" }, true).color).toBe(false);
    });
    it("non-TTY (a pipe) disables color by default", () => {
      expect(detectCaps({}, false).color).toBe(false);
    });
    it("COLORTERM=truecolor on a TTY → truecolor", () => {
      const c = detectCaps({ COLORTERM: "truecolor" }, true);
      expect(c.color).toBe(true);
      expect(c.truecolor).toBe(true);
    });
    it("FORCE_COLOR=3 forces truecolor even off-TTY", () => {
      expect(detectCaps({ FORCE_COLOR: "3" }, false).truecolor).toBe(true);
    });
    it("MNEME_ASCII=1 → unicode off; width clamps to 24..120", () => {
      expect(detectCaps({ MNEME_ASCII: "1" }, true).unicode).toBe(false);
      expect(detectCaps({}, true, 9999).width).toBe(120);
      expect(detectCaps({}, true, 5).width).toBe(24);
    });
  });

  describe("PORTABILITY INVARIANTS (the 'works everywhere' guarantee)", () => {
    it("MONO render contains ZERO ANSI escapes (pipe/CI-safe)", () => {
      expect(hasEsc(renderKnowledgeMap(STATE, MONO))).toBe(false);
    });
    it("ASCII render is pure ASCII — even though the caller passed Unicode (−, μνήμη)", () => {
      expect(isAscii(renderKnowledgeMap(STATE, ASCII))).toBe(true);
    });
    it("TRUECOLOR render actually emits 24-bit RGB escapes", () => {
      expect(renderKnowledgeMap(STATE, TRUE)).toContain("\x1b[38;2;");
    });
    it("every rendered line stays within caps.width (visible length)", () => {
      const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
      for (const caps of [TRUE, MONO, ASCII]) {
        for (const line of renderKnowledgeMap(STATE, caps).split("\n")) {
          expect(strip(line).length).toBeLessThanOrEqual(caps.width);
        }
      }
    });
    it("deterministic: same (state, caps) → identical frame", () => {
      expect(renderKnowledgeMap(STATE, TRUE)).toBe(renderKnowledgeMap(STATE, TRUE));
    });
  });

  describe("constellation wrapping — every node shows, never overflows", () => {
    it("many nodes (10) WRAP across rows; every line ≤ width; all node labels present", () => {
      const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
      const labels = ["TRUTH", "LOOP", "SAVINGS", "CORTEX", "HYDRA", "GEPHYRA", "NKL", "DISTILL", "FLIGHT", "STAKE"];
      const st: MapState = { nodes: labels.map((label, k) => ({ label, status: (["ok", "warn", "bad", "idle"] as const)[k % 4]! })), signed: true };
      const out = renderKnowledgeMap(st, { ...MONO, width: 60 });
      const rows = out.split("\n");
      for (const line of rows) expect(line.length).toBeLessThanOrEqual(60);
      // every label survives the wrap (no node silently dropped)
      for (const label of labels) expect(out).toContain(label);
      // 10 node-cells cannot fit one ≤56-col row → the map MUST have used
      // ≥2 constellation rows (rows containing a node glyph ●/◆/○/✖).
      const constellationRows = rows.filter((l) => /[●◆○✖]/.test(l)).length;
      expect(constellationRows).toBeGreaterThanOrEqual(2);
    });
  });

  describe("PROPERTY — portability holds across a generated space of states × caps", () => {
    it("for 200 generated states: mono has no escapes AND ascii is pure ASCII AND lines bounded", () => {
      const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
      const statuses = ["ok", "warn", "bad", "idle"] as const;
      for (let i = 0; i < 200; i++) {
        const nNodes = (i % 9) + 1;
        const nodes = Array.from({ length: nNodes }, (_, k) => ({ label: `N${k}·μ${i}`, status: statuses[(i + k) % 4]! }));
        const spark = Array.from({ length: i % 30 }, (_, k) => (k * 7 + i) % 50);
        const st: MapState = { version: `9.${i}.0`, nodes, savingsSpark: spark, headline: `${i}×−saved ▆▇`, signed: i % 2 === 0 };
        const width = 24 + (i % 90);
        expect(hasEsc(renderKnowledgeMap(st, { ...MONO, width }))).toBe(false);
        expect(isAscii(renderKnowledgeMap(st, { ...ASCII, width }))).toBe(true);
        for (const line of renderKnowledgeMap(st, { ...TRUE, width }).split("\n")) {
          expect(strip(line).length).toBeLessThanOrEqual(width);
        }
      }
    });
  });

  describe("sparkline + gradient", () => {
    it("sparkline maps a strictly-increasing series to a non-decreasing block ladder", () => {
      const ramp = "▁▂▃▄▅▆▇█";
      const sp = sparkline([0, 1, 2, 3, 4, 5, 6, 7], MONO);
      expect(sp.length).toBe(8);
      for (let i = 1; i < sp.length; i++) expect(ramp.indexOf(sp[i]!)).toBeGreaterThanOrEqual(ramp.indexOf(sp[i - 1]!));
    });
    it("gradientText returns plain text in mono (no escapes), colored in truecolor", () => {
      expect(hasEsc(gradientText("hello", [0, 0, 0], [255, 255, 255], MONO))).toBe(false);
      expect(gradientText("hello", [0, 0, 0], [255, 255, 255], MONO)).toBe("hello");
      expect(gradientText("hello", [10, 20, 30], [200, 100, 50], TRUE)).toContain("\x1b[38;2;");
    });
  });

  it("gauntlet scores 100", () => {
    const g = visualGauntlet();
    expect(g.deterministic).toBe(true);
    expect(g.monoNoEscapes).toBe(true);
    expect(g.asciiPure).toBe(true);
    expect(g.truecolorPaints).toBe(true);
    expect(g.boundedWidth).toBe(true);
    expect(g.sparklineMonotonic).toBe(true);
    expect(g.score).toBe(100);
  });

  it("STABILITY — total on garbage", () => {
    expect(() => renderKnowledgeMap(null as never, null as never)).not.toThrow();
    expect(() => gradientText(null as never, [0, 0, 0], [1, 1, 1], MONO)).not.toThrow();
    expect(() => sparkline(null as never, MONO)).not.toThrow();
    expect(() => detectCaps(null as never, false)).not.toThrow();
  });
});
