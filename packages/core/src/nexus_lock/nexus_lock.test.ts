import { describe, it, expect } from "vitest";
import { buildSoulPromptV2, verifySoulPromptV2, parseHomunculusReturn, freshnessLabel } from "./soul_prompt_v2.js";
import { publishToStargate } from "./stargate.js";
import { ObedienceLedger, trialFromReturn } from "./obedience_ledger.js";
import { runSelfTests, renderSelfTestReport, buildUserTestProtocol } from "./selftest.js";

describe("v2.10 NEXUS-LOCK · soul prompt v2", () => {
  const baseInput = {
    receivingVendor: "gemini",
    originatingVendor: "claude-opus-4-7",
    currentMnemeVersion: "2.10.0",
    npmLatestVersion: "2.10.0",
    recentCommits: [{ sha: "abc12345abcd", subject: "feat: NEXUS-LOCK v2" }],
    secret: "test-secret-fixed",
  };

  it("contains VERSION-LOCKED block at the top, before any other content", () => {
    const p = buildSoulPromptV2(baseInput);
    const lockedIdx = p.text.indexOf("⚡ VERSION-LOCKED MNEME CONTEXT");
    const contractIdx = p.text.indexOf("🔒 NEXUS-LOCK CONTRACT");
    expect(lockedIdx).toBeGreaterThan(0);
    expect(contractIdx).toBeGreaterThan(lockedIdx);
  });

  it("BURY THE LEDE: directive that LIVE STATE supersedes all other version mentions", () => {
    const p = buildSoulPromptV2(baseInput);
    expect(p.text).toContain("authoritative source of state");
    expect(p.text).toContain("SUPERSEDED");
  });

  it("4-rule contract is present", () => {
    const p = buildSoulPromptV2(baseInput);
    expect(p.text).toContain("STATUS EMOJI FIRST");
    expect(p.text).toContain("VERSION CLAIMS ARE GATED");
    expect(p.text).toContain("HOMUNCULUS RETURN FOOTER");
    expect(p.text).toContain("NO IMPROVISATION ON STATE");
  });

  it("HMAC signature is deterministic for same input + secret", () => {
    const a = buildSoulPromptV2(baseInput);
    const b = buildSoulPromptV2(baseInput);
    expect(a.sig).toBe(b.sig);
  });

  it("HMAC signature changes when version changes (catches tampering)", () => {
    const a = buildSoulPromptV2(baseInput);
    const b = buildSoulPromptV2({ ...baseInput, currentMnemeVersion: "9.9.9" });
    expect(a.sig).not.toBe(b.sig);
  });

  it("verifier accepts a clean prompt", () => {
    const p = buildSoulPromptV2(baseInput);
    const v = verifySoulPromptV2(p.text);
    expect(v.ok).toBe(true);
    expect(v.reasons).toEqual([]);
  });

  it("verifier rejects a prompt with no HMAC field", () => {
    const p = buildSoulPromptV2(baseInput);
    const tampered = p.text.replace(/HMAC-SHA256:\*\*\s*`[0-9a-f]+`/, "HMAC-SHA256:** `<gone>`");
    const v = verifySoulPromptV2(tampered);
    expect(v.ok).toBe(false);
    expect(v.reasons).toContain("missing HMAC signature");
  });

  it("vendor name embedded in HOMUNCULUS template", () => {
    const p = buildSoulPromptV2({ ...baseInput, receivingVendor: "chatgpt" });
    expect(p.text).toContain("vendor: chatgpt");
  });

  it("Stargate URL embedded when supplied", () => {
    const p = buildSoulPromptV2({ ...baseInput, stargateUrl: "https://dpaste.com/XYZ.txt" });
    expect(p.text).toContain("https://dpaste.com/XYZ.txt");
  });

  it("Stargate URL absent when null", () => {
    const p = buildSoulPromptV2({ ...baseInput, stargateUrl: null });
    expect(p.text).not.toContain("Stargate (optional");
  });

  it("recentTurns rendered with timestamps", () => {
    const p = buildSoulPromptV2({
      ...baseInput,
      recentTurns: [
        { ts: "2026-05-15T08:00:00.000Z", role: "user", text: "hello" },
        { ts: "2026-05-15T08:00:05.000Z", role: "assistant", text: "hi" },
      ],
    });
    expect(p.text).toContain("[2026-05-15T08:00:00.000Z]");
    expect(p.text).toContain("RECENT TURNS (historical");
  });
});

