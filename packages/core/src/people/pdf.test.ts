/**
 * Tests for `pdf.ts` — the puppeteer-core HTML→PDF bridge.
 *
 * The hard guarantee: even when puppeteer-core is missing, we never crash
 * with a generic ImportError — we throw a friendly `PdfDependencyMissingError`
 * with actionable install instructions.
 *
 * We deliberately do NOT test against a real Chromium in CI.  The integration
 * test for that lives in the CLI smoke step.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { htmlToPdf, PdfDependencyMissingError } from "./pdf.js";

let tmpDir: string;
let htmlPath: string;
let pdfPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mneme-pdf-test-"));
  htmlPath = join(tmpDir, "in.html");
  pdfPath = join(tmpDir, "out.pdf");
  writeFileSync(htmlPath, "<!doctype html><html><body><h1>Hello</h1></body></html>", "utf8");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("PdfDependencyMissingError", () => {
  it("is an Error subclass and carries a code", () => {
    const e = new PdfDependencyMissingError("nope");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("PdfDependencyMissingError");
    expect(e.code).toBe("PUPPETEER_MISSING");
    expect(e.message).toBe("nope");
  });

  it("accepts a custom code", () => {
    const e = new PdfDependencyMissingError("nope", "CUSTOM_CODE");
    expect(e.code).toBe("CUSTOM_CODE");
  });
});

describe("htmlToPdf — missing puppeteer fallback", () => {
  it("throws PdfDependencyMissingError when puppeteer-core is absent", async () => {
    // In our test env puppeteer-core is NOT installed (peer-optional dep).
    // The dynamic import inside loadPuppeteer should reject and we should
    // re-throw as PdfDependencyMissingError.
    let caught: unknown = null;
    try {
      await htmlToPdf(htmlPath, pdfPath);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PdfDependencyMissingError);
    const e = caught as PdfDependencyMissingError;
    expect(e.code).toBe("PUPPETEER_MISSING");
    // The message must mention how to install puppeteer-core (actionable).
    expect(e.message).toMatch(/puppeteer-core/);
    expect(e.message).toMatch(/install/i);
  });

  it("error message references the no-API-key, browser-print fallback", async () => {
    let caught: unknown = null;
    try {
      await htmlToPdf(htmlPath, pdfPath);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PdfDependencyMissingError);
    expect((caught as Error).message).toMatch(/Print|Save as PDF/i);
  });

  it("does not write a PDF when puppeteer is missing", async () => {
    try {
      await htmlToPdf(htmlPath, pdfPath);
    } catch {
      /* expected */
    }
    expect(existsSync(pdfPath)).toBe(false);
  });

  it("fails fast if the input HTML path does not exist", async () => {
    let caught: unknown = null;
    try {
      await htmlToPdf(join(tmpDir, "nope.html"), pdfPath);
    } catch (err) {
      caught = err;
    }
    // We read the HTML synchronously *before* trying to import puppeteer,
    // so the error here is the FS error (not the friendly install hint).
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/ENOENT|nope\.html/);
  });
});
