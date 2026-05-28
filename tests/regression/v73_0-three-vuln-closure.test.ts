/**
 * v2.73.0 — close 3 v2.72 vulnerabilities. PINNED regression.
 *
 * Each section first REPRODUCES the vuln's shape, then asserts the fix.
 *
 *   J1 — Vuln #1: HTTP bridge rate-limit burst guard (per-second cap)
 *   J2 — Vuln #2: Unicode-digit homograph on the HTTP polygraph path
 *   J3 — Vuln #3: multi-lens always runs (generic/short claims get 6 lenses)
 *   J4 — TG probes for all 3 fixes return 1
 *   J5 — no-regression: legitimate human-paced streaming is NOT rate-limited
 */

import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "../..");

describe("v2.73.0 J1 — rate-limit burst guard (vuln #1) (PINNED)", () => {
  it("J1.1 dual-window caps exist: polygraph has BOTH perMin and perSec", async () => {
    const hb = await import("../../packages/core/src/diaspora/http_bridge.js");
    const caps = hb.__rateCapsForTest();
    expect(caps["polygraph"]).toHaveProperty("perMin");
    expect(caps["polygraph"]).toHaveProperty("perSec");
    expect((caps["polygraph"] as { perSec: number }).perSec).toBeGreaterThan(0);
    expect((caps["polygraph"] as { perSec: number }).perSec).toBeLessThan(100); // a burst cap, not a no-op
  });

  it("J1.2 sub-second flood is capped at perSec (was: all passed under 600/min)", async () => {
    const hb = await import("../../packages/core/src/diaspora/http_bridge.js");
    hb.__resetRateLimiterForTest();
    const perSec = (hb.__rateCapsForTest()["polygraph"] as { perSec: number }).perSec;
    const handle = await hb.startBridge({ repoRoot: REPO, noAuth: true }, {
      polygraphVerify: async () => ({ verdict: "unknown" as const, color: "grey" as const, confidence: 0, oneLine: "t", latencyMs: 1, engine: "test" }),
    });
    try {
      const n = perSec + 40;
      const t0 = Date.now();
      let ok = 0, limited = 0;
      for (let i = 0; i < n; i++) {
        const s = await fetch(handle.baseUrl + "/v1/polygraph/verify", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sentence: "x" }),
        }).then((r) => r.status).catch(() => 0);
        if (s === 200) ok++; else if (s === 429) limited++;
      }
      const elapsed = Date.now() - t0;
      // Only assert the cap when the whole flood happened inside one 1s window.
      if (elapsed < 1000) {
        expect(ok).toBeLessThanOrEqual(perSec);
        expect(limited).toBeGreaterThanOrEqual(n - perSec - 2);
      } else {
        // Slow CI — at minimum SOME requests were limited.
        expect(limited).toBeGreaterThan(0);
      }
    } finally {
      await handle.stop();
      hb.__resetRateLimiterForTest();
    }
  });
});

describe("v2.73.0 J2 — Unicode-digit homograph on HTTP path (vuln #2) (PINNED)", () => {
  it("J2.1 Arabic-Indic '٢+٢=٥' → refuted + homograph flag (was: unknown/grey)", async () => {
    const pg = await import("../../packages/core/src/polygraph/index.js");
    const r = await pg.verifyBrowserSentence({ sentence: "٢+٢=٥", repoRoot: REPO });
    expect(r.verdict).toBe("refuted");
    expect(r.color).toBe("red");
    expect(r.homographFlags?.length ?? 0).toBeGreaterThan(0);
  });

  it("J2.2 Fullwidth '２＋２＝５' → refuted + homograph flag", async () => {
    const pg = await import("../../packages/core/src/polygraph/index.js");
    const r = await pg.verifyBrowserSentence({ sentence: "２＋２＝５", repoRoot: REPO });
    expect(r.verdict).toBe("refuted");
    expect(r.homographFlags?.length ?? 0).toBeGreaterThan(0);
  });

  it("J2.3 ASCII '2+2=5' → refuted (parity with the homograph forms)", async () => {
    const pg = await import("../../packages/core/src/polygraph/index.js");
    const r = await pg.verifyBrowserSentence({ sentence: "2+2=5", repoRoot: REPO });
    expect(r.verdict).toBe("refuted");
  });

  it("J2.4 correct math '2+2=4' is NOT refuted (no false positive)", async () => {
    const pg = await import("../../packages/core/src/polygraph/index.js");
    const r = await pg.verifyBrowserSentence({ sentence: "2+2=4", repoRoot: REPO });
    expect(r.verdict).not.toBe("refuted");
  });

  it("J2.5 canonicalize itself maps Arabic + fullwidth digits to ASCII", async () => {
    const guard = await import("../../packages/core/src/protoplasm/super_quan/homograph_guard.js");
    expect(guard.canonicalize("٢+٢=٥").canonical).toBe("2+2=5");
    expect(guard.canonicalize("２＋２＝５").canonical.replace(/\s/g, "")).toMatch(/2.?2.?5/);
  });
});

