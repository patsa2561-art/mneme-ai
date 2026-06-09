import { describe, it, expect } from "vitest";
import { crossServiceGraph, serviceImpact, normPath, pathsMatch, crossServiceGauntlet } from "./index.js";

const services = [
  { name: "users", files: [{ path: "routes.ts", content: "router.get(\"/v1/users/:id\", getUser);" }] },
  { name: "orders", files: [{ path: "routes.ts", content: "app.post(\"/v1/charge\", doCharge);" }, { path: "client.ts", content: "fetch(\"/v1/users/123\");" }] },
  { name: "web", files: [{ path: "api.ts", content: "axios.post(\"/v1/charge\", body);\nfetch(\"/v1/unknown-thing\");" }] },
];

describe("cross_service", () => {
  it("gauntlet is 100", () => expect(crossServiceGauntlet().score).toBe(100));

  it("links a consumer's call to the producer service (cross-repo edge)", () => {
    const g = crossServiceGraph(services);
    expect(g.edges.some((e) => e.from === "web" && e.to === "orders" && e.path === "/v1/charge")).toBe(true);
    expect(g.edges.some((e) => e.from === "orders" && e.to === "users")).toBe(true);   // /v1/users/123 ↔ /v1/users/:id
  });

  it("normalizes params and matches segment-wise", () => {
    expect(normPath("/v1/users/:id")).toBe("/v1/users/*");
    expect(normPath("https://api.x.com/v1/users/9?q=1")).toBe("/v1/users/9");
    expect(pathsMatch("/v1/users/9", "/v1/users/*")).toBe(true);
    expect(pathsMatch("/v1/a", "/v1/a/b")).toBe(false);
  });

  it("flags a dangling consumer (no service produces it)", () => {
    expect(crossServiceGraph(services).dangling.some((d) => /unknown-thing/.test(d.path))).toBe(true);
  });

  it("serviceImpact: who breaks if an endpoint changes", () => {
    const g = crossServiceGraph(services);
    const im = serviceImpact(g, "orders", "/v1/charge");
    expect(im.safe).toBe(false);
    expect(im.consumers.some((c) => c.from === "web")).toBe(true);
    expect(serviceImpact(g, "users", "/v1/nope").safe).toBe(true);
  });

  it("never throws on garbage", () => {
    expect(() => crossServiceGraph(null as never)).not.toThrow();
    expect(() => serviceImpact(null as never, "a", "b")).not.toThrow();
  });
});
