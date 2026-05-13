import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { compressYearOfWisdom, decompressPacket, formatInterstellarPulseLine, type WisdomEvent } from "./index.js";

const secret = randomBytes(32);

function sampleEvents(n: number): WisdomEvent[] {
  const out: WisdomEvent[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `e${i}`,
      ts: Date.now() - i * 24 * 60 * 60 * 1000,
      kind: (["D", "R", "W", "V", "P"] as const)[i % 5]!,
      scope: `s${i}`,
      text: `event ${i} text describing what happened in detail`,
      citations: i % 7,
      outcomePolarity: i % 3 === 0 ? 1 : (i % 3 === 1 ? -1 : 0),
    });
  }
  return out;
}

describe("v2.1 INTERSTELLAR · 1-year-wisdom → 4KB packet", () => {
  it("compresses to a packet under maxBytes budget", () => {
    const events = sampleEvents(200);
    const p = compressYearOfWisdom({ events, maxBytes: 4096, secret });
    expect(p.bytes).toBeLessThanOrEqual(4096);
    expect(p.magic).toBe("MNINTR1");
    expect(p.version).toBe(1);
    expect(p.eventCount).toBeGreaterThan(0);
  });

  it("prefers high-citation, recent, polarised events", () => {
    const events: WisdomEvent[] = [
      { id: "old-neutral", ts: Date.now() - 365 * 24 * 60 * 60 * 1000, kind: "D", scope: "s", text: "old neutral", citations: 0, outcomePolarity: 0 },
      { id: "recent-hot", ts: Date.now() - 1, kind: "R", scope: "s", text: "recent regret cited often", citations: 20, outcomePolarity: -1 },
    ];
    const p = compressYearOfWisdom({ events, maxBytes: 4096, secret });
    expect(p.rows[0]!.text).toContain("recent regret");
  });

  it("decompress round-trips when secret matches", () => {
    const events = sampleEvents(10);
    const p = compressYearOfWisdom({ events, secret });
    const r = decompressPacket({ packet: p, secret });
    expect(r.verdict).toBe("OK");
    expect(r.events?.length).toBe(p.rows.length);
  });

  it("TAMPERED verdict when integrity is wrong", () => {
    const p = compressYearOfWisdom({ events: sampleEvents(5), secret });
    const tampered = { ...p, integrity: "0".repeat(32) };
    expect(decompressPacket({ packet: tampered, secret }).verdict).toBe("TAMPERED");
  });

  it("MAGIC_MISMATCH on wrong magic", () => {
    const p = compressYearOfWisdom({ events: sampleEvents(5), secret });
    const tampered = { ...p, magic: "OTHER1" as "MNINTR1" };
    expect(decompressPacket({ packet: tampered, secret }).verdict).toBe("MAGIC_MISMATCH");
  });

  it("VERSION_UNKNOWN on future version", () => {
    const p = compressYearOfWisdom({ events: sampleEvents(5), secret });
    const tampered = { ...p, version: 2 as 1 };
    expect(decompressPacket({ packet: tampered, secret }).verdict).toBe("VERSION_UNKNOWN");
  });

  it("wrong secret → TAMPERED (since integrity won't match)", () => {
    const p = compressYearOfWisdom({ events: sampleEvents(5), secret });
    const wrong = randomBytes(32);
    expect(decompressPacket({ packet: p, secret: wrong }).verdict).toBe("TAMPERED");
  });

  it("formatInterstellarPulseLine summarises", () => {
    const p = compressYearOfWisdom({ events: sampleEvents(5), secret });
    expect(formatInterstellarPulseLine(p)).toContain("INTERSTELLAR");
  });
});
