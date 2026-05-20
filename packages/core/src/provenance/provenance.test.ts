import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordProvenance, blame, listProvenance } from "./index.js";

function tmpRepo() { return mkdtempSync(join(tmpdir(), "mneme-prov-")); }

describe("provenance · record + blame", () => {
  it("records + queries by file:line", () => {
    const r = tmpRepo();
    try {
      const rec = recordProvenance(r, {
        file: "src/app.ts", lineStart: 10, lineEnd: 20,
        vendor: "claude-ai", prompt: "fix bug", content: "function fix(){}",
        polygraphVerdict: "green",
      });
      expect(rec.chainHash).toMatch(/^[A-Za-z0-9_-]{22}$/);
      const hits = blame(r, "src/app.ts", 15);
      expect(hits.length).toBe(1);
      expect(hits[0]!.vendor).toBe("claude-ai");
      expect(blame(r, "src/app.ts", 30).length).toBe(0); // outside range
    } finally { rmSync(r, { recursive: true, force: true }); }
  });

  it("list returns newest first", () => {
    const r = tmpRepo();
    try {
      recordProvenance(r, { file: "a", lineStart: 1, lineEnd: 1, vendor: "v1", prompt: "p", content: "c" });
      recordProvenance(r, { file: "b", lineStart: 1, lineEnd: 1, vendor: "v2", prompt: "p", content: "c" });
      const ls = listProvenance(r);
      expect(ls[0]!.vendor).toBe("v2");
    } finally { rmSync(r, { recursive: true, force: true }); }
  });
});
