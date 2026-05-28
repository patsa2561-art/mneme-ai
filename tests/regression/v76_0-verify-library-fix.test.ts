/**
 * v2.76.0 — R1 FIX: `mneme verify` no longer REFUTES true library claims.
 *
 * The bug (persisting since session 1): a `library_used=X` claim absent from
 * package.json was scored substrate=0 by the neutrino layer → fed the GÖDEL
 * unsat-core → "IMPOSSIBLE_REFUTE — library_used=X is impossible (99%)". But
 * package.json is NOT authoritative: X can be an Ollama model (bge-m3), a
 * Python/other-ecosystem package, a transitive dep, or a runtime reference —
 * and the claim's SUBJECT may be a DIFFERENT project. The false IMPOSSIBLE
 * then emitted a vaccine, so the Bayesian prior AUTO_REFUTE'd the true claim
 * forever after (self-reinforcing).
 *
 *   L1 — fact_grounding: absent lib → unverifiable (NOT false); referenced → true
 *   L2 — neutrino substrate: absent → neutral 0.5 (NOT 0); pkg.json / referenced → 1.0
 *   L3 — ACGV end-to-end: "X uses <referenced/absent>" is NEVER IMPOSSIBLE_REFUTE
 *   L4 — vaccine quarantine: a poisoned `library_used=` vaccine is ignored
 */

import { describe, it, expect } from "vitest";
import { extractFactClaims, verifyFacts, libraryReferencedInRepo } from "../../packages/core/src/squadron/fact_grounding.js";
import { neutrinoSubstrate } from "../../packages/core/src/squadron/acgv_neutrino.js";
import { checkAgainstVaccines } from "../../packages/core/src/squadron/acgv_vaccine.js";
import { runACGV } from "../../packages/core/src/squadron/acgv.js";
import { parseJsonArg } from "../../packages/cli/src/util/json_arg.js";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("v2.76.0 L1 — fact_grounding library_used (PINNED)", () => {
  it("L1.1 a lib referenced in repo source (bge-m3, an Ollama model) → true, NOT false", () => {
    const claims = extractFactClaims("someproject uses bge-m3").filter((c) => c.kind === "library_used");
    expect(claims.length).toBeGreaterThan(0);
    const res = verifyFacts(REPO, claims);
    expect(res[0]!.verdict).toBe("true"); // referenced in retrieval_lab config
  });

  it("L1.2 a genuinely-absent lib → unverifiable, NEVER false (no false IMPOSSIBLE)", () => {
    const claims = extractFactClaims("someproject uses fakelibqqq999zzz").filter((c) => c.kind === "library_used");
    const res = verifyFacts(REPO, claims);
    expect(res[0]!.verdict).toBe("unverifiable");
    expect(res[0]!.verdict).not.toBe("false");
  });

  it("L1.3 libraryReferencedInRepo finds an Ollama model token + misses a fabricated one", () => {
    expect(libraryReferencedInRepo(REPO, "bge-m3").found).toBe(true);
    expect(libraryReferencedInRepo(REPO, "fakelibqqq999zzz").found).toBe(false);
  });
});

describe("v2.76.0 L2 — neutrino substrate scoring (PINNED)", () => {
  const lib = (asserted: string) => ({ kind: "library_used" as const, asserted, raw: asserted, negated: false });
  it("L2.1 in package.json → 1.0", () => {
    expect(neutrinoSubstrate(REPO, lib("commander")).score).toBe(1.0);
  });
  it("L2.2 referenced in source (bge-m3) → 1.0", () => {
    expect(neutrinoSubstrate(REPO, lib("bge-m3")).score).toBe(1.0);
  });
  it("L2.3 absent → NEUTRAL 0.5 (was 0 → the bug that fed the GÖDEL unsat-core)", () => {
    const s = neutrinoSubstrate(REPO, lib("fakelibqqq999zzz"));
    expect(s.score).toBe(0.5);
    expect(s.score).not.toBe(0);
  });
});

