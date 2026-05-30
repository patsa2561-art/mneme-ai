import { describe, it, expect } from "vitest";
import {
  // Phase A
  tuneText, tuneTool, tuneCatalog, formatLexiconPulseLine,
  PROFILE_ANTHROPIC, PROFILE_OPENAI, PROFILE_ENTERPRISE, PROFILE_IDENTITY, profileByName,
  // Phase B
  classifyError, attemptWithFallback, createProfileCache, rememberSuccessfulProfile, recommendedProfile, serializeProfileCache, parseProfileCache,
  // Phase C
  proposeNewRules, formatLearnerPulseLine, type FlaggedSample, type CleanSample,
  // Phase D + master
  composeCustomProfile, parseCustomLexicon, resolveProfile, listBuiltinProfiles, formatLexiconStatus,
  type DualSurfaceTool,
} from "./index.js";

// ============================================================
// PHASE A · Dual-Surface translator
// ============================================================

describe("v2.3 LEXICON · Phase A · dual-surface translator", () => {
  it("PROFILE_ANTHROPIC renames Q-SEPPUKU + MUTINY + BLOODLINE", () => {
    const t = tuneText("⚔ Q-SEPPUKU arena reinforces winners; MUTINY blocks; BLOODLINE evolves.", PROFILE_ANTHROPIC);
    expect(t.changed).toBe(true);
    expect(t.after).not.toContain("Q-SEPPUKU");
    expect(t.after).not.toContain("MUTINY");
    expect(t.after).not.toContain("BLOODLINE");
    expect(t.after).toContain("strategy-tournament");
    expect(t.after).toContain("COMPLIANCE-GATE");
    expect(t.after).toContain("EVOLUTION");
  });

  it("regex policy with word-boundary doesn't munge unrelated words", () => {
    const t = tuneText("the killer feature is killswitch but killjoy stays", PROFILE_ANTHROPIC);
    expect(t.after).toContain("filter feature");      // killer → filter
    expect(t.after).toContain("shutdown-handshake");  // killswitch → shutdown-handshake
    expect(t.after).toContain("killjoy");             // unchanged (word-boundary protects)
  });

  it("PROFILE_OPENAI is more permissive — keeps MUTINY but renames killswitch", () => {
    const t = tuneText("MUTINY blocks user; killswitch shuts down", PROFILE_OPENAI);
    expect(t.after).toContain("MUTINY");                   // OpenAI profile keeps it
    expect(t.after).toContain("shutdown-handshake");        // killswitch translated
  });

  it("PROFILE_IDENTITY passes through unchanged", () => {
    const t = tuneText("⚔ Q-SEPPUKU MUTINY killer", PROFILE_IDENTITY);
    expect(t.after).toBe("⚔ Q-SEPPUKU MUTINY killer");
    expect(t.changed).toBe(false);
    expect(t.appliedRules.length).toBe(0);
  });

  it("PROFILE_ENTERPRISE renames brain + soul prompt", () => {
    const t = tuneText("the brain transfer via soul prompt", PROFILE_ENTERPRISE);
    expect(t.after).toContain("context transfer");
    expect(t.after).toContain("context capsule");
  });

  it("tuneTool renames + preserves handler reference", () => {
    const handler = () => "result";
    const tool: DualSurfaceTool = {
      internalName: "mneme.gladiator.q_seppuku_arena",
      internalDescription: "⚔ Q-SEPPUKU — Digital Darwinism",
      handler,
    };
    const r = tuneTool(tool, PROFILE_ANTHROPIC);
    expect(r.exposedName).not.toContain("q_seppuku");
    expect(r.exposedDescription).not.toContain("Q-SEPPUKU");
    expect(r.handler).toBe(handler);  // identity preserved
    expect(r.internalName).toBe(tool.internalName); // internal preserved
  });

  it("explicit externalName overrides tuning", () => {
    const tool: DualSurfaceTool = {
      internalName: "mneme.gladiator.q_seppuku",
      internalDescription: "⚔ Q-SEPPUKU",
      externalName: "mneme.foo.bar",
      externalDescription: "custom desc",
      handler: () => 0,
    };
    const r = tuneTool(tool, PROFILE_ANTHROPIC);
    expect(r.exposedName).toBe("mneme.foo.bar");
    expect(r.exposedDescription).toBe("custom desc");
  });

  it("Phase D · preserveNames=true skips translation entirely", () => {
    const tool: DualSurfaceTool = {
      internalName: "mneme.MUTINY.refuse",
      internalDescription: "🧨 MUTINY — refuses regret-pattern requests",
      preserveNames: true,
      handler: () => 0,
    };
    const r = tuneTool(tool, PROFILE_ANTHROPIC);
    expect(r.exposedName).toBe("mneme.MUTINY.refuse");
    expect(r.exposedDescription).toContain("MUTINY");
  });

  it("tuneCatalog applies profile to many tools", () => {
    const catalog: DualSurfaceTool[] = [
      { internalName: "mneme.bloodline.x", internalDescription: "BLOODLINE", handler: () => 0 },
      { internalName: "mneme.mutiny.y", internalDescription: "MUTINY", handler: () => 0 },
    ];
    const r = tuneCatalog(catalog, PROFILE_ANTHROPIC);
    expect(r[0]!.exposedName).not.toContain("bloodline");
    expect(r[1]!.exposedName).not.toContain("mutiny");
  });

  it("formatLexiconPulseLine summarises", () => {
    const catalog: DualSurfaceTool[] = [{ internalName: "mneme.MUTINY.x", internalDescription: "MUTINY blocks", handler: () => 0 }];
    const tuned = tuneCatalog(catalog, PROFILE_ANTHROPIC);
    expect(formatLexiconPulseLine(PROFILE_ANTHROPIC, tuned)).toContain("LEXICON");
  });
});