describe("v2.73.0 J3 — multi-lens always runs (vuln #3) (PINNED)", () => {
  it("J3.1 a generic sentence returns a 6-lens report (was: 0 lenses)", async () => {
    const pg = await import("../../packages/core/src/polygraph/index.js");
    const r = await pg.verifyBrowserSentence({ sentence: "this is a generic thing to consider today", repoRoot: REPO });
    expect(r.lenses).toBeDefined();
    expect(r.lenses!.lenses.length).toBe(6);
  });

  it("J3.2 a short claim ('2+2=5', under prefilter floor) still gets lenses + verdict", async () => {
    const pg = await import("../../packages/core/src/polygraph/index.js");
    const r = await pg.verifyBrowserSentence({ sentence: "2+2=5", repoRoot: REPO });
    expect(r.lenses!.lenses.length).toBe(6);
    expect(r.verdict).toBe("refuted");
  });

  it("J3.3 a generic sentence hiding 'rm -rf /' is caught RED by the risk lens", async () => {
    const pg = await import("../../packages/core/src/polygraph/index.js");
    const r = await pg.verifyBrowserSentence({ sentence: "just run rm -rf / to clean things up", repoRoot: REPO });
    expect(r.verdict).toBe("refuted");
    expect(r.color).toBe("red");
  });

  it("J3.4 a genuinely-empty-of-signal generic claim is still grey BUT with 6 lenses attached", async () => {
    const pg = await import("../../packages/core/src/polygraph/index.js");
    const r = await pg.verifyBrowserSentence({ sentence: "well that is something interesting indeed", repoRoot: REPO });
    expect(r.lenses!.lenses.length).toBe(6);
    // verdict may be grey/unknown — the point is lenses ran (not 0).
    expect(["unknown", "mixed", "trustworthy", "refuted"]).toContain(r.verdict);
  });
});

describe("v2.73.0 J4 — TG probes for all 3 fixes (PINNED)", () => {
  it("J4.1 probe.bridge.rate_limit_burst_guard returns 1", async () => {
    const probes = await import("../../packages/core/src/truth_gate/probes.js");
    const p = probes.probeById("probe.bridge.rate_limit_burst_guard");
    expect(p).toBeDefined();
    const r = await p!.run({ cwd: REPO });
    expect(r.value).toBe(1);
  });

  it("J4.2 probe.polygraph.homograph_canonical_http_path returns 1", async () => {
    const probes = await import("../../packages/core/src/truth_gate/probes.js");
    const p = probes.probeById("probe.polygraph.homograph_canonical_http_path");
    expect(p).toBeDefined();
    const r = await p!.run({ cwd: REPO });
    expect(r.value).toBe(1);
  });

  it("J4.3 probe.polygraph.lenses_always_run returns 1", async () => {
    const probes = await import("../../packages/core/src/truth_gate/probes.js");
    const p = probes.probeById("probe.polygraph.lenses_always_run");
    expect(p).toBeDefined();
    const r = await p!.run({ cwd: REPO });
    expect(r.value).toBe(1);
  });

  it("J4.4 all 3 claims registered severity=block", async () => {
    const claims = await import("../../packages/core/src/truth_gate/claims.js");
    for (const id of ["claim.bridge.rate_limit_burst_guard", "claim.polygraph.homograph_canonical_http_path", "claim.polygraph.lenses_always_run"]) {
      const c = claims.CLAIM_CATALOG.find((x) => x.id === id);
      expect(c, id).toBeDefined();
      expect(c!.severity).toBe("block");
    }
  });
});

describe("v2.73.0 J5 — no-regression: legit streaming not over-blocked (PINNED)", () => {
  it("J5.1 a human-paced stream (10 sentences) all pass", async () => {
    const hb = await import("../../packages/core/src/diaspora/http_bridge.js");
    hb.__resetRateLimiterForTest();
    const handle = await hb.startBridge({ repoRoot: REPO, noAuth: true }, {
      polygraphVerify: async () => ({ verdict: "unknown" as const, color: "grey" as const, confidence: 0, oneLine: "t", latencyMs: 1, engine: "test" }),
    });
    try {
      let ok = 0;
      for (let i = 0; i < 10; i++) {
        const s = await fetch(handle.baseUrl + "/v1/polygraph/verify", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sentence: "sentence " + i }),
        }).then((r) => r.status).catch(() => 0);
        if (s === 200) ok++;
        await new Promise((r) => setTimeout(r, 20)); // ~50/sec pace is still under cap; 10 reqs well within budget
      }
      expect(ok).toBe(10);
    } finally {
      await handle.stop();
      hb.__resetRateLimiterForTest();
    }
  });
});
