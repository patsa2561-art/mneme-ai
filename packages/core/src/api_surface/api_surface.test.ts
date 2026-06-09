import { describe, it, expect } from "vitest";
import { apiSurface, apiDiff, breakingChanges, apiSurfaceGauntlet } from "./index.js";

const before = [{ path: "r.ts", content: "router.get(\"/v1/users/:id\", h);\nrouter.post(\"/v1/charge\", h);\nrouter.get(\"/v1/ping\", h);" }];
const after = [{ path: "r.ts", content: "router.post(\"/v1/charge\", h);\nrouter.get(\"/v1/ping\", h);\nrouter.get(\"/v1/health\", h);" }];

describe("api_surface", () => {
  it("gauntlet is 100", () => expect(apiSurfaceGauntlet().score).toBe(100));

  it("apiSurface lists produced endpoints, normalized", () => {
    expect(apiSurface(before).map((e) => e.key)).toContain("GET /v1/users/*");
  });

  it("apiDiff splits added/removed/unchanged", () => {
    const d = apiDiff(before, after);
    expect(d.removed.map((e) => e.key)).toContain("GET /v1/users/*");
    expect(d.added.map((e) => e.key)).toContain("GET /v1/health");
    expect(d.unchanged.map((e) => e.key)).toContain("POST /v1/charge");
  });

  it("a removed endpoint a consumer calls → BREAKING, naming the consumer", () => {
    const bc = breakingChanges(before, after, [{ name: "web", files: [{ path: "a.ts", content: "fetch(\"/v1/users/42\");" }] }]);
    const u = bc.breaking.find((b) => b.path.includes("/v1/users"));
    expect(u?.severity).toBe("BREAKING");
    expect(u?.consumedBy).toContain("web");
  });

  it("a removed endpoint with no consumer → POSSIBLY_BREAKING (never falsely cleared)", () => {
    const bc = breakingChanges(before, after, []);
    expect(bc.breaking.length).toBe(1);
    expect(bc.breaking[0].severity).toBe("POSSIBLY_BREAKING");
  });

  it("adding an endpoint is not breaking", () => {
    expect(breakingChanges(before, after).addedCount).toBe(1);
  });

  it("never throws on garbage", () => {
    expect(() => apiDiff(null as never, null as never)).not.toThrow();
    expect(() => breakingChanges(null as never, null as never)).not.toThrow();
  });
});
