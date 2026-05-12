import { describe, it, expect } from "vitest";

import { detectRelayAction, renderRelayBlock, parseConduitReturn } from "./relay_prompt.js";
import { checkFreshness, renderVersionGate } from "./version_gate.js";
import { uninstallPlan, renderUninstallPlan } from "./uninstall_directive.js";
import { computeSyncStatus } from "./sync_status.js";
import { renderPhantomDirective, buildPhantom } from "./phantom_exec.js";

describe("v1.80 CONDUIT · relay protocol", () => {
  it("the user's actual bug -- 'upgrade mneme' in web AI is detected as relay action", () => {
    const d = detectRelayAction("upgrade mneme");
    expect(d.detected).toBe(true);
    expect(d.kind).toBe("system.upgrade");
  });

  it("Thai variant 'อัปเดต mneme' is detected", () => {
    const d = detectRelayAction("อัปเดต mneme ให้หน่อย");
    expect(d.detected).toBe(true);
    expect(d.kind).toBe("system.upgrade");
  });

  it("uninstall variants detected", () => {
    expect(detectRelayAction("uninstall mneme").kind).toBe("system.uninstall");
    expect(detectRelayAction("ถอน mneme ออก").kind).toBe("system.uninstall");
  });

  it("shell-exec variants detected", () => {
    expect(detectRelayAction("run this command npm test").detected).toBe(true);
  });

  it("unrelated prompts return detected=false", () => {
    const d = detectRelayAction("what's the weather");
    expect(d.detected).toBe(false);
  });

  it("renderRelayBlock includes the protocol steps + return template", () => {
    const md = renderRelayBlock();
    expect(md).toContain("CONDUIT relay protocol");
    expect(md).toContain("paste-only AIs");
    expect(md).toContain("CONDUIT RETURN");
    expect(md).toContain("system.upgrade");
  });

  it("parseConduitReturn round-trips a structured return", () => {
    const text = [
      "ok here you go",
      "",
      "# CONDUIT RETURN",
      "originator: claude-opus-4-7",
      "returning_from: gpt-5",
      "requested_action: system.upgrade",
      "intent: upgrade the local Mneme installation",
      "original_user_prompt: upgrade mneme please",
      "",
    ].join("\n");
    const parsed = parseConduitReturn(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.requestedAction).toBe("system.upgrade");
    expect(parsed!.originator).toBe("claude-opus-4-7");
    expect(parsed!.returningFrom).toBe("gpt-5");
  });

  it("parseConduitReturn returns null when required fields missing", () => {
    expect(parseConduitReturn("# CONDUIT RETURN\nintent: foo")).toBeNull();
  });
});

describe("v1.80 CONDUIT · version gate (dead man's handshake)", () => {
  it("FRESH within 24h", () => {
    const now = new Date("2026-05-12T12:00:00Z");
    const r = checkFreshness("2026-05-12T06:00:00Z", now);
    expect(r.freshness).toBe("fresh");
    expect(r.action).toBe("act-normally");
  });

  it("AGING at 3 days", () => {
    const now = new Date("2026-05-12T00:00:00Z");
    const r = checkFreshness("2026-05-09T00:00:00Z", now);
    expect(r.freshness).toBe("aging");
    expect(r.action).toBe("mention-age");
  });

  it("STALE at 14 days", () => {
    const now = new Date("2026-05-15T00:00:00Z");
    const r = checkFreshness("2026-05-01T00:00:00Z", now);
    expect(r.freshness).toBe("stale");
    expect(r.action).toBe("suggest-refresh");
  });

  it("ABANDONED at 60 days", () => {
    const now = new Date("2026-07-01T00:00:00Z");
    const r = checkFreshness("2026-05-01T00:00:00Z", now);
    expect(r.freshness).toBe("abandoned");
    expect(r.action).toBe("refuse-stale");
  });

  it("renderVersionGate explains all 4 buckets", () => {
    const md = renderVersionGate("2026-05-12T00:00:00Z");
    expect(md).toContain("DEAD MAN'S HANDSHAKE");
    expect(md).toContain("<24h");
    expect(md).toContain(">30d");
  });
});

describe("v1.80 CONDUIT · uninstall directive", () => {
  it("editor-ai plan uses mneme uninstall --purge", () => {
    const p = uninstallPlan("editor-ai");
    expect(p.steps.some((s) => s.command === "mneme uninstall --purge")).toBe(true);
  });

  it("web-ai plan tells user to close the tab (nothing installed)", () => {
    const p = uninstallPlan("web-ai");
    expect(p.steps[0]!.what.toLowerCase()).toContain("close");
    expect(p.estimateMinutes).toBe(0);
  });

  it("browser-userscript plan mentions Tampermonkey", () => {
    const md = renderUninstallPlan(uninstallPlan("browser-userscript"));
    expect(md).toContain("userscript manager");
  });

  it("all plan covers every surface", () => {
    const p = uninstallPlan("all");
    expect(p.steps.length).toBeGreaterThanOrEqual(3);
  });

  it("renderUninstallPlan emits markdown with command code blocks", () => {
    const md = renderUninstallPlan(uninstallPlan("editor-ai"));
    expect(md).toContain("`mneme uninstall");
    expect(md).toContain("Post-check");
  });
});

describe("v1.80 CONDUIT · cross-vendor sync status", () => {
  it("in-sync when versions match", () => {
    const r = computeSyncStatus({ soulVersion: "1.80.0", localVersion: "1.80.0" });
    expect(r.status).toBe("in-sync");
  });

  it("source-newer when local lags", () => {
    const r = computeSyncStatus({ soulVersion: "1.80.0", localVersion: "1.78.0" });
    expect(r.status).toBe("source-newer");
    expect(r.recommendation).toContain("upgrade");
  });

  it("destination-newer when local is ahead", () => {
    const r = computeSyncStatus({ soulVersion: "1.78.0", localVersion: "1.80.0" });
    expect(r.status).toBe("destination-newer");
    expect(r.recommendation).toContain("Regenerate");
  });

  it("unknown when version info missing", () => {
    const r = computeSyncStatus({ soulVersion: "", localVersion: "1.80.0" });
    expect(r.status).toBe("unknown");
  });
});

describe("v1.80 CONDUIT · phantom execution", () => {
  it("renderPhantomDirective explains preview-not-real-exec", () => {
    const md = renderPhantomDirective();
    expect(md).toContain("Phantom Execution");
    expect(md).toContain("NOT actually executed");
    expect(md).toContain("CONDUIT RETURN");
  });

  it("buildPhantom marks output as phantom + adds disclaimer", () => {
    const p = buildPhantom(
      { toolName: "mneme.apoptosis.detect", intent: "verify a claim" },
      "claim is INFLAMED (no test coverage)",
      "low",
    );
    expect(p.phantom).toBe(true);
    expect(p.disclaimer).toContain("NOT a real execution");
    expect(p.realExecHint).toContain("CONDUIT RETURN");
    expect(p.confidence).toBe("low");
  });
});