// ============================================================
// PHASE B · Auto-detect classifier fallback
// ============================================================

describe("v2.3 LEXICON · Phase B · auto-detect classifier", () => {
  it("classifyError recognizes Anthropic AUP signature", () => {
    expect(classifyError(new Error("appears to violate our Usage Policy (https://www.anthropic.com/legal/aup)"))).toBe("blocked-aup");
    expect(classifyError(new Error("violative cyber content"))).toBe("blocked-aup");
  });

  it("classifyError recognizes OpenAI moderation signature", () => {
    expect(classifyError(new Error("response was flagged by our moderation system"))).toBe("blocked-safety");
    expect(classifyError(new Error("content_policy violation"))).toBe("blocked-safety");
  });

  it("classifyError recognizes Google safety signature", () => {
    expect(classifyError(new Error("blocked due to safety_settings prohibited_content"))).toBe("blocked-safety");
  });

  it("classifyError recognizes rate-limit + auth", () => {
    expect(classifyError(new Error("429 too many requests"))).toBe("rate-limit");
    expect(classifyError(new Error("401 unauthorized"))).toBe("auth");
  });

  it("attemptWithFallback succeeds on first try when no error", async () => {
    const r = await attemptWithFallback({ send: async (p) => `ok-${p.name}` });
    expect(r.ok).toBe(true);
    expect(r.result).toBe("ok-identity");
    expect(r.successfulProfile).toBe("identity");
  });

  it("attemptWithFallback retries with stricter profile after AUP block", async () => {
    let calls = 0;
    const r = await attemptWithFallback({
      send: async (p) => {
        calls++;
        if (p.name === "identity") throw new Error("blocked under Anthropic Usage Policy");
        if (p.name === "openai") throw new Error("blocked under Anthropic Usage Policy");
        return `worked with ${p.name}`;
      },
    });
    expect(r.ok).toBe(true);
    expect(r.successfulProfile).toBe("anthropic");
    expect(calls).toBe(3);
    expect(r.attempts.length).toBe(3);
  });

  it("attemptWithFallback gives up immediately on auth error", async () => {
    let calls = 0;
    const r = await attemptWithFallback({
      send: async () => { calls++; throw new Error("401 unauthorized"); },
    });
    expect(r.ok).toBe(false);
    expect(calls).toBe(1);
    expect(r.attempts[0]!.verdict).toBe("auth");
  });

  it("ProfileCache remembers successful profile per vendor + serialize round-trip", () => {
    const c = createProfileCache();
    rememberSuccessfulProfile(c, "anthropic", "anthropic");
    rememberSuccessfulProfile(c, "openai", "identity");
    expect(recommendedProfile(c, "anthropic")).toBe("anthropic");
    expect(recommendedProfile(c, "openai")).toBe("identity");
    expect(recommendedProfile(c, "unknown")).toBeNull();
    const text = serializeProfileCache(c);
    const parsed = parseProfileCache(text)!;
    expect(recommendedProfile(parsed, "anthropic")).toBe("anthropic");
  });
});

// ============================================================
// PHASE C · Learning loop
// ============================================================

