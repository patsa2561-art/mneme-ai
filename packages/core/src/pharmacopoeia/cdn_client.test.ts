import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";

import { PharmacopoeiaCDN, type PharmacopoeiaBundle } from "./cdn_client.js";
import { renderPharmacopoeiaBlock } from "./pulse_integration.js";

function mockBundle(version: number, secret?: Buffer): PharmacopoeiaBundle {
  const b: PharmacopoeiaBundle = {
    version,
    publishedAt: new Date().toISOString(),
    bundleId: `b-${version}-test`,
    notes: `test bundle v${version}`,
    vaccines: [{ strain: "citatio_viridis", pattern: "0x[0-9a-f]{8,}", severity: 4 }],
  };
  if (secret) {
    const { signature: _ignored, ...rest } = b;
    const canonical = JSON.stringify(rest, Object.keys(rest).sort());
    b.signature = createHmac("sha256", secret).update(canonical).digest("hex");
  }
  return b;
}

function mockFetchOnce(jsonBody: string, status = 200): void {
  global.fetch = vi.fn(async () => new Response(jsonBody, { status })) as unknown as typeof fetch;
}

describe("PharmacopoeiaCDN · status / readActive", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-pharma-")); vi.restoreAllMocks(); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("status on a fresh repo: active=null, no-refresh-yet", () => {
    const c = new PharmacopoeiaCDN({ repoRoot: repo, cdnUrl: null });
    const s = c.status();
    expect(s.active).toBeNull();
    expect(s.ageMs).toBeNull();
    expect(s.lastRefreshOutcome).toBe("no-refresh-yet");
  });

  it("readActive returns null when active.json doesn't exist", () => {
    expect(new PharmacopoeiaCDN({ repoRoot: repo, cdnUrl: null }).readActive()).toBeNull();
  });
});

describe("PharmacopoeiaCDN · refresh — happy path", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-pharma-")); vi.restoreAllMocks(); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("no CDN configured → outcome 'no-cdn', no fetch attempted", async () => {
    const c = new PharmacopoeiaCDN({ repoRoot: repo, cdnUrl: null });
    const r = await c.refresh();
    expect(r.outcome).toBe("no-cdn");
    expect(r.version).toBeNull();
    expect(r.verified).toBe(false);
  });

  it("fresh repo + valid bundle → outcome 'ok' + active.json written", async () => {
    const bundle = mockBundle(1);
    mockFetchOnce(JSON.stringify(bundle));
    const c = new PharmacopoeiaCDN({ repoRoot: repo, cdnUrl: "https://x.invalid/p.json" });
    const r = await c.refresh();
    expect(r.outcome).toBe("ok");
    expect(r.version).toBe(1);
    expect(r.verified).toBe(false);   // unsigned bundle, no secret → unverified-but-accepted
    expect(existsSync(join(repo, ".mneme/pharmacopoeia/active.json"))).toBe(true);
    const onDisk = JSON.parse(readFileSync(join(repo, ".mneme/pharmacopoeia/active.json"), "utf8"));
    expect(onDisk.version).toBe(1);
  });

  it("repeat fetch with same version → outcome 'no-update', does NOT touch active.json", async () => {
    const c = new PharmacopoeiaCDN({ repoRoot: repo, cdnUrl: "https://x.invalid/p.json" });
    mockFetchOnce(JSON.stringify(mockBundle(5)));
    await c.refresh();
    const beforeMtime = (await import("node:fs")).statSync(join(repo, ".mneme/pharmacopoeia/active.json")).mtimeMs;
    mockFetchOnce(JSON.stringify(mockBundle(5)));
    const r2 = await c.refresh();
    expect(r2.outcome).toBe("no-update");
    expect(r2.version).toBe(5);
    const afterMtime = (await import("node:fs")).statSync(join(repo, ".mneme/pharmacopoeia/active.json")).mtimeMs;
    expect(afterMtime).toBe(beforeMtime);   // unchanged file
  });

  it("downgrade attack rejected → outcome 'stale-version'", async () => {
    const c = new PharmacopoeiaCDN({ repoRoot: repo, cdnUrl: "https://x.invalid/p.json" });
    mockFetchOnce(JSON.stringify(mockBundle(10)));
    await c.refresh();
    mockFetchOnce(JSON.stringify(mockBundle(5)));   // attacker tries downgrade
    const r2 = await c.refresh();
    expect(r2.outcome).toBe("stale-version");
    expect(r2.version).toBe(10);   // STILL on 10, not 5
  });
});