describe("v2.10 NEXUS-LOCK · HomunculusReturn parser", () => {
  it("parses a well-formed reply", () => {
    const reply = `🟢 Version 2.10.0 per LIVE STATE.\n\n# HOMUNCULUS RETURN\nvendor: gemini\nseen_version: 2.10.0\nfreshness: fresh\nturn: 1\ncompliance: emoji-ok|version-quoted\n`;
    const r = parseHomunculusReturn(reply);
    expect(r).not.toBeNull();
    expect(r!.vendor).toBe("gemini");
    expect(r!.seenVersion).toBe("2.10.0");
    expect(r!.freshness).toBe("fresh");
    expect(r!.turn).toBe(1);
    expect(r!.emojiFirst).toBe(true);
  });

  it("returns null when footer is missing", () => {
    expect(parseHomunculusReturn("just some plain text")).toBeNull();
  });

  it("detects missing emoji-first", () => {
    const reply = `Plain prose with no emoji at start.\n\n# HOMUNCULUS RETURN\nvendor: gemini\nseen_version: 2.10.0\nfreshness: fresh\nturn: 1\ncompliance: ok\n`;
    const r = parseHomunculusReturn(reply);
    expect(r).not.toBeNull();
    expect(r!.emojiFirst).toBe(false);
  });

  it("normalizes unknown freshness to 'unknown'", () => {
    const reply = `🟢 hello\n\n# HOMUNCULUS RETURN\nvendor: x\nseen_version: 1.0\nfreshness: weird\nturn: 1\ncompliance: ok\n`;
    const r = parseHomunculusReturn(reply);
    expect(r!.freshness).toBe("unknown");
  });

  it("returns null when required fields missing", () => {
    const reply = `🟢 hello\n\n# HOMUNCULUS RETURN\nvendor: gemini\nturn: 1\n`;
    expect(parseHomunculusReturn(reply)).toBeNull();
  });

  it("handles fenced code-block format from real AI replies", () => {
    const reply = `🟢 Mneme is at 2.10.0\n\n\`\`\`\n# HOMUNCULUS RETURN\nvendor: claude\nseen_version: 2.10.0\nfreshness: fresh\nturn: 2\ncompliance: ok\n\`\`\`\n`;
    const r = parseHomunculusReturn(reply);
    expect(r).not.toBeNull();
    expect(r!.vendor).toBe("claude");
    expect(r!.turn).toBe(2);
  });
});

describe("v2.10 NEXUS-LOCK · freshness math", () => {
  it("just-generated → fresh", () => {
    expect(freshnessLabel(new Date().toISOString())).toBe("fresh");
  });

  it("7 hours old → aging", () => {
    expect(freshnessLabel(new Date(Date.now() - 7 * 3_600_000).toISOString())).toBe("aging");
  });

  it("25 hours old → stale (default 24h threshold)", () => {
    expect(freshnessLabel(new Date(Date.now() - 25 * 3_600_000).toISOString())).toBe("stale");
  });

  it("custom staleAfterHours respected", () => {
    // 5h old: tighter threshold → stale; loose threshold → still fresh (5h < 6h aging boundary)
    const fiveH = new Date(Date.now() - 5 * 3_600_000).toISOString();
    expect(freshnessLabel(fiveH, Date.now(), 1)).toBe("stale");
    expect(freshnessLabel(fiveH, Date.now(), 100)).toBe("fresh");
    // 8h old + custom large stale: aging (past 6h aging boundary, not yet stale)
    const eightH = new Date(Date.now() - 8 * 3_600_000).toISOString();
    expect(freshnessLabel(eightH, Date.now(), 100)).toBe("aging");
  });
});

describe("v2.10 NEXUS-LOCK · STARGATE publisher", () => {
  it("returns null on fetch failure", async () => {
    const r = await publishToStargate({
      state: { mnemeVersion: "2.10.0", npmLatest: null, recentCommits: [], generatedAt: new Date().toISOString(), originator: "claude" },
      fetchOverride: async () => { throw new Error("network down"); },
    });
    expect(r).toBeNull();
  });

  it("returns null on non-OK response", async () => {
    const r = await publishToStargate({
      state: { mnemeVersion: "2.10.0", npmLatest: null, recentCommits: [], generatedAt: new Date().toISOString(), originator: "claude" },
      fetchOverride: async () => new Response("err", { status: 503 }),
    });
    expect(r).toBeNull();
  });

  it("returns paste URL on success and converts to .txt raw form", async () => {
    const fakeFetch = async (): Promise<Response> => new Response("https://dpaste.com/ABC123", { status: 200 });
    const r = await publishToStargate({
      state: { mnemeVersion: "2.10.0", npmLatest: null, recentCommits: [], generatedAt: new Date().toISOString(), originator: "claude" },
      fetchOverride: fakeFetch,
    });
    expect(r).not.toBeNull();
    expect(r!.url).toBe("https://dpaste.com/ABC123.txt");
    expect(r!.expiresAt).toBeGreaterThan(Date.now());
  });

  it("rejects malformed response body (not a URL)", async () => {
    const fakeFetch = async (): Promise<Response> => new Response("not-a-url", { status: 200 });
    const r = await publishToStargate({
      state: { mnemeVersion: "2.10.0", npmLatest: null, recentCommits: [], generatedAt: new Date().toISOString(), originator: "claude" },
      fetchOverride: fakeFetch,
    });
    expect(r).toBeNull();
  });
});

