import { describe, it, expect } from "vitest";
import { buildItems, type SidebarReportData } from "../src/views/sidebarProvider.js";
import type { AuditCertificate } from "@mneme-ai/core/public";

function emptyCert(verdict: "pass" | "warn" | "fail"): AuditCertificate {
  // Minimal stub — the formatter only reads overallVerdict + capturedAt.
  return {
    sessionId: "test",
    capturedAt: "2026-01-15T00:00:00.000Z",
    overallVerdict: verdict,
    exitCode: verdict === "fail" ? 1 : 0,
    axes: {} as AuditCertificate["axes"],
    forensicAxes: { size: "pass", files: "pass", style: "pass", time: "pass" },
  };
}

describe("buildItems", () => {
  it("shows the no-db hint when the workspace isn't indexed", () => {
    const items = buildItems({
      hasDb: false,
      hasBaseline: false,
      certificate: null,
      atrophy: null,
      passport: null,
    });
    expect(items.length).toBe(1);
    expect(items[0]!.kind).toBe("no-db");
    expect(items[0]!.description).toContain("mneme index");
  });

  it("renders all three sections when the DB exists", () => {
    const data: SidebarReportData = {
      hasDb: true,
      hasBaseline: false,
      certificate: null,
      atrophy: null,
      passport: null,
    };
    const items = buildItems(data);
    expect(items.length).toBe(3);
    expect(items.map((i) => i.label)).toEqual(["🛡 Audit", "⏳ At-risk files", "👤 My passport"]);
  });

  it("audit section nudges the user when no baseline exists", () => {
    const data: SidebarReportData = {
      hasDb: true,
      hasBaseline: false,
      certificate: null,
      atrophy: null,
      passport: null,
    };
    const items = buildItems(data);
    const audit = items[0]!;
    expect(audit.children?.[0]?.label).toBe("No baseline yet");
    expect(audit.children?.[0]?.description).toContain("baseline");
  });

  it("audit section surfaces the verdict from the certificate", () => {
    const data: SidebarReportData = {
      hasDb: true,
      hasBaseline: true,
      certificate: emptyCert("warn"),
      atrophy: null,
      passport: null,
    };
    const items = buildItems(data);
    const audit = items[0]!;
    expect(audit.children?.[0]?.label).toContain("warn");
    expect(audit.children?.[0]?.kind).toBe("audit-status");
  });

  it("at-risk section formats the top file with knower context", () => {
    const data: SidebarReportData = {
      hasDb: true,
      hasBaseline: false,
      certificate: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      atrophy: {
        atRiskFiles: [
          {
            filePath: "src/auth.ts",
            totalTouches: 12,
            tier: "at-risk",
            freshestKnowledge: 0.21,
            allKnowers: [
              { name: "Alice", email: "a@x", knowledge: 0.21, lastTouchDaysAgo: 220, touchCount: 4 },
            ],
            liveExperts: [],
          },
        ],
      } as any,
      passport: null,
    };
    const items = buildItems(data);
    const atRisk = items[1]!;
    expect(atRisk.children?.[0]?.label).toBe("src/auth.ts");
    expect(atRisk.children?.[0]?.description).toContain("Alice");
    expect(atRisk.children?.[0]?.description).toContain("21%");
    expect(atRisk.children?.[0]?.fileToOpen).toBe("src/auth.ts");
  });

  it("at-risk section says 'nothing at risk' when the report is empty", () => {
    const data: SidebarReportData = {
      hasDb: true,
      hasBaseline: false,
      certificate: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      atrophy: { atRiskFiles: [] } as any,
      passport: null,
    };
    const items = buildItems(data);
    expect(items[1]!.children?.[0]?.label).toContain("Nothing at risk");
  });

  it("passport section renders the author summary + top files", () => {
    const data: SidebarReportData = {
      hasDb: true,
      hasBaseline: false,
      certificate: null,
      atrophy: null,
      passport: {
        name: "Jane Smith",
        email: "jane@example.com",
        knowledgeMass: 12.4,
        topFiles: [
          { filePath: "src/index.ts", knowledge: 0.92 },
          { filePath: "src/util.ts", knowledge: 0.71 },
          { filePath: "src/store.ts", knowledge: 0.55 },
        ],
      },
    };
    const items = buildItems(data);
    const passport = items[2]!;
    expect(passport.children?.[0]?.label).toContain("Jane Smith");
    expect(passport.children?.[0]?.label).toContain("12.4");
    // 1 summary + 3 top files
    expect(passport.children?.length).toBe(4);
    expect(passport.children?.[1]?.fileToOpen).toBe("src/index.ts");
  });

  it("passport section nudges the user when no author detected", () => {
    const data: SidebarReportData = {
      hasDb: true,
      hasBaseline: false,
      certificate: null,
      atrophy: null,
      passport: null,
    };
    const items = buildItems(data);
    expect(items[2]!.children?.[0]?.kind).toBe("passport-empty");
  });
});
