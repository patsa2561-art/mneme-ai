import { describe, expect, it } from "vitest";
import { detectBackend, PgVectorStore } from "./pgvector.js";

describe("detectBackend", () => {
  it("returns sqlite when MNEME_PG_URL is unset", () => {
    const had = process.env["MNEME_PG_URL"];
    delete process.env["MNEME_PG_URL"];
    const r = detectBackend();
    expect(r.kind).toBe("sqlite");
    expect(r.reason).toMatch(/MNEME_PG_URL/);
    if (had) process.env["MNEME_PG_URL"] = had;
  });

  it("returns pg when MNEME_PG_URL is set", () => {
    process.env["MNEME_PG_URL"] = "postgres://test:test@localhost/test";
    const r = detectBackend();
    expect(r.kind).toBe("pg");
    delete process.env["MNEME_PG_URL"];
  });

  it("hints at pg when corpus exceeds 100K (without env var)", () => {
    const had = process.env["MNEME_PG_URL"];
    delete process.env["MNEME_PG_URL"];
    const r = detectBackend({ totalChunks: 200_000 });
    expect(r.kind).toBe("sqlite");
    expect(r.reason).toMatch(/pgvector/);
    if (had) process.env["MNEME_PG_URL"] = had;
  });
});

describe("PgVectorStore (lazy-load)", () => {
  it("init() throws clear error when `pg` package isn't installed", async () => {
    const store = new PgVectorStore({ url: "postgres://localhost/x", dim: 384 });
    await expect(store.init()).rejects.toThrow(/pg.*package isn't installed|MNEME_PG_URL/);
  });

  it("constructor doesn't touch pg (only init does)", () => {
    expect(() => new PgVectorStore({ url: "postgres://localhost/x", dim: 384 })).not.toThrow();
  });

  it("backend tag is 'pg'", () => {
    const s = new PgVectorStore({ url: "x", dim: 384 });
    expect(s.backend).toBe("pg");
  });

  it("chunkIdsByCommit on empty input is empty", async () => {
    const s = new PgVectorStore({ url: "x", dim: 384 });
    const m = await s.chunkIdsByCommit([]);
    expect(m.size).toBe(0);
  });
});