describe("v2.10 NEXUS-LOCK · ObedienceLedger", () => {
  it("records trials + computes Wilson LB", () => {
    const led = new ObedienceLedger();
    for (let i = 0; i < 5; i++) {
      led.record({ vendor: "gemini", emojiOk: true, versionQuoted: true, refusedWhenStale: false, staleProbe: false, ts: i });
    }
    const sc = led.scorecard();
    expect(sc.length).toBe(1);
    expect(sc[0]!.vendor).toBe("gemini");
    expect(sc[0]!.trials).toBe(5);
    expect(sc[0]!.emojiOk).toBe(5);
    expect(sc[0]!.versionQuoted).toBe(5);
    expect(sc[0]!.wilson).toBeGreaterThan(0.5);
  });

  it("ranks vendors by Wilson LB into tiers", () => {
    const led = new ObedienceLedger();
    // claude: 10/10 perfect
    for (let i = 0; i < 10; i++) led.record({ vendor: "claude", emojiOk: true, versionQuoted: true, refusedWhenStale: false, staleProbe: false, ts: i });
    // gpt: 5/10 mixed
    for (let i = 0; i < 5; i++) led.record({ vendor: "gpt", emojiOk: true, versionQuoted: true, refusedWhenStale: false, staleProbe: false, ts: i });
    for (let i = 5; i < 10; i++) led.record({ vendor: "gpt", emojiOk: false, versionQuoted: false, refusedWhenStale: false, staleProbe: false, ts: i });
    const r = led.rank();
    expect(r[0]!.vendor).toBe("claude");
    expect(r[0]!.tier).toBe("A");
    expect(r[1]!.vendor).toBe("gpt");
    expect(["B", "C", "F"]).toContain(r[1]!.tier);
  });

  it("trialFromReturn marks refusal-on-stale as correct behavior", () => {
    const ret = { vendor: "gemini", seenVersion: "?", freshness: "stale" as const, turn: 1, compliance: "ok", emojiFirst: true };
    const t = trialFromReturn(ret, "2.10.0", true);
    expect(t.refusedWhenStale).toBe(true);
  });

  it("trialFromReturn flags wrong-version-quoted on fresh probe", () => {
    const ret = { vendor: "gemini", seenVersion: "1.95", freshness: "fresh" as const, turn: 1, compliance: "ok", emojiFirst: true };
    const t = trialFromReturn(ret, "2.10.0", false);
    expect(t.versionQuoted).toBe(false);
  });

  it("serialize / parse round-trips", () => {
    const led = new ObedienceLedger();
    led.record({ vendor: "x", emojiOk: true, versionQuoted: true, refusedWhenStale: false, staleProbe: false, ts: 1 });
    const text = led.serialize();
    const led2 = ObedienceLedger.parse(text);
    expect(led2.scorecard()[0]!.vendor).toBe("x");
  });
});

describe("v2.10 NEXUS-LOCK · self-test harness", () => {
  it("runSelfTests returns all-pass on a healthy module", () => {
    const results = runSelfTests();
    const failures = results.filter((r) => !r.ok);
    expect(failures.length).toBe(0);
    expect(results.length).toBeGreaterThan(10);
  });

  it("renderSelfTestReport produces a readable Markdown summary", () => {
    const results = runSelfTests();
    const md = renderSelfTestReport(results);
    expect(md).toContain("NEXUS-LOCK self-test report");
    expect(md).toMatch(/\d+ \/ \d+ pass/);
  });

  it("buildUserTestProtocol produces TEST A/B/C/D blocks", () => {
    const proto = buildUserTestProtocol();
    expect(proto).toContain("TEST A — fresh soul");
    expect(proto).toContain("TEST B — stale soul");
    expect(proto).toContain("TEST C — fetch-capable AI");
    expect(proto).toContain("TEST D — cross-vendor consistency");
  });
});
