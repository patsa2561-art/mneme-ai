/**
 * v2.19.33 INTEGRATION TEST — B1 + B2 + B3 + B4 working together
 *
 * Real-world scenario: a developer (Shinnapat) joins a fresh repo. The AI
 * agent needs to:
 *   1. Discover the right tools (B3 — mneme.browse + mneme.suggest)
 *   2. Extract agreements from team chat transcripts (B1 — extract_decisions)
 *   3. Verify a claim about the new release (B2 — truth sensor stack)
 *   4. Schedule the brain organs without idle (B4 — context-shift scheduler)
 *
 * If this test passes, the 4 fixes compose correctly end-to-end.
 */
import { describe, it, expect } from "vitest";
import { extractDecisions } from "../conversation_compiler/index.js";
import { proposeSensorPlan } from "../truth_sensor_pack/index.js";
import { browseCatalog, suggestTools, type ToolCatalogEntry } from "../tool_browser/index.js";
import {
  decideTicks,
  freshHealthRecord,
  DEFAULT_SCHEDULES_ACTIVE_DEV,
  type OrganHealthRecord,
  type EventSignals,
} from "../autonomic_scheduler/index.js";

describe("v2.19.33 INTEGRATION — full polish-release end-to-end", () => {
  it("scenario: new developer joins repo, AI agent discovers + extracts + verifies + schedules", () => {
    const fakeRepoCatalog: ToolCatalogEntry[] = [
      { name: "mneme.status", tier: "starter", description: "show status" },
      { name: "mneme.handoff.snapshot", tier: "starter", description: "fresh context capture for cross-device handoff" },
      { name: "mneme.truth.forensic", tier: "starter", description: "verify claim against catalog" },
      { name: "mneme.truth.init", tier: "starter", description: "default sensor stack for claims" },
      { name: "mneme.truth.contradictions", tier: "starter", description: "detect self-contradicting claims" },
      { name: "mneme.synapse.sync_export", tier: "starter", description: "cross-device brain sync" },
      { name: "mneme.guard", tier: "starter", description: "pre-commit hook" },
      { name: "mneme.browse", tier: "starter", description: "paginated catalog browse" },
      { name: "mneme.suggest", tier: "starter", description: "repo-aware tool recommendations" },
      { name: "mneme.soul.embalm", tier: "explorer", description: "agent state snapshot for ban-recovery" },
      { name: "mneme.beacon.spawn", tier: "experimental", description: "QR transfer server" },
    ];

    // ─── STEP 1: B3 — DISCOVERABILITY ──────────────────────────────
    // New user runs mneme.browse to see starter tools
    const browse = browseCatalog({ catalog: fakeRepoCatalog, tier: "starter" });
    expect(browse.totalMatches).toBe(9);
    expect(browse.entries[0]!.tier).toBe("starter");

    // AI suggests based on repo signals (Node repo + uncommitted changes)
    const suggestions = suggestTools({
      catalog: fakeRepoCatalog,
      intent: "verify the new release claim",
      repoSignals: { hasPackageJson: true, hasUncommittedChanges: true, hasDotGit: true },
      limit: 5,
    });
    expect(suggestions.suggestions.length).toBeGreaterThanOrEqual(1);
    // truth.forensic should rank high (intent match + uncommitted-changes signal)
    expect(suggestions.suggestions.some((s) => s.tool.name === "mneme.truth.forensic")).toBe(true);

    // ─── STEP 2: B1 — EXTRACT TEAM AGREEMENTS ─────────────────────
    const teamChat = `Decision: every commit must pass test before merge.
Deploy needs 2 reviewers per PR.
ห้าม push main ตรงๆ.
Update changelog for every release.`;
    const decisions = extractDecisions({ transcript: teamChat });
    // Should capture test_required + review_required + no_direct_push_main + must_have_changelog
    expect(decisions.length).toBeGreaterThanOrEqual(3);
    const patterns = new Set(decisions.map((d) => d.pattern));
    expect(patterns.has("test_required")).toBe(true);
    expect(patterns.has("review_required")).toBe(true);

    // ─── STEP 3: B2 — VERIFY A CLAIM WITH DEFAULT SENSOR STACK ────
    const claim = "mneme.handoff.snapshot is registered in the catalog";
    const sensorPlan = proposeSensorPlan({ claim });
    expect(sensorPlan.shape).toBe("tool_capability");
    expect(sensorPlan.recommendedSensors.length).toBeGreaterThanOrEqual(2);
    // For tool_capability claims, truth_forensic should be recommended
    expect(sensorPlan.recommendedSensors.some((s) => s.id === "truth_forensic")).toBe(true);

    // ─── STEP 4: B4 — SCHEDULER TICKS DESPITE ACTIVE DEV ──────────
    // Simulate active dev: just committed (commit cycle) on a fresh branch
    const health: OrganHealthRecord[] = [
      freshHealthRecord("breath"),
      freshHealthRecord("reflex"),
      freshHealthRecord("sleep"),
      freshHealthRecord("dreamspace"),
      freshHealthRecord("hormonal"),
    ];
    const events: EventSignals = {
      hasCommitCycle: true,
      hasBranchSwitch: true,
      msSinceLastCommit: 0,
      idleMs: 0, // active dev — NEVER idle
    };
    const plan = decideTicks({
      schedules: DEFAULT_SCHEDULES_ACTIVE_DEV,
      health,
      events,
      nowMs: Date.now(),
    });
    // SLEEP fires on branch switch, DREAMSPACE on commit cycle
    const sleepEntry = plan.entries.find((e) => e.organ === "sleep");
    const dreamEntry = plan.entries.find((e) => e.organ === "dreamspace");
    expect(sleepEntry?.shouldTick).toBe(true);
    expect(dreamEntry?.shouldTick).toBe(true);

    // ─── STEP 5: SYSTEM COHERENCE ──────────────────────────────────
    // All 4 fixes worked together; no contradictions
    expect(browse.entries.length).toBeGreaterThan(0);
    expect(decisions.length).toBeGreaterThan(0);
    expect(sensorPlan.recommendedSensors.length).toBeGreaterThan(0);
    expect(plan.entries.filter((e) => e.shouldTick).length).toBeGreaterThan(0);
  });

  it("composition: suggest → browse → extract chain (multi-step UX)", () => {
    const cat: ToolCatalogEntry[] = [
      { name: "mneme.truth.init", tier: "starter", description: "default sensor stack", triggers: ["truth init", "verify claim"] },
    ];
    // Step 1: User asks "how do I verify a claim?"
    const suggested = suggestTools({ catalog: cat, intent: "verify claim" });
    expect(suggested.suggestions[0]!.tool.name).toBe("mneme.truth.init");

    // Step 2: AI runs the suggested tool with the claim
    const plan = proposeSensorPlan({ claim: "we shipped v2.19.33" });
    expect(plan.shape).toBe("version_claim");
    expect(plan.recommendedSensors.some((s) => s.id === "truth_forensic")).toBe(true);

    // Step 3: Extract decisions from the claim text
    const decisions = extractDecisions({ transcript: "every release must update changelog" });
    expect(decisions.some((d) => d.pattern === "must_have_changelog")).toBe(true);
  });

  it("regression: all 4 fixes maintain backward-compat with prior tests", async () => {
    // Pre-fix behaviour preserved where not breaking the bug
    const oldExtractTest = extractDecisions({ transcript: "Every commit must have a test before merging." });
    expect(oldExtractTest.length).toBeGreaterThan(0);

    // STARTER tier expanded but old entries still present
    const tt = await import("../tool_tier/index.js");
    expect(tt.STARTER_WHITELIST.has("mneme.status")).toBe(true);
    expect(tt.STARTER_WHITELIST.has("mneme.ask")).toBe(true);

    // Scheduler default is now ACTIVE_DEV (compat shim DEFAULT_SCHEDULES_LEGACY available)
    const sched = await import("../autonomic_scheduler/index.js");
    expect(sched.DEFAULT_SCHEDULES).toBe(sched.DEFAULT_SCHEDULES_ACTIVE_DEV);
    expect(sched.DEFAULT_SCHEDULES_LEGACY.length).toBeGreaterThan(0);
  });
});
