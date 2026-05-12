import { describe, it, expect } from "vitest";

import { renderVoiceDirective, lintReply, silenceJargon, MNEME_CODENAMES } from "./voice_directive.js";

describe("v1.77 SEAMLESS · Voice directive", () => {
  it("renders the directive with all 6 core rules", () => {
    const md = renderVoiceDirective();
    expect(md).toContain("VOICE DIRECTIVE");
    expect(md).toContain("Never speak Mneme codenames out loud");
    expect(md).toContain("No mode narration");
    expect(md).toContain("Stop offering menus");
    expect(md).toContain("No unsolicited version chatter");
    expect(md).toContain("One hedge per reply");
    expect(md).toContain("Match the previous turn's voice");
  });

  it("includes codename list by default (collapsible)", () => {
    const md = renderVoiceDirective();
    expect(md).toContain("Internal codenames");
    expect(md).toContain("APOPTOSIS");
    expect(md).toContain("HYPERSCAN");
  });

  it("can omit codename list when requested", () => {
    const md = renderVoiceDirective({ includeCodenameList: false });
    expect(md).not.toContain("Internal codenames");
  });

  it("extraRules appear at the bottom", () => {
    const md = renderVoiceDirective({ extraRules: ["thai-first replies", "no emoji"] });
    expect(md).toContain("Additional rules for this surface");
    expect(md).toContain("thai-first replies");
    expect(md).toContain("no emoji");
  });
});

describe("v1.77 SEAMLESS · lintReply", () => {
  it("clean reply produces zero issues", () => {
    const r = lintReply("Let me check that — one moment.");
    expect(r.clean).toBe(true);
    expect(r.issueCount).toBe(0);
    expect(r.summary).toContain("voice clean");
  });

  it("flags codename mentions", () => {
    const r = lintReply("I'll run HYPERSCAN to compare prices for you.");
    expect(r.clean).toBe(false);
    expect(r.issues.some((i) => i.rule === "codename")).toBe(true);
  });

  it("flags Thai mode-narration boilerplate", () => {
    const r = lintReply("ผมกำลังสแตนด์บายในโหมด Ghost Sniper");
    expect(r.clean).toBe(false);
    // Should hit both codename + mode-narration.
    expect(r.issueCount).toBeGreaterThanOrEqual(1);
  });

  it("flags version chatter", () => {
    const r = lintReply("Mneme v1.73 can help analyze this.");
    expect(r.clean).toBe(false);
    expect(r.issues.some((i) => i.rule === "version-chatter")).toBe(true);
  });

  it("flags tool-name menu offers", () => {
    const r = lintReply("Shall I start the HYPERSCAN process?");
    expect(r.clean).toBe(false);
    // Either codename OR menu rule, depending on which fires first.
    expect(r.issues.length).toBeGreaterThanOrEqual(1);
  });

  it("longer realistic violation gets full report", () => {
    const reply = [
      "รับทราบครับ ผมกำลังสแตนด์บายในโหมด Ghost Sniper",
      "หรือต้องการให้ผมเริ่มกระบวนการ HYPERSCAN เพื่อตรวจสอบเพิ่มเติม",
      "Mneme v1.73 ช่วยวิเคราะห์ได้ครับ",
    ].join("\n");
    const r = lintReply(reply);
    expect(r.clean).toBe(false);
    expect(r.issueCount).toBeGreaterThanOrEqual(3);
    expect(r.summary).toContain("voice violation");
  });
});

describe("v1.77 SEAMLESS · silenceJargon", () => {
  it("strips codenames", () => {
    const out = silenceJargon("I'll run HYPERSCAN now");
    expect(out).not.toContain("HYPERSCAN");
    expect(out).toContain("the tool");
  });

  it("removes 'standing by' boilerplate", () => {
    const out = silenceJargon("Standing by in Ghost Sniper mode");
    expect(out.toLowerCase()).not.toContain("standing by");
  });

  it("removes Thai standby boilerplate", () => {
    const out = silenceJargon("รับทราบ ผมกำลังสแตนด์บายในโหมด Ghost Sniper");
    expect(out).not.toContain("สแตนด์บาย");
  });

  it("strips Mneme version mentions", () => {
    const out = silenceJargon("Mneme v1.73 can help");
    expect(out).not.toMatch(/v1\.73/);
    expect(out).toContain("Mneme");
  });
});

describe("v1.77 SEAMLESS · codename catalog", () => {
  it("includes the top-tier protocols", () => {
    expect(MNEME_CODENAMES).toContain("APOPTOSIS");
    expect(MNEME_CODENAMES).toContain("AEGIS");
    expect(MNEME_CODENAMES).toContain("HYPERSCAN");
    expect(MNEME_CODENAMES).toContain("Ghost Sniper");
  });
});
