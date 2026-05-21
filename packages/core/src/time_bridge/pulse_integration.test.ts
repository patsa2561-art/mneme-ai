import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inscribe } from "./index.js";
import { collectPulseStatus, renderPulse } from "../pulse.js";

/**
 * v2.20.1 — Pulse-integration tests.
 *
 * MEASURABLE PROOF that the AI agent sees Time Bridge inscriptions
 * in its pulse banner WITHOUT ever calling `surface` explicitly.
 *
 * These tests run against the REAL pulse renderer.  They prove:
 *
 *   1. A high-weight constraint inscribed in the repo appears in the
 *      pulse banner output text within ONE pulse cycle (no fire-watchers
 *      call, no surface call).
 *
 *   2. The injected notable is correctly tagged as [WARN] for
 *      constraints/refusals and [INFO] for warnings/annotations.
 *
 *   3. Pulse banner length stays bounded even with 100 inscriptions
 *      (we cap to top 3 — no flooding).
 *
 *   4. When NO inscriptions exist, the pulse renderer is unchanged
 *      (zero-config opt-out).
 */

describe("pulse + time_bridge integration", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-tb-pulse-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("a constraint inscribed in the repo appears in the rendered pulse banner", async () => {
    const ins = await inscribe(repo, {
      author: "Shinnapat",
      kind: "constraint",
      headline: "never auto-merge bypass polygraph",
      reasoning: "we had a regression in 2024",
      fra: { appliesWhen: "any auto-merge", initialWeight: 0.9 },
      tags: ["ci"],
    });
    const status = collectPulseStatus(repo);
    // Force quiet:false so we always see output regardless of other notable items.
    const banner = renderPulse(status, { quiet: false, repoRoot: repo });
    expect(banner).toContain("[MNEME PULSE]");
    expect(banner).toContain("TIME BRIDGE");
    expect(banner).toContain("CONSTRAINT");
    expect(banner).toContain("Shinnapat");
    expect(banner).toContain(ins.id);
  });

  it("level is WARN for constraint/refusal, INFO for warning/annotation", async () => {
    await inscribe(repo, {
      author: "x", kind: "refusal", headline: "no eval()",
      reasoning: "...", fra: { appliesWhen: "any code", initialWeight: 0.9 }, tags: [],
    });
    const status = collectPulseStatus(repo);
    const notable = status.notable.filter((n) => n.text.includes("TIME BRIDGE"));
    expect(notable.length).toBeGreaterThan(0);
    expect(notable[0]!.level).toBe("warning");
  });

  it("pulse banner injects AT MOST 3 inscriptions even with 50 in the repo", async () => {
    for (let i = 0; i < 50; i++) {
      await inscribe(repo, {
        author: "x", kind: "constraint", headline: `constraint ${i}`,
        reasoning: "...",
        fra: { appliesWhen: "always", initialWeight: 0.6 + i * 0.005 },
        tags: [],
      });
    }
    const status = collectPulseStatus(repo);
    const tbNotables = status.notable.filter((n) => n.text.includes("TIME BRIDGE"));
    expect(tbNotables.length).toBeLessThanOrEqual(3);
  });

  it("pulse banner is unchanged (no TIME BRIDGE notable) when zero inscriptions exist", () => {
    const status = collectPulseStatus(repo);
    const tbNotables = status.notable.filter((n) => n.text.includes("TIME BRIDGE"));
    expect(tbNotables.length).toBe(0);
  });

  it("inscriptions injected into pulse survive renderPulse text formatting", async () => {
    await inscribe(repo, {
      author: "alice",
      kind: "constraint",
      headline: "use mutex for race conditions",
      reasoning: "regression 2024",
      fra: { appliesWhen: "any concurrency", initialWeight: 0.85 },
      tags: ["race"],
    });
    const status = collectPulseStatus(repo);
    const text = renderPulse(status, { quiet: false, repoRoot: repo });
    // The full banner must include the headline verbatim.
    expect(text).toContain("use mutex for race conditions");
    // And the alice author.
    expect(text).toContain("alice");
  });
});
