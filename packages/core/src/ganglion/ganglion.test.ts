import { describe, it, expect } from "vitest";
import {
  emptyGraph,
  classifyIntent,
  runAuction,
  recordOutcome,
  preferredNeuron,
  ganglionStageHint,
  verifyGraphChain,
  replayGraph,
  graphStats,
} from "./index.js";

const SECRET = "ganglion-test-secret-44";

describe("v2.19.40 GANGLION · classifyIntent", () => {
  it("verify keyword → verify_claim", () => {
    expect(classifyIntent("please verify this claim")).toBe("verify_claim");
  });
  it("explain keyword → explain_code", () => {
    expect(classifyIntent("explain what this function does")).toBe("explain_code");
  });
  it("does file exist → file_lookup", () => {
    expect(classifyIntent("does packages/core/foo.ts exist somewhere")).toBe("file_lookup");
  });
  it("version pattern → version_query", () => {
    expect(classifyIntent("is v2.19.40 released yet")).toBe("version_query");
  });
  it("how many → count_query", () => {
    expect(classifyIntent("how many MCP tools are there")).toBe("count_query");
  });
  it("write code → generate_code", () => {
    expect(classifyIntent("write code for a sort function")).toBe("generate_code");
  });
  it("explicit kind override wins", () => {
    expect(classifyIntent("anything", "verify")).toBe("verify_claim");
  });
  it("unknown fallback for ambiguous text", () => {
    expect(classifyIntent("Lorem ipsum dolor sit amet")).toBe("unknown");
  });
});

describe("v2.19.40 GANGLION · runAuction Vickrey-style", () => {
  it("highest score wins the auction", () => {
    const bids = [
      { neuron: "REFLEX",  bid: { confidence: 0.9, estTokensSaved: 200, latencyMs: 5 } },
      { neuron: "ARBITRAGE", bid: { confidence: 0.6, estTokensSaved: 100, latencyMs: 50 } },
      { neuron: "OPUS",    bid: { confidence: 0.95, estTokensSaved: 0, latencyMs: 1000 } },
    ];
    const r = runAuction(bids);
    expect(r.winner).toBe("REFLEX");
    expect(r.ranked.length).toBe(3);
    expect(r.ranked[0]!.neuron).toBe("REFLEX");
  });

  it("bid with zero estTokensSaved scores 0 (correctly ranks last)", () => {
    const bids = [
      { neuron: "OPUS", bid: { confidence: 0.99, estTokensSaved: 0, latencyMs: 100 } },
      { neuron: "REFLEX", bid: { confidence: 0.5, estTokensSaved: 1, latencyMs: 1 } },
    ];
    const r = runAuction(bids);
    expect(r.winner).toBe("REFLEX");
  });

  it("empty bids list returns empty winner", () => {
    const r = runAuction([]);
    expect(r.winner).toBe("");
    expect(r.winnerScore).toBe(0);
  });
});

describe("v2.19.40 GANGLION · Hebbian recordOutcome", () => {
  it("winner's synapse strengthens after success", () => {
    const g = emptyGraph(SECRET);
    recordOutcome(g, "verify_claim", "REFLEX", [], {
      successful: true, actualTokensSaved: 200, actualLatencyMs: 5, quality: 1.0,
    });
    const w = preferredNeuron(g, "verify_claim");
    expect(w).toBeTruthy();
    expect(w!.neuron).toBe("REFLEX");
    expect(w!.weight).toBeGreaterThan(0.4);
  });

  it("repeated success converges weight toward 1", () => {
    const g = emptyGraph(SECRET);
    for (let i = 0; i < 100; i++) {
      recordOutcome(g, "ask_question", "REFLEX", [], {
        successful: true, actualTokensSaved: 200, actualLatencyMs: 5, quality: 1.0,
      });
    }
    const w = preferredNeuron(g, "ask_question");
    expect(w!.weight).toBeGreaterThan(0.95);
  });

  it("failure decays winner's weight (Hebbian negative)", () => {
    const g = emptyGraph(SECRET);
    // Build up first.
    for (let i = 0; i < 20; i++) {
      recordOutcome(g, "verify_claim", "REFLEX", [], {
        successful: true, actualTokensSaved: 200, actualLatencyMs: 5, quality: 1.0,
      });
    }
    const before = preferredNeuron(g, "verify_claim")!.weight;
    // Now repeatedly fail.
    for (let i = 0; i < 30; i++) {
      recordOutcome(g, "verify_claim", "REFLEX", [], {
        successful: false, actualTokensSaved: 0, actualLatencyMs: 1000, quality: 0.1,
      });
    }
    const after = preferredNeuron(g, "verify_claim")!.weight;
    expect(after).toBeLessThan(before);
  });

  it("losers' synapses decay slightly with each round", () => {
    const g = emptyGraph(SECRET);
    // First fire seeds losers at initialWeight then immediately applies one decay tick.
    recordOutcome(g, "ask_question", "REFLEX", ["ARBITRAGE", "OPUS"], {
      successful: true, actualTokensSaved: 200, actualLatencyMs: 5, quality: 1.0,
    });
    const seeded = g.synapses.find((s) => s.neuron === "ARBITRAGE")!.weight;
    // Seeded should be slightly less than initialWeight (one decay applied).
    expect(seeded).toBeLessThan(g.initialWeight);
    expect(seeded).toBeGreaterThan(g.initialWeight * 0.9);
    // 50 more rounds of REFLEX winning over ARBITRAGE & OPUS — weight should keep falling.
    for (let i = 0; i < 50; i++) {
      recordOutcome(g, "ask_question", "REFLEX", ["ARBITRAGE", "OPUS"], {
        successful: true, actualTokensSaved: 200, actualLatencyMs: 5, quality: 1.0,
      });
    }
    const arb = g.synapses.find((s) => s.neuron === "ARBITRAGE");
    if (arb) expect(arb.weight).toBeLessThan(seeded);
  });

  it("weak synapse below pruneThreshold is removed", () => {
    const g = emptyGraph(SECRET);
    g.pruneThreshold = 0.4; // aggressive prune for this test
    // Seed a loser with weight = initialWeight (0.4); first fire seeds at exactly 0.4 then decays.
    recordOutcome(g, "ask_question", "REFLEX", ["LOSER"], {
      successful: true, actualTokensSaved: 100, actualLatencyMs: 1, quality: 1.0,
    });
    // The loser was below threshold after the first fire's decay; should be pruned.
    expect(g.synapses.find((s) => s.neuron === "LOSER")).toBeUndefined();
  });
});

