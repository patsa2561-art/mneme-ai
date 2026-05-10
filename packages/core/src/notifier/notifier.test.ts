import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAllNotifiers, notifyAll, notifierStatuses,
  agentFilesNotifier, readMnemeBlock,
  emailNotifier, mobilePushNotifier,
  experimentalIpcNotifier, experimentalKeystrokeNotifier,
  EXPERIMENTAL_IPC_ENV, EXPERIMENTAL_KEYSTROKE_ENV, EXPERIMENTAL_KEYSTROKE_ACK,
  severityAtLeast, SEVERITY_ORDER,
  type NotifyNotice,
} from "./index.js";

const NOTICE: NotifyNotice = {
  id: "test-1", severity: "info",
  title: "Test", body: "Hello, this is a test.",
};

describe("notifier registry", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-notif-"));
    mkdirSync(join(repo, ".mneme"), { recursive: true });
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("buildAllNotifiers returns 7 notifiers (path 1, 4, 5, 7, 8, 9, 10)", () => {
    const all = buildAllNotifiers(repo);
    expect(all.length).toBe(7);
    const ids = all.map((n) => n.id).sort();
    expect(ids).toContain("os-toast");
    expect(ids).toContain("tts-voice");
    expect(ids).toContain("mobile-push");
    expect(ids).toContain("email-smtp");
    expect(ids).toContain("agent-files");
    expect(ids).toContain("experimental-ipc");
    expect(ids).toContain("experimental-keystroke");
  });

  it("notifierStatuses reports availability per channel", async () => {
    const all = buildAllNotifiers(repo);
    const statuses = await notifierStatuses(all);
    expect(statuses.length).toBe(all.length);
    // agent-files is always available; experimental ones default to false.
    expect(statuses.find((s) => s.id === "agent-files")?.available).toBe(true);
    expect(statuses.find((s) => s.id === "experimental-ipc")?.available).toBe(false);
  });

  it("severityAtLeast order check", () => {
    expect(severityAtLeast("critical", "info")).toBe(true);
    expect(severityAtLeast("info", "critical")).toBe(false);
    expect(severityAtLeast("warning", "warning")).toBe(true);
    expect(SEVERITY_ORDER.info).toBeLessThan(SEVERITY_ORDER.critical);
  });

  it("notifyAll only fires available channels meeting severity threshold", async () => {
    const all = buildAllNotifiers(repo);
    // info severity: agent-files (info) fires; mobile-push (warning min) doesn't.
    const results = await notifyAll(NOTICE, all);
    const ids = results.map((r) => r.notifierId);
    expect(ids).toContain("agent-files");
    expect(ids).not.toContain("mobile-push");
  });
});

describe("agent-files notifier", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-af-"));
    mkdirSync(repo, { recursive: true });
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("writes Mneme block into all 4 target files", async () => {
    const n = agentFilesNotifier(repo);
    const r = await n.send(NOTICE);
    expect(r.ok).toBe(true);
    expect(existsSync(join(repo, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(repo, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(repo, ".cursorrules"))).toBe(true);
    expect(existsSync(join(repo, ".windsurfrules"))).toBe(true);
  });

  it("preserves existing content when updating", async () => {
    const path = join(repo, "CLAUDE.md");
    writeFileSync(path, "# Existing content\n\nDo not delete me.\n", "utf8");
    const n = agentFilesNotifier(repo);
    await n.send(NOTICE);
    const after = readFileSync(path, "utf8");
    expect(after).toContain("# Existing content");
    expect(after).toContain("Do not delete me.");
    expect(after).toContain("BEGIN MNEME PULSE");
  });

  it("readMnemeBlock returns the block we just wrote", async () => {
    const n = agentFilesNotifier(repo);
    await n.send(NOTICE);
    const block = readMnemeBlock(repo, "AGENTS.md");
    expect(block).not.toBeNull();
    expect(block!).toContain(NOTICE.title);
  });
});

describe("email notifier (file-spool fallback)", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-em-"));
    mkdirSync(join(repo, ".mneme"), { recursive: true });
  });
  afterEach(() => {
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ }
    delete process.env["MNEME_SMTP_HOST"];
  });

  it("file mode spools to .mneme/notifier/outbox/*.eml", async () => {
    const n = emailNotifier(repo, { mode: "file" });
    const r = await n.send({ ...NOTICE, severity: "warning" });
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/spool=/);
  });

  it("smtp mode without env vars returns ok=false", async () => {
    const n = emailNotifier(repo, { mode: "smtp" });
    const r = await n.send({ ...NOTICE, severity: "warning" });
    expect(r.ok).toBe(false);
  });
});

describe("mobile-push (ntfy)", () => {
  it("not available without MNEME_NTFY_TOPIC", async () => {
    delete process.env["MNEME_NTFY_TOPIC"];
    const n = mobilePushNotifier();
    expect(await n.available()).toBe(false);
  });
  it("available with MNEME_NTFY_TOPIC set", async () => {
    process.env["MNEME_NTFY_TOPIC"] = "mneme-test-secret-12345";
    const n = mobilePushNotifier();
    expect(await n.available()).toBe(true);
    delete process.env["MNEME_NTFY_TOPIC"];
  });
});

describe("experimental notifiers", () => {
  it("IPC not available without env", async () => {
    delete process.env[EXPERIMENTAL_IPC_ENV];
    expect(await experimentalIpcNotifier().available()).toBe(false);
  });
  it("keystroke needs both env + ack", async () => {
    process.env[EXPERIMENTAL_KEYSTROKE_ENV] = "1";
    delete process.env[`${EXPERIMENTAL_KEYSTROKE_ENV}_ACK`];
    expect(await experimentalKeystrokeNotifier().available()).toBe(false);
    process.env[`${EXPERIMENTAL_KEYSTROKE_ENV}_ACK`] = EXPERIMENTAL_KEYSTROKE_ACK;
    expect(await experimentalKeystrokeNotifier().available()).toBe(true);
    delete process.env[EXPERIMENTAL_KEYSTROKE_ENV];
    delete process.env[`${EXPERIMENTAL_KEYSTROKE_ENV}_ACK`];
  });
  it("keystroke notifier never silently injects (returns ok=false even when enabled)", async () => {
    process.env[EXPERIMENTAL_KEYSTROKE_ENV] = "1";
    process.env[`${EXPERIMENTAL_KEYSTROKE_ENV}_ACK`] = EXPERIMENTAL_KEYSTROKE_ACK;
    const r = await experimentalKeystrokeNotifier().send(NOTICE);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not implemented in core/);
    delete process.env[EXPERIMENTAL_KEYSTROKE_ENV];
    delete process.env[`${EXPERIMENTAL_KEYSTROKE_ENV}_ACK`];
  });
});
