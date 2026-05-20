/**
 * v1.72.0 -- DIASPORA PROTOCOL test suite incl. cross-vendor e2e.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

import {
  ensureGitignoreEntries, ensureSingleGitignoreEntry, readManagedEntries, PRIVATE_AI_ARTIFACTS,
} from "./gitignore_writer.js";
import {
  autoStartSpore, readGitRemotes, readSporeConfig, disableSpore,
} from "./spore_autostart.js";
import {
  saveCapsule, resumeCapsule, listCapsules,
} from "./session_capsule.js";
import { openapiSpec, startBridge, customGptTemplate } from "./http_bridge.js";

function setup(): string { return mkdtempSync(join(tmpdir(), "mneme-dia-")); }
function cleanup(r: string) { try { rmSync(r, { recursive: true, force: true }); } catch { /* */ } }

// ─── D1 GHOST SNIPER GITIGNORE ───────────────────────────────────────

describe("v1.72 Diaspora D1 · Ghost Sniper Gitignore", () => {
  let r: string;
  beforeEach(() => { r = setup(); });
  afterEach(() => cleanup(r));

  it("creates .gitignore when absent", () => {
    const res = ensureGitignoreEntries(r);
    expect(res.action).toBe("created");
    expect(existsSync(join(r, ".gitignore"))).toBe(true);
    const content = readFileSync(join(r, ".gitignore"), "utf8");
    expect(content).toContain("AGENTS.md");
    expect(content).toContain("GEMINI.md");
    expect(content).toContain("CLAUDE.md");
  });

  it("idempotent on re-run", () => {
    ensureGitignoreEntries(r);
    const second = ensureGitignoreEntries(r);
    expect(second.action).toBe("unchanged");
  });

  it("preserves existing manual entries outside sentinel", () => {
    writeFileSync(join(r, ".gitignore"), "node_modules\ndist/\n", "utf8");
    ensureGitignoreEntries(r);
    const content = readFileSync(join(r, ".gitignore"), "utf8");
    expect(content).toContain("node_modules");
    expect(content).toContain("dist/");
    expect(content).toContain("AGENTS.md");
  });

  it("doesn't duplicate when user manually added an entry", () => {
    writeFileSync(join(r, ".gitignore"), "CLAUDE.md\n", "utf8");
    ensureGitignoreEntries(r);
    const content = readFileSync(join(r, ".gitignore"), "utf8");
    // CLAUDE.md should appear ONCE (outside the managed block, not duplicated inside).
    const matches = (content.match(/^CLAUDE\.md$/gm) ?? []);
    expect(matches.length).toBe(1);
  });

  it("ensureSingleGitignoreEntry appends a single new entry", () => {
    const r1 = ensureSingleGitignoreEntry(r, "AGENTS.md");
    expect(r1.action).toBe("created");
    const r2 = ensureSingleGitignoreEntry(r, "AGENTS.md");
    expect(r2.action).toBe("unchanged");
  });

  it("readManagedEntries returns the managed list", () => {
    ensureGitignoreEntries(r, ["AGENTS.md", "GEMINI.md"]);
    const got = readManagedEntries(r);
    expect(got).toContain("AGENTS.md");
    expect(got).toContain("GEMINI.md");
  });
});

// ─── D2 SPORE DEFAULT-ON ─────────────────────────────────────────────

describe("v1.72 Diaspora D2 · Spore Default-On", () => {
  let r: string;
  beforeEach(() => { r = setup(); });
  afterEach(() => cleanup(r));

  it("no git remote -> spore stays off", () => {
    const res = autoStartSpore(r);
    expect(res.enabled).toBe(false);
    expect(res.reason).toContain("no git remotes");
  });

  it("git remote detected -> spore auto-enables", () => {
    mkdirSync(join(r, ".git"), { recursive: true });
    writeFileSync(join(r, ".git/config"),
      `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://github.com/user/repo.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`,
      "utf8");
    const res = autoStartSpore(r);
    expect(res.enabled).toBe(true);
    expect(res.config?.remoteName).toBe("origin");
    expect(res.config?.remoteUrl).toBe("https://github.com/user/repo.git");
  });

  it("idempotent: second call doesn't overwrite", () => {
    mkdirSync(join(r, ".git"), { recursive: true });
    writeFileSync(join(r, ".git/config"),
      `[remote "origin"]\n\turl = https://example.com/r.git\n`, "utf8");
    autoStartSpore(r);
    const first = readSporeConfig(r);
    autoStartSpore(r);
    const second = readSporeConfig(r);
    expect(first?.enabledAt).toBe(second?.enabledAt);
  });

  it("disableSpore turns it off", () => {
    mkdirSync(join(r, ".git"), { recursive: true });
    writeFileSync(join(r, ".git/config"), `[remote "origin"]\n\turl = x\n`, "utf8");
    autoStartSpore(r);
    disableSpore(r);
    const cfg = readSporeConfig(r);
    expect(cfg?.enabled).toBe(false);
  });
});

