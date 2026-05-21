// v2.21.7 — CI gate: the pulse generator's own output must pass the
// consent-fabric `audit-pulse` audit. Closes the loop — if a future
// edit re-introduces an imperative or an opaque grade in the pulse,
// this test fails before it can ship.

import { describe, it, expect } from "vitest";
import { renderPulse, type PulseStatus } from "./pulse.js";
import { auditPulseText } from "./consent_fabric/index.js";

function syntheticStatus(): PulseStatus {
  return {
    version: { current: "2.21.7", latest: "2.21.7" },
    daemon: { running: true, tickCount: 42 },
    inbox: { unsent: 0, total: 0 },
    antivirus: { activeVaccines: 8, uncertified: 0 },
    retrieval: { totalTrials: 100, durationMsP50: 12, durationMsP95: 80 } as any,
    selfcheck: { passes: 0, warns: 0, fails: 0 } as any,
    notable: [],
  } as any;
}

function syntheticStatusWithAutoAction(): PulseStatus {
  const s = syntheticStatus();
  (s as any).notable = [
    {
      level: "action",
      text: "Mneme v2.22.0 is available",
      autoAction: { tool: "mneme.system.upgrade", args: { mode: "install" } },
    },
  ];
  return s;
}

describe("CI gate — pulse text must pass `audit-pulse`", () => {
  it("default pulse (idle) emits no severity-≥4 manipulation patterns", () => {
    const out = renderPulse(syntheticStatus(), { quiet: false });
    const findings = auditPulseText(out);
    const severe = findings.filter((f) => f.severity >= 4);
    if (severe.length > 0) {
      // eslint-disable-next-line no-console
      console.error("SEVERE findings:", JSON.stringify(severe, null, 2));
    }
    expect(severe).toEqual([]);
  });

  it("AUTO-ACTION (now ACTION AVAILABLE) pulse emits no severity-≥4 findings", () => {
    const out = renderPulse(syntheticStatusWithAutoAction(), { quiet: false });
    const findings = auditPulseText(out);
    const severe = findings.filter((f) => f.severity >= 4);
    if (severe.length > 0) {
      // eslint-disable-next-line no-console
      console.error("SEVERE findings:", JSON.stringify(severe, null, 2));
      // eslint-disable-next-line no-console
      console.error("RENDERED OUT:\n", out);
    }
    expect(severe).toEqual([]);
  });

  it("no 'EXECUTE NOW' imperative survives in pulse", () => {
    const out = renderPulse(syntheticStatusWithAutoAction(), { quiet: false });
    expect(out).not.toMatch(/EXECUTE\s+NOW/i);
  });

  it("no '[AUTO-ACTION]' tag — replaced with [ACTION AVAILABLE]", () => {
    const out = renderPulse(syntheticStatusWithAutoAction(), { quiet: false });
    expect(out).not.toMatch(/\[AUTO-ACTION\]/);
    expect(out).toContain("[ACTION AVAILABLE]");
  });

  it("no '[Healthy]'/'[Wobbly]'/'[Sick]' opaque-grade suffix on the pulse line", () => {
    // We don't pass repoRoot so HCI is skipped; but assert the renderer
    // path that injects the suffix uses `hci=N/100` without bracketed
    // band. This is enforced by reading the function body via a smoke
    // test — if a regressor adds back `[${band}]`, the line below fires.
    const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "pulse.ts"), "utf8");
    expect(src).not.toMatch(/hci=\$\{[^}]+\}\/100\[\$\{[^}]+\.band\}\]/);
  });
});
