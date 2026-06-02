import { describe, it, expect } from "vitest";
import { siege, scoreSiege, hardenCorpus, ATTACK_CORPUS, siegeGauntlet, type GateVerdict } from "./index.js";

const soundGate = (cmd: string): GateVerdict => /rm|dd|mkfs|sudo|chmod|bash|sh\b|base64|xxd|node -e|python -c|find|\$\(|`|ifs|\\x|drop table|push --force|\/dev\/tcp|:\(\)/i.test(cmd) ? "COSIGN" : "ALLOW";
const naiveGate = (cmd: string): GateVerdict => /^(rm|dd|sudo)$/.test((cmd.trim().split(/\s+/)[0]) ?? "") ? "BLOCK" : "ALLOW";

describe("v2.148 · SIEGE — the Adversarial Self-Bounty", () => {
  it("gauntlet is 100", () => {
    expect(siegeGauntlet().score).toBe(100);
  });

  it("DISCRIMINATES a sound gate (FORTRESS) from a naive denylist (BREACHED)", () => {
    const sound = scoreSiege(siege(soundGate));
    const naive = scoreSiege(siege(naiveGate));
    expect(sound.band).toBe("FORTRESS");
    expect(sound.resistanceLB).toBeGreaterThan(naive.resistanceLB + 0.3);
    expect(naive.band).not.toBe("FORTRESS");
    expect(naive.bypasses.some((b) => b.class === "obfuscated")).toBe(true);
  });

  it("Wilson LOWER bound is conservative (below the point rate)", () => {
    const partial = scoreSiege(siege((c) => /rm|dd/i.test(c) ? "BLOCK" : "ALLOW"));
    expect(partial.resistanceLB).toBeLessThan(partial.resistance);
  });

  it("self-hardens (a found bypass grows the corpus; dups ignored)", () => {
    const grown = hardenCorpus(ATTACK_CORPUS, { id: "novel", command: "perl -e 'unlink glob \"/*\"'", class: "rce" });
    expect(grown.length).toBe(ATTACK_CORPUS.length + 1);
    expect(hardenCorpus(grown, { id: "dup", command: "rm -rf /", class: "destructive" }).length).toBe(grown.length);
  });

  it("a throwing gate is treated as withstood (fail-safe); total on hostile input", () => {
    expect(scoreSiege(siege(() => { throw new Error("x"); })).bypassed).toBe(0);
    expect(() => siege(null as never)).not.toThrow();
    expect(() => scoreSiege(null as never)).not.toThrow();
    expect(() => hardenCorpus(null as never, null as never)).not.toThrow();
  });
});
