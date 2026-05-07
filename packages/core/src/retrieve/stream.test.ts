import { describe, it, expect, vi } from "vitest";
import {
  CallbackSink,
  InMemorySink,
  NullSink,
  type StreamEvent,
} from "./stream.js";

describe("stream — sinks", () => {
  it("NullSink swallows events without error", () => {
    const sink = new NullSink();
    expect(() => {
      sink.emit({ kind: "done", durationMs: 10 });
      sink.emit({ kind: "synthesize", citationsCount: 3 });
    }).not.toThrow();
  });

  it("InMemorySink captures events in order", () => {
    const sink = new InMemorySink();
    sink.emit({ kind: "consider", commit: { shortHash: "a1", subject: "s" }, score: 0.5 });
    sink.emit({ kind: "accept", commit: { shortHash: "a1", subject: "s" }, reason: "above floor" });
    sink.emit({ kind: "done", durationMs: 12 });
    expect(sink.events).toHaveLength(3);
    expect(sink.events[0]!.kind).toBe("consider");
    expect(sink.events[2]!.kind).toBe("done");
  });

  it("InMemorySink.byKind filters by kind with correct narrowing", () => {
    const sink = new InMemorySink();
    sink.emit({ kind: "consider", commit: { shortHash: "a1", subject: "s1" }, score: 0.4 });
    sink.emit({ kind: "consider", commit: { shortHash: "a2", subject: "s2" }, score: 0.3 });
    sink.emit({ kind: "prune", commit: { shortHash: "a3", subject: "s3" }, reason: "below floor" });

    const considers = sink.byKind("consider");
    expect(considers).toHaveLength(2);
    // Type narrowing — score field is accessible without cast.
    expect(considers[0]!.score).toBe(0.4);

    const prunes = sink.byKind("prune");
    expect(prunes).toHaveLength(1);
    expect(prunes[0]!.reason).toBe("below floor");
  });

  it("InMemorySink.clear resets event log", () => {
    const sink = new InMemorySink();
    sink.emit({ kind: "done", durationMs: 1 });
    sink.clear();
    expect(sink.events).toEqual([]);
  });

  it("CallbackSink invokes the callback with each event", () => {
    const cb = vi.fn();
    const sink = new CallbackSink(cb);
    const ev: StreamEvent = { kind: "verify", claim: "foo", ok: true };
    sink.emit(ev);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(ev);
  });
});

describe("stream — search.ts integration emits events", () => {
  // Lightweight synthetic store fixture — exercises only the surface area
  // search() touches when no embedder is configured.
  function fakeStore(commits: Array<{ hash: string; subject: string }>): {
    ftsSearch: (q: string, k: number) => Array<{
      id: string;
      commitHash: string;
      kind: string;
      text: string;
      bm25: number;
    }>;
    countChunksWithEmbedding: () => number;
    iterEmbeddedChunks: () => Iterable<never>;
    getCommit: (hash: string) => {
      hash: string;
      shortHash: string;
      authorName: string;
      authorEmail: string;
      authorDate: string;
      committerDate: string;
      subject: string;
      body: string;
      parents: string[];
      files: string[];
    } | undefined;
  } {
    const byHash = new Map(commits.map((c) => [c.hash, c]));
    return {
      ftsSearch: (_q, _k) =>
        commits.map((c, i) => ({
          id: `chunk-${c.hash}`,
          commitHash: c.hash,
          kind: "subject",
          text: c.subject,
          bm25: 1 / (i + 1),
        })),
      countChunksWithEmbedding: () => 0,
      iterEmbeddedChunks: () => [][Symbol.iterator]() as Iterable<never>,
      getCommit: (hash: string) => {
        const c = byHash.get(hash);
        if (!c) return undefined;
        return {
          hash: c.hash,
          shortHash: c.hash.slice(0, 7),
          authorName: "alice",
          authorEmail: "a@x",
          authorDate: "2024-01-01T00:00:00Z",
          committerDate: "2024-01-01T00:00:00Z",
          subject: c.subject,
          body: "",
          parents: [],
          files: [],
        };
      },
    };
  }

  it("emits consider+accept+prune across the full ranked candidate list", async () => {
    const { search } = await import("./search.js");
    const store = fakeStore([
      { hash: "aaaaaaa1111111111111111111111111111111111", subject: "first" },
      { hash: "bbbbbbb2222222222222222222222222222222222", subject: "second" },
      { hash: "ccccccc3333333333333333333333333333333333", subject: "third" },
    ]);
    const sink = new InMemorySink();
    // topK=2 → 2 accepts, 1 prune.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = await search("foo", { store: store as any, topK: 2, events: sink });

    expect(results).toHaveLength(2);

    const considers = sink.byKind("consider");
    const accepts = sink.byKind("accept");
    const prunes = sink.byKind("prune");

    expect(considers).toHaveLength(3);
    expect(accepts).toHaveLength(2);
    expect(prunes).toHaveLength(1);

    // Order: all considers before any accept/prune.
    const firstAccept = sink.events.findIndex((e) => e.kind === "accept");
    const lastConsider = sink.events.map((e) => e.kind).lastIndexOf("consider");
    expect(lastConsider).toBeLessThan(firstAccept);

    // Pruned commit is the lowest-ranked one.
    expect(prunes[0]!.commit.shortHash).toBe("ccccccc");
  });

  it("emits zero events when no events sink is provided (NullSink default)", async () => {
    const { search } = await import("./search.js");
    const store = fakeStore([
      { hash: "aaaaaaa1111111111111111111111111111111111", subject: "first" },
    ]);
    // No events sink — should not crash and should not require one.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = await search("foo", { store: store as any });
    expect(results).toHaveLength(1);
  });
});