describe("PharmacopoeiaCDN · refresh — failure paths", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-pharma-")); vi.restoreAllMocks(); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("HTTP 500 → outcome 'fetch-failed'", async () => {
    mockFetchOnce("internal-error", 500);
    const c = new PharmacopoeiaCDN({ repoRoot: repo, cdnUrl: "https://x.invalid/p.json" });
    const r = await c.refresh();
    expect(r.outcome).toBe("fetch-failed");
  });

  it("malformed JSON → outcome 'schema-invalid'", async () => {
    mockFetchOnce("not-json-at-all");
    const c = new PharmacopoeiaCDN({ repoRoot: repo, cdnUrl: "https://x.invalid/p.json" });
    const r = await c.refresh();
    expect(r.outcome).toBe("schema-invalid");
  });

  it("missing required field → outcome 'schema-invalid'", async () => {
    mockFetchOnce(JSON.stringify({ version: 1, vaccines: [] }));   // missing publishedAt + bundleId
    const c = new PharmacopoeiaCDN({ repoRoot: repo, cdnUrl: "https://x.invalid/p.json" });
    const r = await c.refresh();
    expect(r.outcome).toBe("schema-invalid");
  });

  it("vaccine entry missing strain → outcome 'schema-invalid'", async () => {
    const bad = mockBundle(1);
    bad.vaccines.push({ pattern: "x" } as any);
    mockFetchOnce(JSON.stringify(bad));
    const c = new PharmacopoeiaCDN({ repoRoot: repo, cdnUrl: "https://x.invalid/p.json" });
    const r = await c.refresh();
    expect(r.outcome).toBe("schema-invalid");
  });

  it("signed bundle + tampered signature + secret on disk → 'verify-failed'", async () => {
    const secret = randomBytes(32);
    mkdirSync(join(repo, ".mneme"), { recursive: true });
    writeFileSync(join(repo, ".mneme/pharmacopoeia-cdn-secret.bin"), secret);
    const bundle = mockBundle(1, secret);
    bundle.signature = "deadbeef".repeat(8);   // tamper
    mockFetchOnce(JSON.stringify(bundle));
    const c = new PharmacopoeiaCDN({ repoRoot: repo, cdnUrl: "https://x.invalid/p.json" });
    const r = await c.refresh();
    expect(r.outcome).toBe("verify-failed");
    expect(existsSync(join(repo, ".mneme/pharmacopoeia/active.json"))).toBe(false);   // never wrote
  });

  it("signed bundle + correct signature + secret → 'ok' + verified=true", async () => {
    const secret = randomBytes(32);
    mkdirSync(join(repo, ".mneme"), { recursive: true });
    writeFileSync(join(repo, ".mneme/pharmacopoeia-cdn-secret.bin"), secret);
    const bundle = mockBundle(1, secret);
    mockFetchOnce(JSON.stringify(bundle));
    const c = new PharmacopoeiaCDN({ repoRoot: repo, cdnUrl: "https://x.invalid/p.json" });
    const r = await c.refresh();
    expect(r.outcome).toBe("ok");
    expect(r.verified).toBe(true);
  });
});

describe("PharmacopoeiaCDN · pulse integration", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-pharma-")); vi.restoreAllMocks(); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("renders empty string when no active bundle", () => {
    expect(renderPharmacopoeiaBlock(repo)).toBe("");
  });

  it("renders [PHARMACOPOEIA] v<n> active line when bundle present", async () => {
    mockFetchOnce(JSON.stringify(mockBundle(42)));
    await new PharmacopoeiaCDN({ repoRoot: repo, cdnUrl: "https://x.invalid/p.json" }).refresh();
    const line = renderPharmacopoeiaBlock(repo);
    expect(line).toContain("[PHARMACOPOEIA]");
    expect(line).toContain("v42");
    expect(line).toContain("active");
  });
});
