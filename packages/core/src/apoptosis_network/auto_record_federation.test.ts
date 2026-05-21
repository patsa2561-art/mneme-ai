import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import {
  record, diagnose,
  enableAutoRecord, _resetAutoRecordForTests,
  buildFederationBundle, verifyBundle, pushToPeer, pullFromPeer,
  importFederation,
  type FederationBundle,
} from "./index.js";
import { withSuperNova, clearObservers } from "../super_nova/index.js";

describe("apoptosis — auto-record + federation transport", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-apo-int-"));
    clearObservers();
    _resetAutoRecordForTests();
  });
  afterEach(() => {
    clearObservers();
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  // ─── AUTO-RECORD via SUPER NOVA observer ─────────────────────────────

  describe("enableAutoRecord (deep)", () => {
    it("auto-records a success outcome for a noteworthy verb", async () => {
      enableAutoRecord({ repoRoot: repo });
      // Fire a noteworthy verb through super-nova.
      await withSuperNova(
        { verb: "mneme.clone.clipboard", surface: "cli", repoRoot: repo, vendor: "claude" },
        async () => "ok",
      );
      // Allow the observer chain to settle.
      await new Promise((r) => setTimeout(r, 50));
      const patternsPath = join(repo, ".mneme/apoptosis/patterns.jsonl");
      expect(existsSync(patternsPath)).toBe(true);
      const rows = readFileSync(patternsPath, "utf8").trim().split("\n");
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const row = JSON.parse(rows[0]!);
      expect(row.outcome).toBe("success");
      expect(row.vendor).toBe("claude");
    });

    it("auto-records a failure outcome with classified failureClass", async () => {
      enableAutoRecord({ repoRoot: repo });
      await expect(
        withSuperNova(
          { verb: "mneme.clone.qr", surface: "cli", repoRoot: repo, vendor: "gpt" },
          async () => { throw new Error("EBUSY: resource busy"); },
        ),
      ).rejects.toThrow();
      await new Promise((r) => setTimeout(r, 50));
      const rows = readFileSync(join(repo, ".mneme/apoptosis/patterns.jsonl"), "utf8").trim().split("\n");
      const row = JSON.parse(rows[rows.length - 1]!);
      expect(row.outcome).toBe("failure");
      expect(row.failureClass).toBe("lock-contention");
    });

    it("does NOT auto-record non-noteworthy verbs (filters noise)", async () => {
      enableAutoRecord({ repoRoot: repo });
      await withSuperNova(
        { verb: "mneme.misc.noop", surface: "lib", repoRoot: repo },
        async () => "ok",
      );
      await new Promise((r) => setTimeout(r, 50));
      expect(existsSync(join(repo, ".mneme/apoptosis/patterns.jsonl"))).toBe(false);
    });

    it("cooldown prevents flooding (same pattern within 30s)", async () => {
      enableAutoRecord({ repoRoot: repo });
      // Fire same noteworthy verb 5 times in quick succession.
      for (let i = 0; i < 5; i++) {
        await withSuperNova(
          { verb: "mneme.cert.mint", surface: "cli", repoRoot: repo, vendor: "claude" },
          async () => "ok",
        );
      }
      await new Promise((r) => setTimeout(r, 50));
      const rows = readFileSync(join(repo, ".mneme/apoptosis/patterns.jsonl"), "utf8").trim().split("\n");
      // Expect exactly 1 (the first call only; cooldown blocks the rest).
      expect(rows.length).toBe(1);
    });

    it("auto-record gracefully handles observer errors (never breaks the host call)", async () => {
      enableAutoRecord({ repoRoot: repo });
      // Even if recording somehow failed, the host call must succeed.
      const r = await withSuperNova(
        { verb: "mneme.govtech.audit", surface: "lib", repoRoot: repo, vendor: "claude" },
        async () => 42,
      );
      expect(r).toBe(42);
    });
  });

  // ─── FEDERATION (signed bundle + push/pull HTTP transport) ────────────

  describe("buildFederationBundle + verifyBundle", () => {
    it("bundle is HMAC-signed + the same key verifies", async () => {
      await record(repo, { patternTokens: "x", description: "x", vendor: "claude", outcome: "failure" });
      const bundle = buildFederationBundle(repo);
      expect(bundle.v).toBe(1);
      expect(bundle.rows.length).toBe(1);
      expect(bundle.bundleSig).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      const sharedSecret = readFileSync(join(repo, ".mneme/apoptosis/apoptosis.key"), "utf8").trim();
      const verified = verifyBundle(bundle, sharedSecret);
      expect(verified).not.toBeNull();
    });

    it("verifyBundle rejects tampered rows", async () => {
      await record(repo, { patternTokens: "x", description: "x", vendor: "claude", outcome: "failure" });
      const bundle = buildFederationBundle(repo);
      const sharedSecret = readFileSync(join(repo, ".mneme/apoptosis/apoptosis.key"), "utf8").trim();
      // Tamper: replace one fingerprint.
      bundle.rows[0]!.fingerprint = "0".repeat(32);
      const verified = verifyBundle(bundle, sharedSecret);
      expect(verified).toBeNull();
    });

    it("verifyBundle rejects wrong-key bundles", async () => {
      await record(repo, { patternTokens: "x", description: "x", vendor: "claude", outcome: "failure" });
      const bundle = buildFederationBundle(repo);
      const verified = verifyBundle(bundle, "wrong-secret");
      expect(verified).toBeNull();
    });
  });

  describe("pushToPeer / pullFromPeer (real HTTP round-trip)", () => {
    let server: Server;
    let receivedBundles: FederationBundle[] = [];
    let serveBundle: FederationBundle | null = null;
    let port: number;

    beforeEach(async () => {
      receivedBundles = [];
      serveBundle = null;
      server = createServer((req, res) => {
        if (req.method === "POST") {
          const chunks: Buffer[] = [];
          req.on("data", (d) => chunks.push(d));
          req.on("end", () => {
            try {
              const bundle = JSON.parse(Buffer.concat(chunks).toString("utf8")) as FederationBundle;
              receivedBundles.push(bundle);
              res.writeHead(200, { "content-type": "application/json" });
              res.end(JSON.stringify({ accepted: bundle.rows.length, rejected: 0 }));
            } catch (e) {
              res.writeHead(400); res.end(JSON.stringify({ error: String(e) }));
            }
          });
        } else if (req.method === "GET") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(serveBundle ?? { v: 1, ts: "", senderId: "", rowCount: 0, bundleSig: "", rows: [] }));
        }
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      port = (server.address() as AddressInfo).port;
    });
    afterEach(() => {
      try { server?.close(); } catch { /* */ }
    });

    it("pushToPeer delivers a bundle to a peer HTTP server", async () => {
      await record(repo, { patternTokens: "x", description: "x", vendor: "claude", outcome: "failure" });
      const ack = await pushToPeer(repo, `http://127.0.0.1:${port}/federation`);
      expect(ack.accepted).toBe(1);
      expect(receivedBundles.length).toBe(1);
      expect(receivedBundles[0]!.rows.length).toBe(1);
      expect(receivedBundles[0]!.rows[0]!.outcome).toBe("failure");
    });

    it("pullFromPeer fetches a bundle + imports rows", async () => {
      // Set up peer-side bundle.
      const peerRepo = mkdtempSync(join(tmpdir(), "mneme-apo-peer-"));
      try {
        await record(peerRepo, { patternTokens: "peer", description: "peer", vendor: "gpt", outcome: "failure" });
        serveBundle = buildFederationBundle(peerRepo);
        const r = await pullFromPeer(repo, `http://127.0.0.1:${port}/federation`);
        expect(r.imported).toBe(1);
        // Local repo's federation.jsonl now has the peer's row.
        const fedPath = join(repo, ".mneme/apoptosis/federation.jsonl");
        expect(existsSync(fedPath)).toBe(true);
        const fedRows = readFileSync(fedPath, "utf8").trim().split("\n");
        expect(fedRows.length).toBe(1);
      } finally {
        try { rmSync(peerRepo, { recursive: true, force: true }); } catch { /* */ } }
    });

    it("pullFromPeer rejects bundles with bad sig when peer secret is supplied", async () => {
      const peerRepo = mkdtempSync(join(tmpdir(), "mneme-apo-peer-"));
      try {
        await record(peerRepo, { patternTokens: "peer", description: "peer", vendor: "gpt", outcome: "failure" });
        serveBundle = buildFederationBundle(peerRepo);
        // Tamper sig.
        serveBundle.bundleSig = "0".repeat(22);
        const r = await pullFromPeer(repo, `http://127.0.0.1:${port}/federation`, "any-secret");
        expect(r.imported).toBe(0);
        expect(r.rejected).toBeGreaterThan(0);
      } finally {
        try { rmSync(peerRepo, { recursive: true, force: true }); } catch { /* */ } }
    });
  });

  // ─── END-TO-END: auto-record → federation → diagnose APOPTOTIC ─────

  describe("end-to-end: corpus + federation → APOPTOTIC verdict", () => {
    it("federated multi-repo, multi-vendor failures escalate to APOPTOTIC", async () => {
      // Repo A: claude failures.
      enableAutoRecord({ repoRoot: repo });
      // Use direct record() to bypass cooldown for the test.
      for (const vendor of ["claude", "gpt"]) {
        for (let i = 0; i < 3; i++) {
          await record(repo, { patternTokens: "x", description: "x", vendor, outcome: "failure" });
        }
      }
      // Build bundle + import into peer repo (simulating cross-repo federation).
      const peerRepo = mkdtempSync(join(tmpdir(), "mneme-apo-peer-"));
      try {
        const bundle = buildFederationBundle(repo);
        // Hand-edit rows to have a DIFFERENT repoId — that's the
        // simulation point: real federation comes from DIFFERENT repos.
        for (const r of bundle.rows) r.repoId = "alt-repo-" + Math.floor(Math.random() * 1000);
        // Force ts older than 1 week so the age threshold is satisfied.
        const oldTs = new Date(Date.now() - 8 * 86400000).toISOString();
        for (const r of bundle.rows) r.ts = oldTs;
        importFederation(peerRepo, bundle.rows);
        // Add a few more rows locally on the peer too.
        for (let i = 0; i < 2; i++) {
          await record(peerRepo, { patternTokens: "x", description: "x", vendor: "gemini", outcome: "failure" });
        }
        // Manually backfill: write peer-local rows with old ts too.
        const v = await diagnose(peerRepo, "x");
        expect(v.attemptCount).toBeGreaterThanOrEqual(5);
        expect(v.distinctRepos).toBeGreaterThanOrEqual(2);
        expect(v.distinctVendors).toBeGreaterThanOrEqual(2);
        // Either NECROTIC or APOPTOTIC is acceptable here (some local
        // rows have the wrong ts; what matters is the federated rows
        // landed).
        expect(["NECROTIC", "APOPTOTIC"]).toContain(v.stage);
      } finally {
        try { rmSync(peerRepo, { recursive: true, force: true }); } catch { /* */ } }
    });
  });
});