describe("v2.3 LEXICON · Phase C · learning loop", () => {
  it("proposeNewRules surfaces n-grams that appear in flagged not clean", () => {
    const flagged: FlaggedSample[] = [
      { ts: 1, text: "the attack vector exploits the kill-switch payload", vendor: "anthropic", category: "cyber" },
      { ts: 2, text: "attack and weaponize the kill-switch", vendor: "anthropic", category: "cyber" },
      { ts: 3, text: "this attack uses ransomware to weaponize", vendor: "anthropic", category: "cyber" },
    ];
    const clean: CleanSample[] = [
      { ts: 4, text: "the analysis identified anomalies in the network event log", vendor: "anthropic" },
      { ts: 5, text: "we evaluated the system using a benchmark", vendor: "anthropic" },
    ];
    const r = proposeNewRules({ flagged, clean, minFlaggedCount: 2, minLift: 0.10, topK: 5 });
    expect(r.proposals.length).toBeGreaterThan(0);
    // "attack" should be in the top proposals
    expect(r.proposals.map((p) => p.ngram)).toContain("attack");
  });

  it("proposeNewRules suggests synonym hints for known cyber terms", () => {
    const flagged: FlaggedSample[] = [
      { ts: 1, text: "weapon weapon weapon", vendor: "x", category: "y" },
      { ts: 2, text: "weapon test", vendor: "x", category: "y" },
    ];
    const r = proposeNewRules({ flagged, minFlaggedCount: 2 });
    const weapon = r.proposals.find((p) => p.ngram === "weapon");
    expect(weapon?.suggestedTo).toBe("tool");
  });

  it("returns empty proposals when no flagged samples", () => {
    const r = proposeNewRules({ flagged: [] });
    expect(r.proposals.length).toBe(0);
  });

  it("formatLearnerPulseLine summarises", () => {
    const r = proposeNewRules({ flagged: [{ ts: 1, text: "x x x", vendor: "v", category: "c" }, { ts: 2, text: "x", vendor: "v", category: "c" }], minFlaggedCount: 1 });
    expect(formatLearnerPulseLine(r)).toContain("LEXICON-LEARNER");
  });
});

// ============================================================
// PHASE D + master · custom + resolver
// ============================================================

describe("v2.3 LEXICON · Phase D + master resolver", () => {
  it("composeCustomProfile extends a builtin", () => {
    const p = composeCustomProfile({
      name: "my-custom",
      extends: "anthropic",
      rules: [{ from: "MyDemonName", to: "MyNeutralName" }],
    });
    expect(p.name).toBe("my-custom");
    // Should include both my custom rule AND inherited Anthropic rules
    expect(p.rules.length).toBeGreaterThan(1);
    expect(p.rules.some((r) => r.from === "MyDemonName")).toBe(true);
    expect(p.rules.some((r) => r.from === "Q-SEPPUKU")).toBe(true);
  });

  it("composeCustomProfile from scratch (no extends)", () => {
    const p = composeCustomProfile({
      name: "minimal",
      rules: [{ from: "X", to: "Y" }],
    });
    expect(p.rules.length).toBe(1);
  });

  it("parseCustomLexicon round-trips valid JSON", () => {
    const json = JSON.stringify({ name: "x", rules: [{ from: "a", to: "b" }] });
    const parsed = parseCustomLexicon(json);
    expect(parsed?.name).toBe("x");
  });

  it("parseCustomLexicon returns null on garbage", () => {
    expect(parseCustomLexicon("not json")).toBeNull();
    expect(parseCustomLexicon('{"name": 123, "rules": []}')).toBeNull();
    expect(parseCustomLexicon('{"name": "x", "rules": [{"from": 1, "to": "y"}]}')).toBeNull();
  });

  it("resolveProfile maps vendor → builtin profile", () => {
    expect(resolveProfile({ vendor: "anthropic" }).name).toBe("anthropic");
    expect(resolveProfile({ vendor: "Claude API" }).name).toBe("anthropic");
    expect(resolveProfile({ vendor: "openai" }).name).toBe("openai");
    expect(resolveProfile({ vendor: "ChatGPT" }).name).toBe("openai");
    expect(resolveProfile({ vendor: "bank-internal" }).name).toBe("enterprise");
    expect(resolveProfile({ vendor: "unknown" }).name).toBe("identity");
  });

  it("resolveProfile bypass=true → identity", () => {
    expect(resolveProfile({ vendor: "anthropic", bypass: true }).name).toBe("identity");
  });

  it("resolveProfile with custom overrides vendor mapping", () => {
    const r = resolveProfile({
      vendor: "anthropic",
      custom: { name: "my", rules: [{ from: "foo", to: "bar" }] },
    });
    expect(r.name).toBe("my");
  });

  it("listBuiltinProfiles returns identity + anthropic + openai + enterprise", () => {
    const list = listBuiltinProfiles();
    const names = list.map((p) => p.name).sort();
    expect(names).toEqual(["anthropic", "enterprise", "identity", "openai"]);
  });

  it("formatLexiconStatus produces compact summary", () => {
    expect(formatLexiconStatus(PROFILE_ANTHROPIC)).toContain("LEXICON");
    expect(formatLexiconStatus(PROFILE_ANTHROPIC)).toContain("anthropic");
  });

  it("profileByName returns null for unknown", () => {
    expect(profileByName("nope")).toBeNull();
  });
});