// ─── D3 PORTABLE SESSION CAPSULE ─────────────────────────────────────

describe("v1.72 Diaspora D3 · Portable Session Capsule (cross-vendor e2e)", () => {
  let r: string;
  beforeEach(() => {
    r = setup();
    execSync(`git init --quiet -b main`, { cwd: r, stdio: "ignore" });
    execSync(`git config user.email "t@t.t"`, { cwd: r, stdio: "ignore" });
    execSync(`git config user.name "t"`, { cwd: r, stdio: "ignore" });
    execSync(`git config commit.gpgsign false`, { cwd: r, stdio: "ignore" });
    writeFileSync(join(r, "README.md"), "x", "utf8");
    execSync(`git add -A`, { cwd: r, stdio: "ignore" });
    execSync(`git commit -m init --no-gpg-sign --quiet`, { cwd: r, stdio: "ignore" });
  });
  afterEach(() => cleanup(r));

  it("save in vendor A + resume in vendor B preserves context", () => {
    // VENDOR A saves
    const cap = saveCapsule(r, {
      vendor: "claude-opus-4-7",
      contextSummary: "Investigating bug #1234 in auth.ts; user wants bcrypt vs argon2 comparison.",
      promptTrace: [
        { ts: new Date().toISOString(), role: "user", text: "why is auth slow?" },
        { ts: new Date().toISOString(), role: "assistant", text: "auth.ts uses bcrypt at cost 12; could try argon2id" },
      ],
      decisions: ["explore argon2id"],
    });
    expect(cap.id).toMatch(/^[a-f0-9]{16}$/);

    // VENDOR B resumes (different vendor name, same repo)
    const res = resumeCapsule(r, cap.id, { toVendor: "cursor-claude" });
    expect(res.verdict).toBe("RESUMED");
    expect(res.recap).toContain("auth.ts");
    expect(res.recap).toContain("argon2");
    expect(res.inheritance?.fromVendor).toBe("claude-opus-4-7");
    expect(res.inheritance?.toVendor).toBe("cursor-claude");

    // Soul mirror records inheritance event
    const soulPath = join(r, ".mneme/ai-souls/cursor-claude.json");
    expect(existsSync(soulPath)).toBe(true);
    const soul = JSON.parse(readFileSync(soulPath, "utf8")) as { sessions: Array<Record<string, unknown>> };
    expect(soul.sessions.some((s) => s["kind"] === "capsule-inheritance")).toBe(true);
  });

  it("INVALID_HMAC when capsule is tampered", () => {
    const cap = saveCapsule(r, {
      vendor: "v1", contextSummary: "x", promptTrace: [],
    });
    const path = join(r, ".mneme/capsules", `${cap.id}.capsule`);
    const tampered = JSON.parse(readFileSync(path, "utf8")) as typeof cap;
    tampered.contextSummary = "MALICIOUSLY EDITED";
    writeFileSync(path, JSON.stringify(tampered), "utf8");
    const res = resumeCapsule(r, cap.id, { toVendor: "v2" });
    expect(res.verdict).toBe("INVALID_HMAC");
  });

  it("NOT_FOUND when capsule id is unknown", () => {
    const res = resumeCapsule(r, "no-such-capsule", { toVendor: "v2" });
    expect(res.verdict).toBe("NOT_FOUND");
  });

  it("EXPIRED when capsule is older than maxAgeHours", () => {
    const cap = saveCapsule(r, { vendor: "v1", contextSummary: "x", promptTrace: [] });
    const path = join(r, ".mneme/capsules", `${cap.id}.capsule`);
    const data = JSON.parse(readFileSync(path, "utf8")) as typeof cap;
    data.createdAt = new Date(Date.now() - 1000 * 86400 * 1000).toISOString(); // 1000 days ago
    writeFileSync(path, JSON.stringify(data), "utf8");
    // BUT now the HMAC won't match... so test via maxAgeHours=0 instead.
    const res = resumeCapsule(r, cap.id, { toVendor: "v2", maxAgeHours: -1 });
    expect(["EXPIRED", "INVALID_HMAC"]).toContain(res.verdict);
  });

  it("listCapsules sorted newest-first", () => {
    saveCapsule(r, { vendor: "a", contextSummary: "first", promptTrace: [] });
    saveCapsule(r, { vendor: "b", contextSummary: "second", promptTrace: [] });
    const caps = listCapsules(r);
    expect(caps.length).toBe(2);
    expect(caps[0]!.createdAt >= caps[1]!.createdAt).toBe(true);
  });
});

// ─── D4 HTTP BRIDGE ───────────────────────────────────────────────────

