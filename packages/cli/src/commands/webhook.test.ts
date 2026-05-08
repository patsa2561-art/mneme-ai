/**
 * webhook — unit tests covering signing, storage, and command lifecycle.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { webhookCommand, signPayload, verifyPayload, ALL_WEBHOOK_EVENTS, fireWebhooks, _readWebhooksForTests } from "./webhook.js";

let tmp: string;
let chunks: string[];
let origWrite: typeof process.stdout.write;
let origFetch: typeof fetch;

function captureStdout() {
  chunks = [];
  origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((s: string | Uint8Array) => {
    chunks.push(typeof s === "string" ? s : Buffer.from(s).toString());
    return true;
  }) as typeof process.stdout.write;
}

function releaseStdout(): string {
  process.stdout.write = origWrite;
  return chunks.join("");
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mneme-wh-"));
  execSync("git init -q", { cwd: tmp });
  execSync("git config user.email t@x", { cwd: tmp });
  execSync("git config user.name T", { cwd: tmp });
  origFetch = global.fetch;
});

afterEach(() => {
  global.fetch = origFetch;
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

describe("webhook — HMAC signing", () => {
  it("signPayload returns a 64-char hex string", () => {
    const sig = signPayload("test payload", "secret");
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
  });

  it("same payload + same secret → same signature", () => {
    expect(signPayload("hello", "key")).toBe(signPayload("hello", "key"));
  });

  it("different payload → different signature", () => {
    expect(signPayload("a", "key")).not.toBe(signPayload("b", "key"));
  });

  it("verifyPayload accepts correct signature", () => {
    const sig = signPayload("payload", "secret");
    expect(verifyPayload("payload", sig, "secret")).toBe(true);
  });

  it("verifyPayload rejects wrong signature", () => {
    expect(verifyPayload("payload", "deadbeef", "secret")).toBe(false);
  });

  it("verifyPayload rejects tampered payload", () => {
    const sig = signPayload("payload", "secret");
    expect(verifyPayload("modified", sig, "secret")).toBe(false);
  });

  it("verifyPayload uses constant-time comparison (length-mismatch returns false)", () => {
    expect(verifyPayload("payload", "short", "secret")).toBe(false);
  });
});

describe("webhook — add/list/remove lifecycle", () => {
  it("add creates a webhook entry with auto-generated id + secret", async () => {
    captureStdout();
    let code: number;
    try {
      code = await webhookCommand({
        cwd: tmp,
        action: "add",
        event: "audit.fail",
        url: "https://hooks.example.com/x",
        json: true,
      });
    } finally {
      releaseStdout();
    }
    expect(code).toBe(0);
    const json = JSON.parse(chunks.join(""));
    expect(json.added.id).toMatch(/^[a-f0-9]+$/);
    expect(json.added.secret.length).toBe(64);
    expect(json.added.event).toBe("audit.fail");
    expect(json.added.url).toBe("https://hooks.example.com/x");
    expect(json.added.enabled).toBe(true);
  });

  it("add rejects unknown event", async () => {
    captureStdout();
    const code = await webhookCommand({
      cwd: tmp,
      action: "add",
      event: "unknown.event" as never,
      url: "https://x.com",
      json: true,
    });
    releaseStdout();
    expect(code).toBe(1);
  });

  it("list returns webhooks with secret hidden", async () => {
    captureStdout();
    try {
      await webhookCommand({ cwd: tmp, action: "add", event: "audit.fail", url: "https://x.com", json: true });
    } finally {
      releaseStdout();
    }
    captureStdout();
    try {
      await webhookCommand({ cwd: tmp, action: "list", json: true });
    } finally {
      releaseStdout();
    }
    const json = JSON.parse(chunks.join(""));
    expect(json.webhooks.length).toBe(1);
    expect(json.webhooks[0].secret).toBe("<hidden>");
  });

  it("remove deletes by id", async () => {
    captureStdout();
    try {
      await webhookCommand({ cwd: tmp, action: "add", event: "audit.fail", url: "https://x.com", json: true });
    } finally {
      releaseStdout();
    }
    const all = _readWebhooksForTests(tmp);
    const id = all[0]!.id;

    captureStdout();
    let code: number;
    try {
      code = await webhookCommand({ cwd: tmp, action: "remove", id, json: true });
    } finally {
      releaseStdout();
    }
    expect(code).toBe(0);
    expect(_readWebhooksForTests(tmp).length).toBe(0);
  });

  it("remove with unknown id returns 1", async () => {
    captureStdout();
    const code = await webhookCommand({ cwd: tmp, action: "remove", id: "nope", json: true });
    releaseStdout();
    expect(code).toBe(1);
  });
});

describe("webhook — fireWebhooks signs + posts", () => {
  it("fires only enabled hooks for the matching event", async () => {
    captureStdout();
    try {
      await webhookCommand({ cwd: tmp, action: "add", event: "audit.fail", url: "https://example.com/audit", json: true });
      await webhookCommand({ cwd: tmp, action: "add", event: "court.guilty", url: "https://example.com/court", json: true });
    } finally {
      releaseStdout();
    }
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const results = await fireWebhooks(tmp, "audit.fail", { reason: "test" });
    expect(results.length).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]![0])).toBe("https://example.com/audit");
  });

  it("attaches X-Mneme-Signature header (sha256=...)", async () => {
    captureStdout();
    try {
      await webhookCommand({ cwd: tmp, action: "add", event: "audit.fail", url: "https://example.com/audit", json: true });
    } finally {
      releaseStdout();
    }
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    global.fetch = fetchSpy as unknown as typeof fetch;

    await fireWebhooks(tmp, "audit.fail", { x: 1 });
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Mneme-Signature"]).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(headers["X-Mneme-Event"]).toBe("audit.fail");
  });

  it("ALL_WEBHOOK_EVENTS contains the 5 v1.10.0 events", () => {
    expect(ALL_WEBHOOK_EVENTS).toEqual([
      "audit.fail",
      "forensics.cwe.high",
      "atrophy.spike",
      "court.guilty",
      "federation.match",
    ]);
  });
});