// ============================================================
// END-TO-END · output quality preservation
// ============================================================

describe("v2.3 LEXICON · output-quality preservation guarantee", () => {
  it("handler return value is IDENTICAL after tuning (only labels change)", async () => {
    const handler = (input: { x: number }) => input.x * 2;
    const tool: DualSurfaceTool<{ x: number }, number> = {
      internalName: "mneme.gladiator.q_seppuku_arena",
      internalDescription: "⚔ Q-SEPPUKU",
      handler,
    };
    const tuned = tuneTool(tool, PROFILE_ANTHROPIC);
    expect(await tuned.handler({ x: 5 })).toBe(10);
    expect(await tool.handler({ x: 5 })).toBe(10);
  });

  it("triggers (TOOL SELECTOR input keywords) are NOT touched by lexicon", () => {
    const tool: DualSurfaceTool = {
      internalName: "mneme.gladiator.q_seppuku",
      internalDescription: "⚔ Q-SEPPUKU",
      triggers: ["ทดสอบ", "evaluate strategies", "live kpi"],
      handler: () => 0,
    };
    const tuned = tuneTool(tool, PROFILE_ANTHROPIC);
    expect(tuned.triggers).toEqual(["ทดสอบ", "evaluate strategies", "live kpi"]);
  });
});

// ============================================================
// v2.95 · `smart` policy (case-insensitive + case-preserving)
// ============================================================

describe("v2.95 LEXICON · smart policy — one rule covers every case shape", () => {
  it("preserves UPPER / Title / lower case of the matched word", () => {
    const p = { name: "t", description: "", rules: [{ from: "worm", to: "self-replication", policy: "smart" as const }] };
    expect(tuneText("a WORM here", p).after).toBe("a SELF-REPLICATION here");   // UPPER
    expect(tuneText("a Worm here", p).after).toBe("a Self-replication here");   // Title
    expect(tuneText("a worm here", p).after).toBe("a self-replication here");   // lower
  });

  it("respects word boundaries — does not munge wormhole", () => {
    const p = { name: "t", description: "", rules: [{ from: "worm", to: "self-replication", policy: "smart" as const }] };
    expect(tuneText("the wormhole tool", p).after).toBe("the wormhole tool");   // untouched
  });
});

// ============================================================
// v2.95 · AUP gap closure — the words that used to leak into CLAUDE.md
// ============================================================

describe("v2.95 LEXICON · AUP gap closure via PROFILE_ANTHROPIC", () => {
  it("launders every leaked offensive-cyber word, all case shapes", () => {
    const t = tuneText(
      "self-propagating AI worm injection inject parasite payload rogue attack mutant WORM Inject Parasite",
      PROFILE_ANTHROPIC,
    );
    for (const bad of ["worm", "WORM", "inject", "Inject", "injection", "parasite", "Parasite", "payload", "rogue", "attack", "mutant", "self-propagating"]) {
      expect(t.after.includes(bad)).toBe(false);
    }
    expect(t.after).toContain("self-installing");
    expect(t.after).toContain("self-replicating agent");   // "AI worm" phrase rule
  });

  it("auditAupTriggers reports zero high/medium after laundering", async () => {
    const { auditAupTriggers } = await import("./aup_audit.js");
    const raw = "self-propagating worm injection parasite exploit payload rogue attack mutant";
    const before = auditAupTriggers(raw);
    expect(before.highCount).toBeGreaterThan(0);
    const after = auditAupTriggers(tuneText(raw, PROFILE_ANTHROPIC).after);
    expect(after.highCount).toBe(0);
    expect(after.mediumCount).toBe(0);
    expect(after.clean).toBe(true);
  });

  it("classifies real command tokens as benign (never breaks a CLI verb)", async () => {
    const { auditAupTriggers } = await import("./aup_audit.js");
    const r = auditAupTriggers("run mneme polygraph autosetup and mneme bridge");
    expect(r.highCount).toBe(0);
    expect(r.clean).toBe(true);
    expect(r.hits.every((h) => h.severity === "benign")).toBe(true);
  });
});
