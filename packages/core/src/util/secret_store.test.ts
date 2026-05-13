import { describe, it, expect } from "vitest";
import { mkdtempSync, statSync, readFileSync, existsSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { writeSecretFile, writeSecretJson } from "./secret_store.js";

const IS_WINDOWS = platform() === "win32";

describe("v2.4 SECRET STORE", () => {
  it("writeSecretFile writes content correctly", () => {
    const dir = mkdtempSync(join(tmpdir(), "mneme-secret-test-"));
    const target = join(dir, "secret.txt");
    writeSecretFile(target, "supersecret123");
    expect(readFileSync(target, "utf8")).toBe("supersecret123");
  });

  it("writeSecretFile lands at mode 0600 on POSIX", () => {
    if (IS_WINDOWS) return; // POSIX-only assertion
    const dir = mkdtempSync(join(tmpdir(), "mneme-secret-test-"));
    const target = join(dir, "secret.txt");
    writeSecretFile(target, "x");
    const m = statSync(target).mode & 0o777;
    expect(m).toBe(0o600);
  });

  it("writeSecretFile creates parent dir if missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "mneme-secret-test-"));
    const target = join(dir, "nested", "deeper", "secret.txt");
    writeSecretFile(target, "x");
    expect(existsSync(target)).toBe(true);
  });

  it("writeSecretFile overwrites existing file atomically", () => {
    const dir = mkdtempSync(join(tmpdir(), "mneme-secret-test-"));
    const target = join(dir, "secret.txt");
    writeSecretFile(target, "first");
    writeSecretFile(target, "second");
    expect(readFileSync(target, "utf8")).toBe("second");
  });

  it("writeSecretJson serializes and writes", () => {
    const dir = mkdtempSync(join(tmpdir(), "mneme-secret-test-"));
    const target = join(dir, "secret.json");
    writeSecretJson(target, { key: "value", n: 42 });
    const parsed = JSON.parse(readFileSync(target, "utf8"));
    expect(parsed.key).toBe("value");
    expect(parsed.n).toBe(42);
  });

  it("custom mode override is honored on POSIX", () => {
    if (IS_WINDOWS) return;
    const dir = mkdtempSync(join(tmpdir(), "mneme-secret-test-"));
    const target = join(dir, "secret.txt");
    writeSecretFile(target, "x", { modePosix: 0o400 });
    const m = statSync(target).mode & 0o777;
    expect(m).toBe(0o400);
  });
});
