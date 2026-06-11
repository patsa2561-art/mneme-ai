import { describe, it, expect } from "vitest";
import { buildCrossLayerGraph } from "../cross_layer_graph/index.js";
import { injectionPaths, injectionVerdict, injectionTaintGauntlet } from "./index.js";

const files = [{ path: "api.ts", content:
  "router.get(\"/search\", search);\n" +
  "export function search(req){ return db.query(\"SELECT * FROM t WHERE x=\" + req.query.q); }\n" +
  "router.post(\"/run\", runCmd);\n" +
  "export function runCmd(req){ const { execSync } = require('child_process'); return execSync(req.body.cmd); }\n" +
  "router.get(\"/safe\", safe);\n" +
  "export function safe(req){ const id = parseInt(req.query.id); return db.query(\"SELECT * FROM t WHERE id=\" + id); }\n" +
  "export function deadUtil(req){ return db.query(\"SELECT \" + req.query.x); }\n" }];
const g = buildCrossLayerGraph(files);

describe("injection_taint", () => {
  it("gauntlet is 100", () => expect(injectionTaintGauntlet().score).toBe(100));

  it("flags SQLi (endpoint input → raw query, no sanitizer)", () => {
    expect(injectionPaths(g, files).some((p) => p.endpoint === "/search" && /SQL/.test(p.kind))).toBe(true);
  });

  it("flags command injection (child_process)", () => {
    expect(injectionPaths(g, files).some((p) => p.endpoint === "/run" && /command/.test(p.kind))).toBe(true);
  });

  it("a sanitizer (parseInt) on the path clears it", () => {
    expect(injectionPaths(g, files).some((p) => p.endpoint === "/safe")).toBe(false);
  });

  it("a dangerous sink NOT reachable from an endpoint is not flagged", () => {
    expect(injectionPaths(g, files).some((p) => p.func === "deadUtil")).toBe(false);
  });

  it("verdict reflects presence", () => {
    expect(injectionVerdict(injectionPaths(g, files)).clear).toBe(false);
    expect(injectionVerdict([]).clear).toBe(true);
  });

  it("never throws on garbage", () => {
    expect(() => injectionPaths(null as never, null as never)).not.toThrow();
    expect(injectionPaths(null as never, null as never).length).toBe(0);
  });
});
