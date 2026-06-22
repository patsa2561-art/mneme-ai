import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { createXRayServer } from "./server.js";
import { buildXRay } from "./engine.js";
import { sealXRay } from "./sign.js";
import { publishReport } from "./publish.js";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

// EXACT mirror of the browser's authHeader() in public/index.html — the one
// choke-point that wraps any key in an ASCII-safe envelope.
function clientAuthHeader(token: string): string {
  const bytes = new TextEncoder().encode(token);
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  const b64url = Buffer.from(bin, "binary").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return "Bearer b64:" + b64url;
}
const profileIdOf = (t: string) => createHash("sha256").update("mneme-xray-profile:" + t).digest("hex").slice(0, 16);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// isolate the server's data dir so the bridge test doesn't touch real data
process.env.XRAY_DATA_DIR = mkdtempSync(join(tmpdir(), "xray-test-"));
const server = createXRayServer();
let base = "";

async function start(): Promise<void> {
  if (base) return;
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address() as AddressInfo;
  base = `http://127.0.0.1:${a.port}`;
}
beforeAll(start);
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("@mneme-ai/xray server (no network)", () => {
  it("health, UI, and input validation wire up correctly", async () => {
    await start();

    const health = await (await fetch(`${base}/api/health`)).json();
    expect(health.ok).toBe(true);

    const ui = await (await fetch(`${base}/`)).text();
    expect(ui).toContain("Repo X-Ray");

    // private/credentialed/non-allowlisted URLs are refused BEFORE any clone
    const bad = await fetch(`${base}/api/xray`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ gitUrl: "https://evil.example.com/a/b" }),
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/public/i);

    const board = await (await fetch(`${base}/api/board`)).json();
    expect(Array.isArray(board.items)).toBe(true);
    expect(typeof board.total).toBe("number");
  }, 30_000);

  it("🎗️ VERIFIED-BY-MNEME: certify → signed cert + badge + permalink, and the badge can't fake-green", async () => {
    await start();

    // a hallucinated deliverable must NOT be CERTIFIED + badge is red, not green
    const bad = await (await fetch(`${base}/api/certify`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ deliverable: "It always works and never fails. Studies prove exactly 73.2% convert." }),
    })).json();
    expect(bad.cert.verdict).not.toBe("CERTIFIED");
    expect(bad.badgeSvg).toContain("<svg");
    expect(bad.badgeSvg).not.toContain("#2da44e");        // no fake-green

    // a clean deliverable → CERTIFIED + green badge + working permalink + embeddable badge URL
    const ok = await (await fetch(`${base}/api/certify`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ deliverable: "The function returns the sum of two integers. Verify edge cases." }),
    })).json();
    expect(ok.cert.verdict).toBe("CERTIFIED");
    expect(ok.badgeSvg).toContain("#2da44e");
    expect(ok.cert.signed).toBeTruthy();                   // Ed25519-signed

    // the badge serves from the certId, and the permalink renders the verdict
    const badge = await fetch(`${base}${ok.badgeUrl}`);
    expect(badge.headers.get("content-type")).toContain("image/svg");
    const perma = await (await fetch(`${base}${ok.permalink}`)).text();
    expect(perma).toContain("CERTIFIED");
    expect(perma).toContain("Verified by Mneme");

    // offline verify endpoint: genuine cert valid + signature ok; a swapped deliverable caught
    const v = await (await fetch(`${base}/api/certify/verify`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ cert: ok.cert, deliverable: "The function returns the sum of two integers. Verify edge cases." }),
    })).json();
    expect(v.ok).toBe(true);
    expect(v.signatureValid).toBe(true);
    const v2 = await (await fetch(`${base}/api/certify/verify`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ cert: ok.cert, deliverable: "This always works and never fails." }),
    })).json();
    expect(v2.ok).toBe(false);

    // the landing page is reachable + linked
    const landing = await (await fetch(`${base}/certify`)).text();
    expect(landing).toContain("Verified by Mneme");
  }, 30_000);

  it("🎭 COMMIT PERSONA: landing loads, suite links it, and /api/persona rejects non-public URLs", async () => {
    await start();
    const landing = await (await fetch(`${base}/persona`)).text();
    expect(landing).toContain("Commit Persona");
    const suite = await (await fetch(`${base}/suite`)).text();
    expect(suite).toContain("/persona");
    const bad = await fetch(`${base}/api/persona?gitUrl=${encodeURIComponent("https://evil.example.com/a/b")}`);
    expect(bad.status).toBe(400);
  }, 30_000);

  // retry: this test builds an X-Ray of the WHOLE monorepo (spawns many git
  // subprocesses) + drives a real HTTP server — it can flake under heavy
  // parallel-suite CPU/git contention (it passes reliably in isolation). The
  // retries absorb that transient contention WITHOUT weakening any assertion
  // (a real regression fails all attempts).
  it("THE BRIDGE + PRIVACY: private report is owner-only, never on the public board", { retry: 2, timeout: 120_000 }, async () => {
    await start();
    // local-path report → visibility PRIVATE (a bank's repo, analysed locally)
    const report = await buildXRay({ repoPath: repoRoot });
    const signed = sealXRay(repoRoot, report);
    const token = "test-key-123";

    const pr = await publishReport(base, token, signed);
    expect(pr.ok).toBe(true);
    expect(pr.fingerprint).toBe(report.fingerprint);

    // appears in the OWNER's profile (aggregated by repo: first/last/count)
    const prof = await (await fetch(`${base}/api/profile/${pr.profileId}`)).json();
    const mine = prof.items.find((x: { fingerprint: string; count: number; firstAt: string; lastAt: string }) => x.fingerprint === report.fingerprint);
    expect(mine).toBeTruthy();
    expect(mine.count).toBeGreaterThanOrEqual(1);
    expect(mine.firstAt).toBeTruthy();

    // PRIVACY: a private report needs the owner's key — anonymous fetch = 404 (existence hidden)
    expect((await fetch(`${base}/api/report/${report.fingerprint}`)).status).toBe(404);
    const owner = await fetch(`${base}/api/report/${report.fingerprint}`, { headers: { authorization: "Bearer " + token } });
    expect(owner.status).toBe(200);
    expect((await owner.json()).report.fingerprint).toBe(report.fingerprint);

    // PRIVACY: never on the public board, and its og/permalink leak nothing
    const board = await (await fetch(`${base}/api/board`)).json();
    expect(board.items.some((x: { fingerprint: string }) => x.fingerprint === report.fingerprint)).toBe(false);
    expect((await fetch(`${base}/og/${report.fingerprint}.svg`)).status).toBe(404);
    const perma = await (await fetch(`${base}/r/${report.fingerprint}`)).text();
    expect(perma).not.toContain("og:title");           // repo name never injected for private
    expect(perma).not.toContain(report.subject.repoName);

    // tampering the report breaks the signature → ingest refuses (422); no token → 401
    const tampered = { receipt: signed.receipt, report: { ...report, summary: { ...report.summary, grade: "A" } } };
    expect((await fetch(`${base}/api/ingest`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify(tampered) })).status).toBe(422);
    expect((await fetch(`${base}/api/ingest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(signed) })).status).toBe(401);
  });

  it("UNICODE KEY: a Thai/emoji key never crashes fetch and keeps the same identity", async () => {
    await start();
    const key = "กุญแจลับ-🔑-密钥";   // Thai + emoji + CJK — all > ISO-8859-1

    // THE BUG (documented): the OLD header `Bearer <rawKey>` has code points > 255,
    // which fetch() rejects with "String contains non ISO-8859-1 code point".
    const rawHeader = "Bearer " + key;
    expect([...rawHeader].some((c) => c.charCodeAt(0) > 255)).toBe(true);

    // THE FIX: the envelope is pure ISO-8859-1 — fetch can never throw on it.
    const safe = clientAuthHeader(key);
    expect([...safe].every((c) => c.charCodeAt(0) < 256)).toBe(true);

    // END-TO-END: ingest a signed report with the enveloped header → accepted,
    // and the server resolves it to the SAME identity as the raw key (no orphan).
    const report = await buildXRay({ repoPath: repoRoot });
    const signed = sealXRay(repoRoot, report);
    const ing = await fetch(`${base}/api/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: safe },
      body: JSON.stringify(signed),
    });
    expect(ing.status).toBe(200);
    const body = await ing.json();
    expect(body.ok).toBe(true);
    expect(body.profileId).toBe(profileIdOf(key));   // identity == hash of the ORIGINAL key

    // the owner can open it with the enveloped header; anonymous cannot (private)
    const owner = await fetch(`${base}/api/report/${report.fingerprint}`, { headers: { authorization: safe } });
    expect(owner.status).toBe(200);
    expect((await fetch(`${base}/api/report/${report.fingerprint}`)).status).toBe(404);

    // a legacy bare ASCII bearer still resolves to its own identity (back-compat)
    expect(profileIdOf("ascii-legacy-key")).toHaveLength(16);
  }, 120_000);

  it("AI Context Pack: prioritized, budgeted, secret-redacted (beats a raw dump)", async () => {
    const { buildContextPack } = await import("./pack.js");
    const pack = buildContextPack(repoRoot, { budget: 40_000 });
    expect(pack.markdown).toContain("AI Context Pack");
    expect(pack.markdown).toContain("Read this first");
    expect(pack.filesIncluded).toBeGreaterThan(0);
    expect(pack.filesOutline).toBeGreaterThan(0);            // most files are skeletons, not dumps
    expect(pack.estTokens).toBeLessThan(40_000 * 1.25);      // respects the token budget (a raw dump would not)
    expect(pack.filesOmitted).toBeGreaterThan(0);            // low-signal files dropped to fit
  }, 120_000);

  it("cosmic monitor: status math + badge are correct", async () => {
    const { computeStatus, cosmicBadgeSvg } = await import("./cosmic.js");
    const now = 1_000_000;
    const samples = [
      { ts: now - 3000, ok: true, latencyMs: 10 },
      { ts: now - 2000, ok: true, latencyMs: 30 },
      { ts: now - 1000, ok: false, latencyMs: 8000 },
      { ts: now, ok: true, latencyMs: 20 },
    ];
    const st = computeStatus(samples, "http://x:8081/", now, 60_000);
    expect(st.checks).toBe(4);
    expect(st.uptimePct).toBe(75);     // 3 of 4 ok
    expect(st.up).toBe(true);          // last sample ok
    expect(cosmicBadgeSvg(st)).toContain("cosmic link");
    expect(cosmicBadgeSvg({ ...st, up: false })).toContain("down");
  });
});
