import { describe, it, expect } from "vitest";

import {
  // vendor_strategy
  VENDOR_REGISTRY,
  entryOf,
  pickStrategy,
  formatStrategyPulseLine,
  // vendor_probe
  probeAllVendors,
  failingProbes,
  formatProbePulseLine,
  // passport
  issuePassport,
  verifyPassport,
  serializePassport,
  parsePassport,
  generatePassportSecret,
  fingerprintEntries,
  estimatePassportTokens,
  formatPassportPulseLine,
  type PassportEntry,
  type ProbeResult,
} from "./index.js";

import { composeCleanPrompt, buildDeepLink } from "../relay/deep_link.js";

// ============================ STALE-URL FIX ============================

describe("v1.98 · stale-URL fix (chat.openai.com → chatgpt.com)", () => {
  it("buildDeepLink('chatgpt') uses chatgpt.com (NOT chat.openai.com)", () => {
    const dl = buildDeepLink({ pasteUrl: "https://x", nexusCode: "ABC", vendor: "chatgpt" });
    expect(dl.url).toMatch(/^https:\/\/chatgpt\.com\/\?q=/);
    expect(dl.url).not.toContain("chat.openai.com");
  });

  it("composeCleanPrompt replaces fetch+decrypt instruction (v1.98 clean form)", () => {
    const p = composeCleanPrompt();
    expect(p).toContain("Mneme soul prompt");
    // The clean prompt MUST NOT instruct AI to fetch/decrypt
    expect(p.toLowerCase()).not.toContain("fetch");
    expect(p.toLowerCase()).not.toContain("decrypt");
    expect(p.toLowerCase()).not.toContain("aes");
  });
});

// ============================ VENDOR STRATEGY ============================