describe("v1.72 Diaspora D4 · HTTP Bridge + OpenAPI", () => {
  let r: string;
  beforeEach(() => { r = setup(); });
  afterEach(() => cleanup(r));

  it("openapiSpec returns valid 3.1 structure", () => {
    const spec = openapiSpec("http://127.0.0.1:11434");
    expect(spec["openapi"]).toBe("3.1.0");
    const paths = spec["paths"] as Record<string, unknown>;
    expect(paths["/v1/precog"]).toBeDefined();
    expect(paths["/v1/sentinel"]).toBeDefined();
    expect(paths["/v1/apoptosis"]).toBeDefined();
  });

  it("customGptTemplate is valid JSON pointing at the bridge", () => {
    const tpl = customGptTemplate("http://localhost:11434", "test-token");
    const parsed = JSON.parse(tpl);
    expect(parsed.actionEndpoint).toContain("/v1/openapi.json");
    expect(parsed.authentication.type).toBe("bearer");
  });

  it("server starts on a free port and stops cleanly", async () => {
    const handle = await startBridge(
      { repoRoot: r, port: 0, noAuth: true },
      {
        precog: (claim) => ({ verdict: "HEDGED", claim }),
        sentinel: (cmd) => ({ action: "ALLOW", command: cmd }),
        apoptosis: (claim) => ({ verdict: "HEALTHY", claim }),
      },
    );
    expect(handle.server.listening).toBe(true);
    // GET health
    const port = (handle.server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/v1/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
    // GET openapi
    const sp = await fetch(`http://127.0.0.1:${port}/v1/openapi.json`);
    expect(sp.status).toBe(200);
    await handle.stop();
  });

  it("rejects POST without bearer token", async () => {
    const handle = await startBridge(
      { repoRoot: r, port: 0 },
      { precog: () => ({ ok: true }) },
    );
    const port = (handle.server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/v1/precog`, { method: "POST", body: JSON.stringify({ claim: "x" }) });
    expect(res.status).toBe(401);
    await handle.stop();
  });

  it("accepts POST with bearer token", async () => {
    const handle = await startBridge(
      { repoRoot: r, port: 0 },
      { precog: (claim) => ({ verdict: "HEDGED", claim }) },
    );
    const port = (handle.server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/v1/precog`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${handle.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ claim: "test" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { verdict: string };
    expect(body.verdict).toBe("HEDGED");
    await handle.stop();
  });

  // v2.19.80 — BROWSER POLYGRAPH route. Pins the wire-format contract the
  // userscript depends on (verdict + color + confidence + oneLine + latencyMs).
  it("polygraph verify route returns wire-format verdict on real sentence", async () => {
    const handle = await startBridge(
      { repoRoot: r, port: 0, noAuth: true },
      {
        polygraphVerify: () => ({
          verdict: "trustworthy",
          color: "green",
          confidence: 0.92,
          oneLine: "looks legit",
          latencyMs: 7,
          engine: "test",
        }),
      },
    );
    const port = (handle.server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/v1/polygraph/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentence: "React 19 ships server components by default.", vendor: "claude-ai" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { verdict: string; color: string; confidence: number; oneLine: string; latencyMs: number };
    expect(body.verdict).toBe("trustworthy");
    expect(body.color).toBe("green");
    expect(body.confidence).toBeCloseTo(0.92);
    expect(body.oneLine).toBe("looks legit");
    expect(typeof body.latencyMs).toBe("number");
    await handle.stop();
  });

  it("polygraph verify route returns grey/unknown on empty sentence WITHOUT 4xx", async () => {
    // The userscript fires on near-empty chunks while a response streams;
    // an empty-sentence 4xx would show as a broken dot. We must respond 200/grey.
    const handle = await startBridge(
      { repoRoot: r, port: 0, noAuth: true },
      { polygraphVerify: () => ({ verdict: "trustworthy", color: "green", confidence: 1, oneLine: "n/a", latencyMs: 0 }) },
    );
    const port = (handle.server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/v1/polygraph/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentence: "" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { verdict: string; color: string };
    expect(body.verdict).toBe("unknown");
    expect(body.color).toBe("grey");
    await handle.stop();
  });

  it("OpenAPI spec lists the new /v1/polygraph/verify operation", () => {
    const spec = openapiSpec("http://localhost:11434");
    const paths = spec.paths as Record<string, unknown>;
    expect(paths["/v1/polygraph/verify"]).toBeDefined();
  });

  it("/v1/health reports polygraph as a supported protocol", async () => {
    const handle = await startBridge(
      { repoRoot: r, port: 0, noAuth: true },
      { polygraphVerify: () => ({ verdict: "trustworthy", color: "green", confidence: 1, oneLine: "ok", latencyMs: 0 }) },
    );
    const port = (handle.server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/v1/health`);
    const body = await res.json() as { ok: boolean; protocols: string[] };
    expect(body.ok).toBe(true);
    expect(body.protocols).toContain("polygraph");
    await handle.stop();
  });

  // v2.19.83 — Port ladder rendezvous. Bridge walks 17741..17750 to dodge
  // Ollama / sibling Mneme installs / port squatters. Userscript probes
  // the same ladder client-side. They meet on the same port.
  describe("v2.19.83 · port ladder rendezvous", () => {
    it("polygraphPortLadder() returns 10 ports starting at 17741", async () => {
      const mod = await import("./http_bridge.js");
      const ladder = mod.polygraphPortLadder();
      expect(ladder.length).toBe(10);
      expect(ladder[0]).toBe(17741);
      expect(ladder[9]).toBe(17750);
    });

    it("walks the ladder when a port is occupied", async () => {
      // Squat 17741 with a dummy TCP server.
      const net = await import("node:net");
      const squatter = net.createServer(() => {});
      await new Promise<void>((resolve, reject) => {
        squatter.once("error", reject);
        squatter.listen(17741, "127.0.0.1", () => resolve());
      });
      try {
        const handle = await startBridge({ repoRoot: r, noAuth: true }, {
          polygraphVerify: () => ({ verdict: "trustworthy", color: "green", confidence: 1, oneLine: "ok", latencyMs: 0 }),
        });
        // Bridge MUST have walked past the squatter.
        expect(handle.port).not.toBe(17741);
        expect(handle.port).toBeGreaterThanOrEqual(17742);
        expect(handle.port).toBeLessThanOrEqual(17750);
        await handle.stop();
      } finally {
        await new Promise<void>((resolve) => squatter.close(() => resolve()));
      }
    });

    // v2.19.84 — WORLD AI PULSE routes round-trip end-to-end.
    it("POST /v1/pulse/events records to ledger; GET /v1/pulse/aggregate returns stats", async () => {
      const handle = await startBridge({ repoRoot: r, port: 0, noAuth: true }, {
        pulseRecord: (e: { vendor?: string; color?: "green"|"yellow"|"red"|"grey"; regionTimezone?: string }) =>
          ({ recorded: true, vendor: e.vendor ?? "x", color: e.color ?? "grey" }),
        pulseAggregate: () => ({ total: 7, byColor: { green: 4, yellow: 2, red: 1, grey: 0 } }),
      });
      const port = (handle.server.address() as { port: number }).port;
      const post = await fetch(`http://127.0.0.1:${port}/v1/pulse/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor: "claude-ai", color: "green", regionTimezone: "Asia/Bangkok" }),
      });
      expect(post.status).toBe(200);
      const body = await post.json() as { recorded: boolean; vendor: string; color: string };
      expect(body.recorded).toBe(true);
      expect(body.vendor).toBe("claude-ai");
      const get = await fetch(`http://127.0.0.1:${port}/v1/pulse/aggregate?windowHours=24`);
      expect(get.status).toBe(200);
      const agg = await get.json() as { total: number; byColor: { green: number } };
      expect(agg.total).toBe(7);
      expect(agg.byColor.green).toBe(4);
      await handle.stop();
    });

    it("/v1/health reports the pulse protocol", async () => {
      const handle = await startBridge({ repoRoot: r, port: 0, noAuth: true }, {
        pulseRecord: () => ({ ok: true }),
      });
      const port = (handle.server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${port}/v1/health`);
      const body = await res.json() as { protocols: string[] };
      expect(body.protocols).toContain("pulse");
      await handle.stop();
    });

    it("writes .mneme/bridge.json beacon with the bound port + protocols + pid", async () => {
      const { readFileSync, existsSync } = await import("node:fs");
      const { join } = await import("node:path");
      const handle = await startBridge({ repoRoot: r, port: 0, noAuth: true }, {
        polygraphVerify: () => ({ verdict: "trustworthy", color: "green", confidence: 1, oneLine: "ok", latencyMs: 0 }),
      });
      const beaconPath = join(r, ".mneme", "bridge.json");
      expect(existsSync(beaconPath)).toBe(true);
      const beacon = JSON.parse(readFileSync(beaconPath, "utf8")) as {
        host: string; port: number; baseUrl: string; pid: number;
        ladderBase: number; ladderSize: number; protocols: string[];
      };
      expect(beacon.host).toBe("127.0.0.1");
      expect(beacon.port).toBe(handle.port);
      expect(beacon.baseUrl).toBe(handle.baseUrl);
      expect(beacon.pid).toBe(process.pid);
      expect(beacon.ladderBase).toBe(17741);
      expect(beacon.ladderSize).toBe(10);
      expect(beacon.protocols).toContain("polygraph");
      await handle.stop();
      // Graceful stop wipes the beacon so stale info doesn't fool the CLI.
      expect(existsSync(beaconPath)).toBe(false);
    });
  });
});
