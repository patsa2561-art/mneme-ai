import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  init, getConfig, ping, switchStatus, shouldFire, fire,
  addBeneficiary, listBeneficiaries, removeBeneficiary, generateBeneficiaryKeypair,
  partitionAndEncrypt, decryptBundle,
  respond, renderWill, verifyChain,
  formatStatus, formatBeneficiaries,
  ALL_SLICES,
  type InheritanceBundle,
} from "./index.js";

describe("mortuary — AI inheritance protocol", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-mort-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  // ─── DEAD-MAN SWITCH ─────────────────────────────────────────────────

  describe("init + config + ping", () => {
    it("init creates a config with sensible defaults", () => {
      const cfg = init(repo, { owner: "Shinnapat" });
      expect(cfg.owner).toBe("Shinnapat");
      expect(cfg.jurisdiction).toBe("GLOBAL");
      expect(cfg.pingWindowDays).toBe(30);
      expect(cfg.graceDays).toBe(7);
      expect(cfg.reviewWindowDays).toBe(30);
    });

    it("init persists + getConfig reads back", () => {
      init(repo, { owner: "X", jurisdiction: "TH" });
      const cfg = getConfig(repo);
      expect(cfg?.jurisdiction).toBe("TH");
    });

    it("ping refuses if not initialised", () => {
      expect(() => ping(repo)).toThrow(/not initialised/);
    });

    it("ping updates lastPingAt + appends to chain", () => {
      init(repo, { owner: "X" });
      const before = getConfig(repo)!.lastPingAt;
      const future = new Date(new Date(before).getTime() + 60_000);
      const cfg = ping(repo, future);
      expect(cfg.lastPingAt).toBe(future.toISOString());
    });

    it("ping after switch fired is refused", () => {
      init(repo, { owner: "X", pingWindowDays: 1, graceDays: 0 });
      // Force fire via simulated death.
      fire(repo, { force: true, slicePayloads: { personal: "hi" } });
      expect(() => ping(repo)).toThrow(/already fired/);
    });
  });

  describe("dead-man switch logic", () => {
    it("shouldFire = false right after init", () => {
      init(repo, { owner: "X" });
      expect(shouldFire(repo)).toBe(false);
    });

    it("shouldFire = true after ping window + grace elapsed", () => {
      init(repo, { owner: "X", pingWindowDays: 1, graceDays: 1 });
      const lateDate = new Date(Date.now() + 3 * 86400000);
      expect(shouldFire(repo, lateDate)).toBe(true);
    });

    it("switchStatus reports days remaining + projected fire time", () => {
      const now = new Date("2026-05-20T00:00:00Z");
      init(repo, { owner: "X", pingWindowDays: 30, graceDays: 7 });
      // Manually set lastPingAt to `now`.
      const cfg = getConfig(repo)!;
      cfg.lastPingAt = now.toISOString();
      writeFileSync(join(repo, ".mneme/mortuary/config.json"), JSON.stringify(cfg, null, 2), "utf8");
      const s = switchStatus(repo, now);
      expect(s.daysSinceLastPing).toBeCloseTo(0, 1);
      expect(s.daysUntilFire).toBeCloseTo(37, 0);
      expect(s.willFireAt).toBe(new Date("2026-06-26T00:00:00Z").toISOString());
    });
  });

  // ─── BENEFICIARY REGISTRY + RSA HYBRID ENCRYPTION ────────────────────

  describe("beneficiary registry", () => {
    it("addBeneficiary + listBeneficiaries round-trip", () => {
      init(repo, { owner: "X" });
      const { publicKeyPem } = generateBeneficiaryKeypair();
      const b = addBeneficiary(repo, { name: "Alice", publicKeyPem, scope: ["financial", "legal"], relationship: "spouse" });
      expect(b.id).toMatch(/^bn_/);
      expect(listBeneficiaries(repo).length).toBe(1);
    });

    it("removeBeneficiary removes by id", () => {
      init(repo, { owner: "X" });
      const { publicKeyPem } = generateBeneficiaryKeypair();
      const b = addBeneficiary(repo, { name: "Bob", publicKeyPem, scope: ["everything"], relationship: "lawyer" });
      removeBeneficiary(repo, b.id);
      expect(listBeneficiaries(repo).length).toBe(0);
    });

    it("generateBeneficiaryKeypair returns PEM-formatted RSA keys", () => {
      const { publicKeyPem, privateKeyPem } = generateBeneficiaryKeypair();
      expect(publicKeyPem).toContain("BEGIN PUBLIC KEY");
      expect(privateKeyPem).toContain("BEGIN PRIVATE KEY");
    });
  });

  describe("RSA hybrid encryption end-to-end (the moat)", () => {
    it("partition + encrypt + decrypt round-trips exactly", () => {
      init(repo, { owner: "Shinnapat" });
      const { publicKeyPem, privateKeyPem } = generateBeneficiaryKeypair();
      addBeneficiary(repo, { name: "Spouse", publicKeyPem, scope: ["personal", "family"], relationship: "wife" });
      const payloads = {
        personal: "I prefer dark roast coffee + jazz",
        family: "Anniversary is May 5; daughter's name is Mali",
        financial: "401k at Vanguard account 9876", // NOT in spouse's scope
      };
      const bundles = partitionAndEncrypt(repo, { slicePayloads: payloads });
      expect(bundles.length).toBe(1);
      const dec = decryptBundle(bundles[0]!, privateKeyPem);
      expect(dec.ok).toBe(true);
      expect(dec.payload?.personal).toBe(payloads.personal);
      expect(dec.payload?.family).toBe(payloads.family);
      // Scope partitioning: spouse should NOT see financial slice.
      expect(dec.payload?.financial).toBeUndefined();
    });

    it("different beneficiaries see DIFFERENT slices", () => {
      init(repo, { owner: "X" });
      const spouse = generateBeneficiaryKeypair();
      const accountant = generateBeneficiaryKeypair();
      addBeneficiary(repo, { name: "Spouse", publicKeyPem: spouse.publicKeyPem, scope: ["personal", "family"], relationship: "wife" });
      addBeneficiary(repo, { name: "Accountant", publicKeyPem: accountant.publicKeyPem, scope: ["financial", "legal"], relationship: "accountant" });
      const payloads = {
        personal: "private", family: "family", financial: "money", legal: "contracts",
      };
      const bundles = partitionAndEncrypt(repo, { slicePayloads: payloads });
      expect(bundles.length).toBe(2);
      const bSpouse = bundles.find((b) => b.beneficiaryName === "Spouse")!;
      const bAcc = bundles.find((b) => b.beneficiaryName === "Accountant")!;

      const dSpouse = decryptBundle(bSpouse, spouse.privateKeyPem);
      const dAcc = decryptBundle(bAcc, accountant.privateKeyPem);
      expect(dSpouse.payload?.personal).toBe("private");
      expect(dSpouse.payload?.financial).toBeUndefined();
      expect(dAcc.payload?.financial).toBe("money");
      expect(dAcc.payload?.personal).toBeUndefined();
    });

    it("everything scope grants ALL slices", () => {
      init(repo, { owner: "X" });
      const heir = generateBeneficiaryKeypair();
      addBeneficiary(repo, { name: "Heir", publicKeyPem: heir.publicKeyPem, scope: ["everything"], relationship: "child" });
      const payloads = Object.fromEntries(ALL_SLICES.map((s) => [s, `${s}-content`])) as any;
      const bundles = partitionAndEncrypt(repo, { slicePayloads: payloads });
      const dec = decryptBundle(bundles[0]!, heir.privateKeyPem);
      expect(dec.ok).toBe(true);
      for (const s of ALL_SLICES) expect(dec.payload?.[s]).toBe(`${s}-content`);
    });

    it("WRONG private key fails to decrypt (security)", () => {
      init(repo, { owner: "X" });
      const right = generateBeneficiaryKeypair();
      const wrong = generateBeneficiaryKeypair();
      addBeneficiary(repo, { name: "X", publicKeyPem: right.publicKeyPem, scope: ["personal"], relationship: "y" });
      const bundles = partitionAndEncrypt(repo, { slicePayloads: { personal: "secret" } });
      const dec = decryptBundle(bundles[0]!, wrong.privateKeyPem);
      expect(dec.ok).toBe(false);
    });

    it("tampered ciphertext fails AES-GCM auth tag check", () => {
      init(repo, { owner: "X" });
      const heir = generateBeneficiaryKeypair();
      addBeneficiary(repo, { name: "X", publicKeyPem: heir.publicKeyPem, scope: ["everything"], relationship: "y" });
      const [bundle] = partitionAndEncrypt(repo, { slicePayloads: { personal: "secret" } });
      // Tamper the ciphertext.
      const tampered: InheritanceBundle = { ...bundle!, ciphertextB64: "AAAA" + bundle!.ciphertextB64.slice(4) };
      const dec = decryptBundle(tampered, heir.privateKeyPem);
      expect(dec.ok).toBe(false);
    });
  });

  // ─── FIRE + REVIEW WINDOW ────────────────────────────────────────────

  describe("fire + review window", () => {
    it("fire refuses when switch isn't due (without force)", () => {
      init(repo, { owner: "X" });
      expect(() => fire(repo, { slicePayloads: { personal: "x" } })).toThrow(/not due to fire/);
    });

    it("fire(force) generates bundles + writes them to disk", () => {
      init(repo, { owner: "X" });
      const { publicKeyPem } = generateBeneficiaryKeypair();
      addBeneficiary(repo, { name: "Heir", publicKeyPem, scope: ["everything"], relationship: "child" });
      const r = fire(repo, { force: true, slicePayloads: { personal: "x", family: "y" } });
      expect(r.bundles.length).toBe(1);
      expect(existsSync(join(repo, ".mneme/mortuary/bundles", r.bundles[0]!.beneficiaryId + ".bundle.json"))).toBe(true);
    });

    it("respond(reject) deletes the bundle file", () => {
      init(repo, { owner: "X" });
      const { publicKeyPem } = generateBeneficiaryKeypair();
      const b = addBeneficiary(repo, { name: "X", publicKeyPem, scope: ["everything"], relationship: "y" });
      fire(repo, { force: true, slicePayloads: { personal: "x" } });
      const path = join(repo, ".mneme/mortuary/bundles", b.id + ".bundle.json");
      expect(existsSync(path)).toBe(true);
      respond(repo, b.id, "reject");
      expect(existsSync(path)).toBe(false);
    });

    it("respond(accept) keeps the bundle file", () => {
      init(repo, { owner: "X" });
      const { publicKeyPem } = generateBeneficiaryKeypair();
      const b = addBeneficiary(repo, { name: "X", publicKeyPem, scope: ["everything"], relationship: "y" });
      fire(repo, { force: true, slicePayloads: { personal: "x" } });
      const path = join(repo, ".mneme/mortuary/bundles", b.id + ".bundle.json");
      respond(repo, b.id, "accept");
      expect(existsSync(path)).toBe(true);
    });

    it("respond before fire is refused", () => {
      init(repo, { owner: "X" });
      const r = respond(repo, "bn_nonexistent", "accept");
      expect(r.ok).toBe(false);
    });

    it("cannot fire twice", () => {
      init(repo, { owner: "X" });
      fire(repo, { force: true, slicePayloads: {} });
      expect(() => fire(repo, { force: true, slicePayloads: {} })).toThrow(/already fired/);
    });
  });

  // ─── JURISDICTIONAL ADAPTER ──────────────────────────────────────────

  describe("renderWill", () => {
    it("renders US template by default", () => {
      init(repo, { owner: "Shinnapat", jurisdiction: "US" });
      const { publicKeyPem } = generateBeneficiaryKeypair();
      addBeneficiary(repo, { name: "Alice", publicKeyPem, scope: ["everything"], relationship: "spouse" });
      const will = renderWill(repo);
      expect(will).toContain("LAST WILL AND TESTAMENT");
      expect(will).toContain("Shinnapat");
      expect(will).toContain("Alice");
    });

    it("Thai template renders Thai text", () => {
      init(repo, { owner: "Shinnapat", jurisdiction: "TH" });
      const { publicKeyPem } = generateBeneficiaryKeypair();
      addBeneficiary(repo, { name: "ภรรยา", publicKeyPem, scope: ["everything"], relationship: "spouse" });
      const will = renderWill(repo);
      expect(will).toContain("มรดกดิจิทัล");
      expect(will).toContain("ภรรยา");
    });

    it("JP template renders Japanese", () => {
      init(repo, { owner: "Tanaka", jurisdiction: "JP" });
      const { publicKeyPem } = generateBeneficiaryKeypair();
      addBeneficiary(repo, { name: "妻", publicKeyPem, scope: ["everything"], relationship: "spouse" });
      const will = renderWill(repo);
      expect(will).toContain("デジタル遺産");
    });
  });

  // ─── HMAC AUDIT CHAIN ────────────────────────────────────────────────

  describe("audit chain", () => {
    it("verifyChain green after init + ping + beneficiary-add", () => {
      init(repo, { owner: "X" });
      ping(repo);
      const { publicKeyPem } = generateBeneficiaryKeypair();
      addBeneficiary(repo, { name: "X", publicKeyPem, scope: ["everything"], relationship: "y" });
      const v = verifyChain(repo);
      expect(v.ok).toBe(true);
      expect(v.entries).toBeGreaterThanOrEqual(3);
    });

    it("detects tampering on the chain", () => {
      init(repo, { owner: "X" });
      ping(repo);
      // Tamper: rewrite a row in the chain.
      const path = join(repo, ".mneme/mortuary/mortuary_chain.jsonl");
      const lines = readFileSync(path, "utf8").trim().split("\n");
      const e = JSON.parse(lines[1]!);
      e.payload = { tampered: true };
      lines[1] = JSON.stringify(e);
      writeFileSync(path, lines.join("\n") + "\n", "utf8");
      const v = verifyChain(repo);
      expect(v.ok).toBe(false);
      expect(v.brokenAt).toBeDefined();
    });
  });

  // ─── FORMATTERS ──────────────────────────────────────────────────────

  describe("formatters", () => {
    it("formatStatus reports not-initialised cleanly", () => {
      const s = switchStatus(repo);
      const out = formatStatus(s);
      expect(out).toContain("not initialised");
    });

    it("formatStatus reports running state with countdown", () => {
      init(repo, { owner: "X" });
      const s = switchStatus(repo);
      const out = formatStatus(s, getConfig(repo));
      expect(out).toContain("Days until fire");
    });

    it("formatStatus reports fired state", () => {
      init(repo, { owner: "X" });
      fire(repo, { force: true, slicePayloads: {} });
      const s = switchStatus(repo);
      const out = formatStatus(s, getConfig(repo));
      expect(out).toContain("SWITCH FIRED");
    });

    it("formatBeneficiaries reports empty + populated cases", () => {
      expect(formatBeneficiaries([])).toContain("No beneficiaries");
      init(repo, { owner: "X" });
      const { publicKeyPem } = generateBeneficiaryKeypair();
      addBeneficiary(repo, { name: "X", publicKeyPem, scope: ["everything"], relationship: "y" });
      const out = formatBeneficiaries(listBeneficiaries(repo));
      expect(out).toContain("Beneficiaries");
    });
  });
});