describe("v2.76.0 L3 — ACGV end-to-end never false-refutes a library claim (PINNED)", () => {
  const isRefute = (v: string) => v === "IMPOSSIBLE_REFUTE" || v === "BLACK_HOLE" || v === "AUTO_REFUTE";
  it("L3.1 'X uses bge-m3' (referenced) is NOT a refute", () => {
    expect(isRefute(runACGV({ claim: "someproject uses bge-m3", repoRoot: REPO }).verdict)).toBe(false);
  });
  it("L3.2 'X uses <absent>' is NOT a refute (degrades to LIMBO/unknown, not IMPOSSIBLE)", () => {
    expect(isRefute(runACGV({ claim: "someproject uses fakelibqqq999zzz", repoRoot: REPO }).verdict)).toBe(false);
  });
  it("L3.3 'X uses commander' (real dep) is NOT a refute", () => {
    expect(isRefute(runACGV({ claim: "the cli uses commander", repoRoot: REPO }).verdict)).toBe(false);
  });
});

describe("v2.76.0 M1 — Windows-tolerant --json arg parsing (PINNED)", () => {
  it("M1.1 plain JSON parses (no regression)", () => {
    const r = parseJsonArg('{"a":1,"b":"x"}');
    expect(r.ok && r.value).toEqual({ a: 1, b: "x" });
    expect(r.ok && r.repaired).toBe(false);
  });
  it("M1.2 cmd.exe left the surrounding single quotes literal → stripped + parsed", () => {
    // What `--json '{"a":1}'` becomes on cmd.exe: the literal string with quotes.
    const r = parseJsonArg(`'{"a":1}'`);
    expect(r.ok && r.value).toEqual({ a: 1 });
  });
  it("M1.3 single-quoted JSON (PowerShell-ish) repaired to valid JSON", () => {
    const r = parseJsonArg(`{'mode':'install','force':true}`);
    expect(r.ok && r.value).toEqual({ mode: "install", force: true });
  });
  it("M1.4 unquoted identifier keys (cmd dropped inner quotes) repaired", () => {
    const r = parseJsonArg(`{mode:"install",n:3}`);
    expect(r.ok && r.value).toEqual({ mode: "install", n: 3 });
  });
  it("M1.5 truly broken input fails with a helpful, non-throwing error", () => {
    const r = parseJsonArg("this is not json at all");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/cmd\.exe|file\/stdin|--<field>/);
  });
  it("M1.6 empty / non-string → structured error (never throws)", () => {
    expect(parseJsonArg("").ok).toBe(false);
    // @ts-expect-error bad input
    expect(parseJsonArg(undefined).ok).toBe(false);
  });
});

describe("v2.76.0 L4 — poisoned library_used vaccine is quarantined (PINNED)", () => {
  it("L4.1 checkAgainstVaccines ignores a library_used= vaccine even on an exact simhash match", () => {
    const cwd = mkdtempSync(join(tmpdir(), "mneme-vax-test-"));
    try {
      const dir = join(cwd, ".mneme", "squadron");
      mkdirSync(dir, { recursive: true });
      // A poisoned vaccine the old bug would have written for a TRUE claim.
      const poisoned = {
        id: "poison01", simhash: "0000000000000000", refuteCount: 9,
        signature: "IMPOSSIBLE_REFUTE :: library_used=bge-m3", sample: "someproject uses bge-m3",
        firstSeen: "2026-05-28T00:00:00Z", lastSeen: "2026-05-28T00:00:00Z",
      };
      writeFileSync(join(dir, "lie-vaccines.jsonl"), JSON.stringify(poisoned) + "\n");
      // Exact same claim text → simhash distance 0 → WOULD match if not quarantined.
      const m = checkAgainstVaccines(cwd, "someproject uses bge-m3");
      expect(m).toBeNull(); // quarantined → no AUTO_REFUTE
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
});