describe("v2.19.40 GANGLION · preferredNeuron + ganglionStageHint", () => {
  it("preferredNeuron returns null on cold start", () => {
    const g = emptyGraph(SECRET);
    expect(preferredNeuron(g, "ask_question")).toBeNull();
  });

  it("ganglionStageHint translates winning neuron into preferred Stage", () => {
    const g = emptyGraph(SECRET);
    for (let i = 0; i < 30; i++) {
      recordOutcome(g, "file_lookup", "REFLEX", [], {
        successful: true, actualTokensSaved: 200, actualLatencyMs: 5, quality: 1.0,
      });
    }
    const hint = ganglionStageHint(g, "file_lookup", (n) => n === "REFLEX" ? 1 : 4);
    expect(hint).toBeTruthy();
    expect(hint!.preferredStage).toBe(1);
    expect(hint!.confidence).toBeGreaterThan(0.5);
  });
});

describe("v2.19.40 GANGLION · chain integrity (HMAC)", () => {
  it("chain verifies after many updates", () => {
    const g = emptyGraph(SECRET);
    for (let i = 0; i < 100; i++) {
      recordOutcome(g, "verify_claim", "REFLEX", ["OPUS"], {
        successful: true, actualTokensSaved: 100, actualLatencyMs: 5, quality: 1.0,
      });
    }
    expect(verifyGraphChain(g).ok).toBe(true);
  });

  it("tampered update breaks the chain", () => {
    const g = emptyGraph(SECRET);
    recordOutcome(g, "verify_claim", "REFLEX", [], { successful: true, actualTokensSaved: 100, actualLatencyMs: 5, quality: 1.0 });
    recordOutcome(g, "verify_claim", "REFLEX", [], { successful: true, actualTokensSaved: 100, actualLatencyMs: 5, quality: 1.0 });
    g.updates[0]!.winner = "TAMPERED";
    expect(verifyGraphChain(g).ok).toBe(false);
  });
});

describe("v2.19.40 GANGLION · replay determinism", () => {
  it("replaying the chain reproduces the same synapse weights", () => {
    const original = emptyGraph(SECRET);
    for (let i = 0; i < 50; i++) {
      recordOutcome(original, "ask_question", "REFLEX", ["OPUS"], {
        successful: i % 3 !== 0, actualTokensSaved: 100, actualLatencyMs: 5, quality: 0.9,
      });
    }
    const replayed = replayGraph(original.updates, emptyGraph(SECRET));
    const w1 = preferredNeuron(original, "ask_question")!.weight;
    const w2 = preferredNeuron(replayed, "ask_question")!.weight;
    expect(Math.abs(w1 - w2)).toBeLessThan(0.001);
  });
});

describe("v2.19.40 GANGLION · graphStats convergence", () => {
  it("convergence climbs as one neuron dominates per intent", () => {
    const g = emptyGraph(SECRET);
    for (let i = 0; i < 80; i++) {
      recordOutcome(g, "verify_claim", "REFLEX", ["OPUS"], {
        successful: true, actualTokensSaved: 100, actualLatencyMs: 5, quality: 1.0,
      });
    }
    const s = graphStats(g);
    expect(s.totalSynapses).toBeGreaterThan(0);
    expect(s.convergence).toBeGreaterThan(0);
  });
});

describe("v2.19.40 GANGLION · 1000-iter fuzz", () => {
  it("recordOutcome + verifyGraphChain never throws on random sequences", () => {
    const g = emptyGraph(SECRET);
    const intents = ["ask_question", "verify_claim", "generate_code", "file_lookup", "count_query"] as const;
    const neurons = ["REFLEX", "ARBITRAGE", "REPLICA", "OPUS", "HAIKU"];
    for (let i = 0; i < 1000; i++) {
      const intent = intents[Math.floor(Math.random() * intents.length)]!;
      const winner = neurons[Math.floor(Math.random() * neurons.length)]!;
      const losers = neurons.filter((n) => n !== winner).slice(0, Math.floor(Math.random() * 4));
      expect(() => recordOutcome(g, intent, winner, losers, {
        successful: Math.random() > 0.3,
        actualTokensSaved: Math.floor(Math.random() * 500),
        actualLatencyMs: Math.floor(Math.random() * 1000),
        quality: Math.random(),
      })).not.toThrow();
    }
    expect(verifyGraphChain(g).ok).toBe(true);
  });
});