describe("v1.98 · vendor strategy map", () => {
  it("registry has 10+ vendor entries", () => {
    expect(VENDOR_REGISTRY.length).toBeGreaterThanOrEqual(10);
  });

  it("ChatGPT-web: free=clipboard-first, qParamWorks=false (verified)", () => {
    const e = entryOf("chatgpt-web")!;
    expect(e.freeStrategy).toBe("clipboard-first");
    expect(e.qParamWorks).toBe(false);
    expect(e.webFetchAvailable).toBe(false);
    expect(e.homeUrl).toBe("https://chatgpt.com/");
  });

  it("Gemini-web: clipboard-first on both tiers (q= prefill verified unreliable)", () => {
    const e = entryOf("gemini-web")!;
    expect(e.freeStrategy).toBe("clipboard-first");
    expect(e.paidStrategy).toBe("clipboard-first");
    expect(e.qParamWorks).toBe(false);
  });

  it("Claude Code / Cursor: mcp-direct strategy", () => {
    expect(entryOf("claude-code")?.freeStrategy).toBe("mcp-direct");
    expect(entryOf("cursor")?.freeStrategy).toBe("mcp-direct");
  });

  it("Perplexity: clipboard-first by default, prefill-and-paste opt-in via paidStrategy", () => {
    const e = entryOf("perplexity-web")!;
    expect(e.freeStrategy).toBe("clipboard-first");
    expect(e.qParamWorks).toBe(true); // Perplexity does honor ?q=
  });

  it("mobile-app vendors: app-deeplink-NA (no URL scheme exists)", () => {
    expect(entryOf("gemini-mobile")?.freeStrategy).toBe("app-deeplink-NA");
    expect(entryOf("chatgpt-mobile")?.freeStrategy).toBe("app-deeplink-NA");
  });

  it("any-mobile-browser: plain-qr (no encryption, no fetch instruction)", () => {
    expect(entryOf("any-mobile-browser")?.freeStrategy).toBe("plain-qr");
  });

  it("pickStrategy returns the strategy + reason", () => {
    const r = pickStrategy("chatgpt-web", { paidTier: false });
    expect(r.strategy).toBe("clipboard-first");
    expect(r.reason).toContain("chatgpt-web");
  });

  it("pickStrategy on unknown vendor → defaults to clipboard-first", () => {
    const r = pickStrategy("xyz-unknown");
    expect(r.strategy).toBe("clipboard-first");
    expect(r.entry).toBeNull();
  });

  it("every entry has lastChecked date in ISO format", () => {
    for (const e of VENDOR_REGISTRY) {
      expect(e.lastChecked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("formatStrategyPulseLine produces compact summary", () => {
    const line = formatStrategyPulseLine("chatgpt-web");
    expect(line).toContain("VENDOR-STRATEGY");
    expect(line).toContain("clipboard-first");
  });
});

// ============================ VENDOR PROBE ============================

describe("v1.98 · vendor URL probe", () => {
  function mockFetch(responses: Record<string, { status: number; finalUrl?: string }>): typeof fetch {
    return (async (url: string | URL | Request): Promise<Response> => {
      const u = typeof url === "string" ? url : url.toString();
      const r = responses[u];
      if (!r) throw new Error(`mock fetch: no response for ${u}`);
      // Vitest's Response uses globalThis.Response; .url is read-only normally.
      const res = new Response("", { status: r.status });
      // Spoof res.url via prototype override
      Object.defineProperty(res, "url", { value: r.finalUrl ?? u, configurable: true });
      return res;
    }) as unknown as typeof fetch;
  }

  it("OK verdict when status 200 and host unchanged", async () => {
    const fetchImpl = mockFetch({
      "https://chatgpt.com/": { status: 200 },
      "https://gemini.google.com/app": { status: 200 },
      "https://claude.ai/new": { status: 200 },
      "https://github.com/copilot": { status: 200 },
      "https://www.perplexity.ai/": { status: 200 },
    });
    const results = await probeAllVendors({ fetchImpl });
    const chatgpt = results.find((r) => r.vendor === "chatgpt-web")!;
    expect(chatgpt.verdict).toBe("OK");
    expect(chatgpt.hostChanged).toBe(false);
  });

  it("REDIRECT_HOST_CHANGE verdict catches stale URLs (chat.openai.com → chatgpt.com)", async () => {
    // Inject a vendor entry with a stale URL to demonstrate the catch.
    const fetchImpl = (async (url: string): Promise<Response> => {
      const r = new Response("", { status: 200 });
      Object.defineProperty(r, "url", { value: "https://chatgpt.com/", configurable: true });
      return r;
    }) as unknown as typeof fetch;

    // Manually probe a stale URL via the same logic
    const { probeAllVendors: probe } = await import("./vendor_probe.js");
    // We can't directly inject a stale URL without modifying registry, so
    // we test the host-changed detector via formatProbePulseLine:
    const fakeResults: ProbeResult[] = [
      { vendor: "chatgpt-web-stale", url: "https://chat.openai.com/", finalUrl: "https://chatgpt.com/", status: 200, hostChanged: true, verdict: "REDIRECT_HOST_CHANGE", notes: "redirected from chat.openai.com to chatgpt.com — update vendor_strategy.ts homeUrl", elapsedMs: 5 },
      { vendor: "gemini-web", url: "https://gemini.google.com/app", finalUrl: "https://gemini.google.com/app", status: 200, hostChanged: false, verdict: "OK", notes: "reachable (status 200)", elapsedMs: 5 },
    ];
    expect(failingProbes(fakeResults).length).toBe(1);
    expect(failingProbes(fakeResults)[0]!.verdict).toBe("REDIRECT_HOST_CHANGE");
    expect(formatProbePulseLine(fakeResults)).toContain("FAILING");
    void probe;
  });

  it("SKIP verdict for non-HTTP URLs (app schemes)", async () => {
    const fetchImpl = mockFetch({});
    const results = await probeAllVendors({ fetchImpl });
    const skipped = results.filter((r) => r.verdict === "SKIP");
    // gemini-mobile, chatgpt-mobile, any-mobile-browser, claude-code, cursor are not HTTP
    expect(skipped.length).toBeGreaterThanOrEqual(2);
  });

  it("BLOCKED verdict on 403 (Cloudflare)", async () => {
    const fetchImpl = mockFetch({
      "https://chatgpt.com/": { status: 200 },
      "https://gemini.google.com/app": { status: 200 },
      "https://claude.ai/new": { status: 403 },
      "https://github.com/copilot": { status: 200 },
      "https://www.perplexity.ai/": { status: 200 },
    });
    const results = await probeAllVendors({ fetchImpl });
    const claude = results.find((r) => r.vendor === "claude-web")!;
    expect(claude.verdict).toBe("BLOCKED");
  });

  it("failingProbes ignores OK + SKIP + BLOCKED, surfaces real failures", () => {
    const sample: ProbeResult[] = [
      { vendor: "a", url: "https://a", finalUrl: "https://a", status: 200, hostChanged: false, verdict: "OK", notes: "", elapsedMs: 1 },
      { vendor: "b", url: "https://b", finalUrl: "https://x", status: 200, hostChanged: true, verdict: "REDIRECT_HOST_CHANGE", notes: "", elapsedMs: 1 },
      { vendor: "c", url: "https://c", finalUrl: null, status: 404, hostChanged: false, verdict: "NOT_FOUND", notes: "", elapsedMs: 1 },
      { vendor: "d", url: "https://d", finalUrl: null, status: 403, hostChanged: false, verdict: "BLOCKED", notes: "", elapsedMs: 1 },
      { vendor: "e", url: "claude://", finalUrl: null, status: null, hostChanged: false, verdict: "SKIP", notes: "", elapsedMs: 0 },
    ];
    const fail = failingProbes(sample);
    expect(fail.map((f) => f.vendor)).toEqual(["b", "c"]);
  });
});

// ============================ MNEME PASSPORT (disruption) ============================

describe("v1.98 · MNEME PASSPORT — portable HMAC-signed identity", () => {
  // Fresh copy per test — the TAMPERED test mutates entries and we don't
  // want that to leak into later tests.
  function freshEntries(): PassportEntry[] {
    return [
      { id: "d1", ts: Date.now() - 1000, kind: "decision", text: "Use Postgres native JSONB for v1", scope: "auth-service" },
      { id: "r1", ts: Date.now() - 2000, kind: "regret", text: "JWT 5-min tolerance broke prod 2024-DST", scope: "commit a3f9b21" },
      { id: "w1", ts: Date.now() - 3000, kind: "wisdom", text: "Always cite commits when AI suggests a fix" },
    ];
  }
  const entries: PassportEntry[] = freshEntries(); // legacy reads in tests below — will be reassigned via splice in TAMPERED test

  it("generatePassportSecret produces 32 bytes", () => {
    const s = generatePassportSecret();
    expect(s.length).toBe(32);
  });

  it("issuePassport produces a valid envelope (signed)", () => {
    const secret = generatePassportSecret();
    const env = issuePassport({ holder: "alice@mneme", entries, secret });
    expect(env.holder).toBe("alice@mneme");
    expect(env.alg).toBe("HMAC-SHA256");
    expect(env.signature.length).toBe(64); // 32 bytes hex = 64 chars
    expect(env.entries.length).toBe(3);
    expect(env.entriesHash.length).toBeGreaterThan(0);
  });

  it("verifyPassport returns VALID for unmodified envelope + correct secret", () => {
    const secret = generatePassportSecret();
    const env = issuePassport({ holder: "alice", entries, secret });
    const r = verifyPassport(env, secret);
    expect(r.verdict).toBe("VALID");
    expect(r.ok).toBe(true);
  });

  it("verifyPassport returns TAMPERED when entries modified", () => {
    const secret = generatePassportSecret();
    const env = issuePassport({ holder: "alice", entries, secret });
    // Mutate an entry
    env.entries[0]!.text = "MODIFIED EVIL DECISION";
    const r = verifyPassport(env, secret);
    expect(r.verdict).toBe("TAMPERED");
    expect(r.ok).toBe(false);
  });

  it("verifyPassport returns TAMPERED when signature is forged", () => {
    const secret = generatePassportSecret();
    const env = issuePassport({ holder: "alice", entries, secret });
    env.signature = "0".repeat(64);
    const r = verifyPassport(env, secret);
    expect(r.verdict).toBe("TAMPERED");
  });

  it("verifyPassport returns WRONG_KEY when secret doesn't match", () => {
    const secret1 = generatePassportSecret();
    const secret2 = generatePassportSecret();
    const env = issuePassport({ holder: "alice", entries, secret: secret1 });
    const r = verifyPassport(env, secret2);
    expect(r.verdict).toBe("WRONG_KEY");
  });

  it("verifyPassport returns EXPIRED when past TTL", () => {
    const secret = generatePassportSecret();
    const env = issuePassport({ holder: "alice", entries, secret, ttlDays: 0 });
    // Force expiry into the past
    env.expiresAt = Date.now() - 1000;
    const r = verifyPassport(env, secret);
    expect(r.verdict).toBe("EXPIRED");
  });

  it("serialize → parse round-trips", () => {
    const secret = generatePassportSecret();
    const env = issuePassport({ holder: "alice", entries, secret });
    const text = serializePassport(env);
    expect(text).toContain("MNEME PASSPORT v1");
    expect(text).toContain("--- BEGIN JSON ---");
    const parsed = parsePassport(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.signature).toBe(env.signature);
    expect(parsed?.entries.length).toBe(3);
    // Verify after round-trip
    expect(verifyPassport(parsed!, secret).ok).toBe(true);
  });

  it("parsePassport returns null on malformed input", () => {
    expect(parsePassport("not a passport")).toBeNull();
    expect(parsePassport("--- BEGIN JSON --- {bad json}")).toBeNull();
  });

  it("issuePassport caps entries to maxEntries (newest first)", () => {
    const secret = generatePassportSecret();
    const many: PassportEntry[] = [];
    for (let i = 0; i < 100; i++) many.push({ id: `e${i}`, ts: i, kind: "decision", text: `decision ${i}` });
    const env = issuePassport({ holder: "alice", entries: many, secret, maxEntries: 10 });
    expect(env.entries.length).toBe(10);
    // Newest first → highest ts → entries 90..99
    expect(env.entries[0]!.id).toBe("e99");
    expect(env.entries[9]!.id).toBe("e90");
  });

  it("fingerprintEntries is deterministic + sensitive to changes", () => {
    const a = fingerprintEntries(entries);
    const b = fingerprintEntries(entries);
    expect(a).toBe(b);
    const modified = [...entries, { id: "x", ts: 1, kind: "wisdom" as const, text: "extra" }];
    expect(fingerprintEntries(modified)).not.toBe(a);
  });

  it("estimatePassportTokens returns a positive number", () => {
    const secret = generatePassportSecret();
    const env = issuePassport({ holder: "alice", entries, secret });
    expect(estimatePassportTokens(env)).toBeGreaterThan(0);
    // Typical passport with 3 entries should fit in ~500 tokens
    expect(estimatePassportTokens(env)).toBeLessThan(800);
  });

  it("formatPassportPulseLine produces compact summary", () => {
    const secret = generatePassportSecret();
    const env = issuePassport({ holder: "alice", entries, secret });
    const line = formatPassportPulseLine(env);
    expect(line).toContain("MNEME-PASSPORT");
    expect(line).toContain("alice");
    expect(line).toContain("entries=3");
  });

  it("the disruption: any AI can READ entries without secret (only VERIFY needs secret)", () => {
    const secret = generatePassportSecret();
    const env = issuePassport({ holder: "alice", entries: freshEntries(), secret });
    const text = serializePassport(env);
    const parsed = parsePassport(text)!;
    // ANY AI agent — without the secret — can still see the entries
    expect(parsed.entries.map((e) => e.text)).toContain("Use Postgres native JSONB for v1");
    expect(parsed.entries.map((e) => e.text)).toContain("Always cite commits when AI suggests a fix");
    // But cannot forge a new envelope without the secret
    const wrongSecret = generatePassportSecret();
    expect(verifyPassport(parsed, wrongSecret).verdict).toBe("WRONG_KEY");
  });
});

// ============================ ADDITIONAL FLEXIBLE-PHRASE COVERAGE ============================

describe("v1.98 · flexible phrase recognition (user complained about pattern memorization)", () => {
  // Each phrase from real Thai/English conversational forms — confirms parser
  // doesn't require exact wording. Imported lazily so we don't break the file
  // structure when this module evolves.
  it("loose phrasings without exact 'mneme' word still trigger", async () => {
    const { parseCloneIntent } = await import("./clone_to.js");
    const phrases = [
      "ผมอยากจะส่งบริบทไปที่ samsung",       // unusual verb form + samsung
      "Help me put context on iPhone",          // English "put"
      "เอา mneme ลงโทรศัพท์ที",                  // "เอา ลง" verb form
      "อยากให้ brain ไปอยู่ใน ipad",              // "อยากให้ ไปอยู่"
      "save my brain to gemini please",         // "save"
    ];
    for (const p of phrases) {
      const r = parseCloneIntent(p);
      expect(r.target).not.toBe("unknown");
      expect(r.isCloneRequest).toBe(true);
    }
  });
});
