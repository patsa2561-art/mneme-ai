import { describe, it, expect } from "vitest";

import {
  parseCloneIntent,
  planTransport,
  cloneTo,
  formatCloneToPulseLine,
  openInBrowser,
  type CloneTarget,
} from "./clone_to.js";
import { DEPRECATED_RELAY_PATHS, formatBugTruth } from "./bug_truth.js";

// ============================================================
// Phrase recognition — every phrase the user complained about MUST be
// recognized + routed to the right target.
// ============================================================

describe("v1.97 CLONE-TO · Thai phrase recognition (the bugs the user yelled about)", () => {
  it("recognizes 'ย้าย mneme ไปใส่ใน mobile หน่อย'", () => {
    const r = parseCloneIntent("ย้าย mneme ไปใส่ใน mobile หน่อย");
    expect(r.isCloneRequest).toBe(true);
    expect(r.target).toBe("mobile");
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  it("recognizes 'ส่งความจำของ mneme ไปใน gemini'", () => {
    const r = parseCloneIntent("ส่งความจำของ mneme ไปใน gemini");
    expect(r.isCloneRequest).toBe(true);
    expect(r.target).toBe("gemini");
    expect(r.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it("recognizes 'ส่งสมองไปมือถือ'", () => {
    const r = parseCloneIntent("ส่งสมองไปมือถือ");
    expect(r.target).toBe("mobile");
    expect(r.isCloneRequest).toBe(true);
  });

  it("recognizes 'โคลน mneme ไป chat gpt'", () => {
    const r = parseCloneIntent("โคลน mneme ไป chat gpt");
    expect(r.target).toBe("chatgpt");
  });

  it("recognizes 'sync brain to ipad'", () => {
    const r = parseCloneIntent("sync brain to ipad");
    expect(r.target).toBe("ipad");
  });

  it("recognizes 'clone to gemini-web'", () => {
    const r = parseCloneIntent("clone to gemini-web");
    expect(r.target).toBe("gemini");
  });

  it("recognizes 'send brain to my notebook'", () => {
    const r = parseCloneIntent("send brain to my notebook");
    expect(r.target).toBe("another-pc");
  });

  it("recognizes 'ก๊อปไปเครื่องนี้ browser'", () => {
    const r = parseCloneIntent("ก๊อปไปเครื่องนี้ browser");
    expect(r.target).toBe("this-pc");
  });

  it("recognizes 'copilot ใช้ mneme หน่อย'", () => {
    const r = parseCloneIntent("copilot ใช้ mneme หน่อย");
    expect(r.target).toBe("copilot");
  });

  it("recognizes 'pack mneme to usb'", () => {
    const r = parseCloneIntent("pack mneme to usb");
    expect(r.target).toBe("usb");
  });

  it("recognizes 'ส่งกลับมาที่ pc'", () => {
    const r = parseCloneIntent("ส่งกลับมาที่ pc");
    expect(r.target).toBe("return");
  });

  it("returns target=unknown + medium confidence when target ambiguous", () => {
    const r = parseCloneIntent("ส่งสมอง mneme หน่อย");
    expect(r.target).toBe("unknown");
    expect(r.isCloneRequest).toBe(true); // still want clone, just unclear where
    expect(r.confidence).toBeGreaterThanOrEqual(0.5);
    expect(r.confidence).toBeLessThan(0.95);
  });

  it("returns isCloneRequest=false for non-clone messages", () => {
    expect(parseCloneIntent("hi how are you").isCloneRequest).toBe(false);
    expect(parseCloneIntent("what's the weather").isCloneRequest).toBe(false);
  });

  it("recognizes English + Thai mixed phrases", () => {
    const r = parseCloneIntent("Please send my brain ไปที่ chatgpt now");
    expect(r.target).toBe("chatgpt");
    expect(r.isCloneRequest).toBe(true);
  });
});

// ============================================================
// Transport planning
// ============================================================

describe("v1.97 CLONE-TO · transport planning", () => {
  it("this-pc → same-shell on localhost:7741/local", () => {
    const p = planTransport("this-pc");
    expect(p.transport).toBe("same-shell");
    if (p.transport === "same-shell") {
      expect(p.openUrl).toContain("localhost:7741/local");
    }
  });

  it("chatgpt → web-paste with chatgpt.com URL", () => {
    const p = planTransport("chatgpt");
    expect(p.transport).toBe("web-paste");
    if (p.transport === "web-paste") expect(p.aiUrl).toContain("chatgpt.com");
  });

  it("gemini → web-paste with gemini.google.com URL (no ?q= deep link)", () => {
    const p = planTransport("gemini");
    if (p.transport === "web-paste") {
      expect(p.aiUrl).toContain("gemini.google.com");
      // The fix for BUG #3: NO ?q= deep link reliance — open home page.
      expect(p.aiUrl).not.toContain("?q=");
    }
  });

  it("claude → claude.ai/new (no encrypted-fetch reliance — BUG #1 + #2 fix)", () => {
    const p = planTransport("claude");
    if (p.transport === "web-paste") {
      expect(p.aiUrl).toContain("claude.ai");
      // No fetch / decrypt instruction — pure clipboard handoff
      expect(p.description).not.toContain("fetch");
      expect(p.description).not.toContain("decrypt");
    }
  });

  it("mobile → tunnel-qr (any network)", () => {
    const p = planTransport("mobile");
    expect(p.transport).toBe("tunnel-qr");
  });

  it("usb → wanderer pack/unpack flow", () => {
    const p = planTransport("usb");
    expect(p.transport).toBe("usb-wanderer");
  });

  it("unknown → menu with all options listed", () => {
    const p = planTransport("unknown");
    expect(p.transport).toBe("menu");
    if (p.transport === "menu") {
      expect(p.options.length).toBeGreaterThanOrEqual(6);
      expect(p.options.map((o) => o.target)).toContain("this-pc");
      expect(p.options.map((o) => o.target)).toContain("mobile");
      expect(p.options.map((o) => o.target)).toContain("gemini");
    }
  });

  it("return → boomerang-return path", () => {
    const p = planTransport("return");
    expect(p.transport).toBe("boomerang-return");
  });

  it("respects custom LAN port", () => {
    const p = planTransport("this-pc", { lanPort: 8888 });
    if (p.transport === "same-shell") expect(p.openUrl).toContain("8888");
  });
});

// ============================================================
// cloneTo top-level dispatcher
// ============================================================

describe("v1.97 CLONE-TO · cloneTo dispatcher", () => {
  it("parses user text → opens browser → returns instruction", () => {
    let openedCmd = "";
    let openedArgs: string[] = [];
    const r = cloneTo({
      userText: "ส่งความจำของ mneme ไปใน gemini",
      spawnOverride: (cmd, args) => { openedCmd = cmd; openedArgs = args; },
    });
    expect(r.resolvedTarget).toBe("gemini");
    expect(r.browserOpen?.opened).toBe(true);
    expect(openedCmd.length).toBeGreaterThan(0);
    expect(openedArgs.some((a: string) => a.includes("gemini.google.com"))).toBe(true);
    expect(r.userInstruction.toLowerCase()).toContain("clipboard");
  });

  it("accepts target directly (skips parsing)", () => {
    const r = cloneTo({
      target: "mobile",
      openBrowser: false,
    });
    expect(r.resolvedTarget).toBe("mobile");
    expect(r.intent).toBeNull();
  });

  it("openBrowser=false suppresses spawn", () => {
    let opened = false;
    const r = cloneTo({
      target: "chatgpt",
      openBrowser: false,
      spawnOverride: () => { opened = true; },
    });
    expect(opened).toBe(false);
    expect(r.browserOpen).toBeUndefined();
  });

  it("unknown target shows menu (no browser opened)", () => {
    let opened = false;
    const r = cloneTo({
      userText: "ส่งหน่อย", // verb but no target
      spawnOverride: () => { opened = true; },
    });
    expect(r.resolvedTarget).toBe("unknown");
    expect(r.plan.transport).toBe("menu");
    expect(opened).toBe(false);
    expect(r.userInstruction).toMatch(/where to|pick one|menu/i);
  });

  it("formatCloneToPulseLine produces compact summary", () => {
    const r = cloneTo({ userText: "clone to gemini", openBrowser: false });
    const line = formatCloneToPulseLine(r);
    expect(line).toContain("CLONE-TO");
    expect(line).toContain("gemini");
    expect(line).toContain("web-paste");
  });
});

// ============================================================
// Cross-platform browser open
// ============================================================

describe("v1.97 CLONE-TO · openInBrowser", () => {
  it("Windows → cmd /c start", () => {
    let called: { cmd: string; args: string[] } | null = null;
    openInBrowser("https://example.com", { spawnOverride: (cmd, args) => { called = { cmd, args }; } });
    expect(called).toBeTruthy();
    if (process.platform === "win32") expect(called!.cmd).toBe("cmd");
  });

  it("returns opened=true on success path", () => {
    const r = openInBrowser("https://example.com", { spawnOverride: () => undefined });
    expect(r.opened).toBe(true);
    expect(r.command.length).toBeGreaterThan(0);
  });
});

// ============================================================
// BUG-TRUTH (honest postmortem must ship in code)
// ============================================================

describe("v1.97 BUG-TRUTH · honest deprecation record", () => {
  it("lists at least 3 deprecated relay paths with reason + replacement", () => {
    expect(DEPRECATED_RELAY_PATHS.length).toBeGreaterThanOrEqual(3);
    for (const w of DEPRECATED_RELAY_PATHS) {
      expect(w.module).toBeTruthy();
      expect(w.reason.length).toBeGreaterThan(20);
      expect(w.replacement.length).toBeGreaterThan(10);
    }
  });

  it("explicitly names the AES/PBKDF2 + URL fetch failures", () => {
    const all = DEPRECATED_RELAY_PATHS.map((w) => w.reason).join(" ");
    expect(all).toMatch(/AES|PBKDF2|crypto/i);
    expect(all).toMatch(/fetch|web/i);
    expect(all).toMatch(/deep.link|prefill|\?q=/i);
  });

  it("formatBugTruth produces a multi-line human-readable report", () => {
    const s = formatBugTruth();
    expect(s).toContain("🔴");
    expect(s).toContain("why:");
    expect(s).toContain("use:");
  });
});

// ============================================================
// Full list of phrases that MUST work — regression suite
// ============================================================

describe("v1.97 CLONE-TO · regression suite of 'phrases that must work'", () => {
  // Each entry: { phrase, expectedTarget }
  const cases: Array<{ phrase: string; expected: CloneTarget }> = [
    { phrase: "ย้าย mneme ไปใส่ใน mobile หน่อย", expected: "mobile" },
    { phrase: "ส่งความจำของ mneme ไปใน gemini", expected: "gemini" },
    { phrase: "ส่งสมองไปมือถือ", expected: "mobile" },
    { phrase: "ส่งสมองไป iphone", expected: "mobile" },
    { phrase: "ส่งไป android", expected: "mobile" },
    { phrase: "clone brain to ipad", expected: "ipad" },
    { phrase: "send mneme to chat gpt", expected: "chatgpt" },
    { phrase: "sync to claude.ai", expected: "claude" },
    { phrase: "ส่ง mneme ไป copilot", expected: "copilot" },
    { phrase: "give brain to perplexity", expected: "perplexity" },
    { phrase: "ก๊อปไป tablet", expected: "ipad" },
    { phrase: "send brain to my second laptop", expected: "another-pc" },
    { phrase: "clone to localhost", expected: "this-pc" },
    { phrase: "send mneme to browser on this pc", expected: "this-pc" },
    { phrase: "pack mneme as a file", expected: "usb" },
    { phrase: "send back to my pc", expected: "return" },
    { phrase: "Mneme ส่งไป google ai หน่อย", expected: "gemini" },
    { phrase: "share mneme กับ openai", expected: "chatgpt" },
  ];

  for (const { phrase, expected } of cases) {
    it(`'${phrase}' → ${expected}`, () => {
      const r = parseCloneIntent(phrase);
      expect(r.target).toBe(expected);
      expect(r.isCloneRequest).toBe(true);
    });
  }
});
