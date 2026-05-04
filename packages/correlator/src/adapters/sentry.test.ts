import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SentryAdapter } from "./sentry.js";

const headers = (link?: string): Record<string, string> => {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (link) h.link = link;
  return h;
};

describe("SentryAdapter — construction", () => {
  it("requires orgSlug, projectSlug, apiToken", () => {
    expect(() => new SentryAdapter({ orgSlug: "", projectSlug: "p", apiToken: "t" })).toThrow();
    expect(() => new SentryAdapter({ orgSlug: "o", projectSlug: "", apiToken: "t" })).toThrow();
    expect(() => new SentryAdapter({ orgSlug: "o", projectSlug: "p", apiToken: "" })).toThrow();
  });

  it("normalizes baseUrl trailing slash", () => {
    const a = new SentryAdapter({
      orgSlug: "o",
      projectSlug: "p",
      apiToken: "t",
      baseUrl: "https://sentry.internal/",
    });
    expect(a).toBeDefined();
  });
});

describe("SentryAdapter.fetch", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps issues to Mneme Incident shape", async () => {
    (globalThis.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/issues/")) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: "12345",
                title: "Stripe webhook 500",
                level: "error",
                status: "unresolved",
                firstSeen: "2025-09-01T10:00:00Z",
                lastSeen: "2025-09-01T11:00:00Z",
                count: 47,
                userCount: 12,
                permalink: "https://sentry.io/organizations/foo/issues/12345/",
                culprit: "handleWebhook in src/payment.ts",
                project: { slug: "web" },
                metadata: { type: "TypeError", value: "Cannot read property" },
              },
            ]),
            { status: 200, headers: headers() },
          ),
        );
      }
      return Promise.resolve(new Response("[]", { status: 200, headers: headers() }));
    });

    const a = new SentryAdapter({
      orgSlug: "foo",
      projectSlug: "web",
      apiToken: "tok",
      fetchStackFrames: false,
    });
    const incidents = await a.fetch({});
    expect(incidents).toHaveLength(1);
    const inc = incidents[0]!;
    expect(inc.id).toBe("sentry:12345");
    expect(inc.source).toBe("sentry");
    expect(inc.title).toBe("Stripe webhook 500");
    expect(inc.severity).toBe("error");
    expect(inc.occurredAt).toBe("2025-09-01T10:00:00Z");
    expect(inc.affectedFiles).toContain("src/payment.ts");
    expect(inc.url).toContain("sentry.io");
  });

  it("maps level → severity correctly", async () => {
    const issues = ["fatal", "error", "warning", "info", "unknown"].map((level, i) => ({
      id: String(i),
      title: `t${i}`,
      level,
      firstSeen: "2025-01-01T00:00:00Z",
    }));
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify(issues), { status: 200, headers: headers() }),
    );
    const a = new SentryAdapter({
      orgSlug: "o",
      projectSlug: "p",
      apiToken: "t",
      fetchStackFrames: false,
    });
    const out = await a.fetch({});
    const sevById = Object.fromEntries(out.map((i) => [i.id, i.severity]));
    expect(sevById["sentry:0"]).toBe("critical");
    expect(sevById["sentry:1"]).toBe("error");
    expect(sevById["sentry:2"]).toBe("warning");
    expect(sevById["sentry:3"]).toBe("info");
    expect(sevById["sentry:4"]).toBe("error"); // default
  });

  it("hydrates stack frames from latest event when enabled", async () => {
    let callCount = 0;
    (globalThis.fetch as any).mockImplementation((url: string) => {
      callCount++;
      if (url.includes("/projects/")) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: "1",
                title: "Crash",
                level: "error",
                firstSeen: "2025-01-01T00:00:00Z",
              },
            ]),
            { status: 200, headers: headers() },
          ),
        );
      }
      if (url.includes("/events/latest/")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              entries: [
                {
                  type: "exception",
                  data: {
                    values: [
                      {
                        stacktrace: {
                          frames: [
                            { filename: "src/payment.ts", lineno: 42, function: "charge" },
                            { filename: "src/webhook.ts", lineno: 7, function: "handle" },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200, headers: headers() },
          ),
        );
      }
      return Promise.resolve(new Response("{}", { status: 200, headers: headers() }));
    });

    const a = new SentryAdapter({
      orgSlug: "o",
      projectSlug: "p",
      apiToken: "t",
      fetchStackFrames: true,
    });
    const [inc] = await a.fetch({});
    expect(inc).toBeDefined();
    expect(inc!.stackFrames).toHaveLength(2);
    expect(inc!.stackFrames![0]!.file).toBe("src/payment.ts");
    expect(inc!.affectedFiles).toContain("src/payment.ts");
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("does not call /events/latest/ when fetchStackFrames=false", async () => {
    (globalThis.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/projects/")) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              { id: "1", title: "x", level: "error", firstSeen: "2025-01-01T00:00:00Z" },
            ]),
            { status: 200, headers: headers() },
          ),
        );
      }
      throw new Error("should not be called");
    });
    const a = new SentryAdapter({
      orgSlug: "o",
      projectSlug: "p",
      apiToken: "t",
      fetchStackFrames: false,
    });
    await a.fetch({});
    const calledUrls = (globalThis.fetch as any).mock.calls.map((c: any[]) => c[0]);
    expect(calledUrls.some((u: string) => u.includes("/events/latest/"))).toBe(false);
  });

  it("follows pagination via Link header rel=next", async () => {
    let page = 0;
    (globalThis.fetch as any).mockImplementation((url: string) => {
      page++;
      if (page === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify([{ id: "1", title: "a", firstSeen: "2025-01-01T00:00:00Z" }]),
            {
              status: 200,
              headers: headers(
                '<https://sentry.io/api/0/projects/o/p/issues/?cursor=abc>; rel="next"; results="true"',
              ),
            },
          ),
        );
      }
      if (page === 2) {
        return Promise.resolve(
          new Response(
            JSON.stringify([{ id: "2", title: "b", firstSeen: "2025-01-02T00:00:00Z" }]),
            { status: 200, headers: headers() },
          ),
        );
      }
      return Promise.resolve(new Response("[]", { status: 200, headers: headers() }));
    });
    const a = new SentryAdapter({
      orgSlug: "o",
      projectSlug: "p",
      apiToken: "t",
      fetchStackFrames: false,
    });
    const out = await a.fetch({});
    expect(out.length).toBe(2);
    expect(page).toBe(2);
  });

  it("respects since/until via start/end params", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response("[]", { status: 200, headers: headers() }),
    );
    const a = new SentryAdapter({
      orgSlug: "o",
      projectSlug: "p",
      apiToken: "t",
      fetchStackFrames: false,
    });
    await a.fetch({ since: "2025-01-01T00:00:00Z", until: "2025-02-01T00:00:00Z" });
    const url = (globalThis.fetch as any).mock.calls[0][0];
    expect(url).toContain("start=");
    expect(url).toContain("end=");
  });

  it("sends Authorization header", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response("[]", { status: 200, headers: headers() }),
    );
    const a = new SentryAdapter({
      orgSlug: "o",
      projectSlug: "p",
      apiToken: "secret-token",
      fetchStackFrames: false,
    });
    await a.fetch({});
    const init = (globalThis.fetch as any).mock.calls[0][1];
    expect(init.headers.authorization).toBe("Bearer secret-token");
  });

  it("returns empty array on 404 (project not found)", async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response("", { status: 404 }));
    const a = new SentryAdapter({
      orgSlug: "o",
      projectSlug: "p",
      apiToken: "t",
      fetchStackFrames: false,
    });
    const out = await a.fetch({});
    expect(out).toEqual([]);
  });

  it("caps to maxIssues", async () => {
    const big = Array.from({ length: 50 }, (_, i) => ({
      id: String(i),
      title: `t${i}`,
      firstSeen: "2025-01-01T00:00:00Z",
    }));
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify(big), { status: 200, headers: headers() }),
    );
    const a = new SentryAdapter({
      orgSlug: "o",
      projectSlug: "p",
      apiToken: "t",
      maxIssues: 5,
      fetchStackFrames: false,
    });
    const out = await a.fetch({});
    expect(out).toHaveLength(5);
  });
});
