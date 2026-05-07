/**
 * HTML → PDF rendering for `mneme passport` and `mneme nervous-system`.
 *
 * `puppeteer-core` is **strictly peer-optional** — Mneme's hard dependency
 * graph stays small.  If the user wants PDFs, they install puppeteer-core
 * + a Chromium.  If they don't, we throw a friendly, actionable error.
 *
 * This module is the only thing in the codebase that touches puppeteer,
 * and even then via dynamic `import()` so it never gets bundled into a
 * normal Mneme run.
 */

import { accessSync, constants as fsConstants, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

// ─── public types ─────────────────────────────────────────────────────

export interface PdfOpts {
  /** Page format. Default A4. */
  format?: "A4" | "Letter";
  /** CSS-string margins (e.g. "18mm"). */
  margin?: { top?: string; right?: string; bottom?: string; left?: string };
  /** Print background colors. Default true (we want our gradients). */
  printBackground?: boolean;
  /** Honor `@page` size declared in CSS. Default true. */
  preferCSSPageSize?: boolean;
  /** Override executable path (Chromium / Chrome / Edge). */
  executablePath?: string;
}

/**
 * Friendly error thrown when puppeteer-core is missing or Chromium can't be
 * located. The message is the help text — printable directly to a terminal.
 */
export class PdfDependencyMissingError extends Error {
  /** Stable, machine-checkable code. */
  readonly code: string;
  constructor(message: string, code = "PUPPETEER_MISSING") {
    super(message);
    this.name = "PdfDependencyMissingError";
    this.code = code;
  }
}

const INSTALL_HINT = [
  "PDF rendering needs puppeteer-core (peer-optional). To enable:",
  "",
  "  1. npm install -g puppeteer-core",
  "     # or, in this repo:  npm install --save-dev puppeteer-core",
  "",
  "  2. Make sure a Chromium-family browser is reachable. Easiest options:",
  "       a) Set PUPPETEER_EXECUTABLE_PATH to your Chrome/Edge/Chromium binary.",
  "       b) Or install full puppeteer (downloads its own Chromium):",
  "            npm install -g puppeteer",
  "",
  "Mneme still wrote the HTML report — open it in any browser and use the",
  "browser's built-in 'Print → Save as PDF' to export.",
].join("\n");

/**
 * Render `htmlPath` (a self-contained HTML document on disk) into `pdfPath`.
 * Throws {@link PdfDependencyMissingError} if puppeteer-core or Chromium are
 * unavailable.
 */
export async function htmlToPdf(
  htmlPath: string,
  pdfPath: string,
  opts: PdfOpts = {},
): Promise<void> {
  // Read the HTML up-front so we can fail loudly if the user passed a stale
  // path before we even spin up a browser.
  const html = readFileSync(htmlPath, "utf8");

  const puppeteer = await loadPuppeteer();

  const launchOpts: Record<string, unknown> = {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  };

  const exe = opts.executablePath ?? process.env.PUPPETEER_EXECUTABLE_PATH ?? findChromiumLike();
  if (exe) {
    launchOpts.executablePath = exe;
  }

  let browser: { close: () => Promise<void>; newPage: () => Promise<unknown> };
  try {
    browser = (await (puppeteer as unknown as { launch: (o: unknown) => Promise<unknown> })
      .launch(launchOpts)) as typeof browser;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new PdfDependencyMissingError(
      [
        `Could not launch a Chromium-family browser: ${msg}`,
        "",
        INSTALL_HINT,
      ].join("\n"),
      "CHROMIUM_NOT_FOUND",
    );
  }

  try {
    const page = (await browser.newPage()) as {
      setContent: (html: string, opts?: unknown) => Promise<void>;
      goto: (url: string, opts?: unknown) => Promise<unknown>;
      pdf: (opts?: unknown) => Promise<unknown>;
    };

    // Two strategies: setContent handles inline HTML, but doesn't follow
    // relative URLs.  Our renderer uses no relative URLs (everything inline),
    // so setContent is the cleanest path.
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfOpts: Record<string, unknown> = {
      path: resolvePath(pdfPath),
      format: opts.format ?? "A4",
      printBackground: opts.printBackground ?? true,
      preferCSSPageSize: opts.preferCSSPageSize ?? true,
    };
    if (opts.margin) {
      pdfOpts.margin = {
        top: opts.margin.top ?? "18mm",
        right: opts.margin.right ?? "16mm",
        bottom: opts.margin.bottom ?? "18mm",
        left: opts.margin.left ?? "16mm",
      };
    }

    await page.pdf(pdfOpts);
  } finally {
    try {
      await browser.close();
    } catch {
      /* best effort */
    }
  }
  // `html` is read above so a stale path fails fast — silence unused warning.
  void html;
}

// ─── helpers ──────────────────────────────────────────────────────────

async function loadPuppeteer(): Promise<unknown> {
  // We use a string-built specifier so the TS compiler does not try to resolve
  // the optional peer dep at type-check time.  At runtime, dynamic import()
  // works the same.  If the package is missing, the catch below fires.
  const spec = "puppeteer-core";
  try {
    return await import(/* @vite-ignore */ spec);
  } catch {
    throw new PdfDependencyMissingError(INSTALL_HINT, "PUPPETEER_MISSING");
  }
}

/**
 * Walk a few well-known install locations to discover a Chromium-like binary
 * if the user didn't set PUPPETEER_EXECUTABLE_PATH.  Best-effort and silent —
 * a `null` return just means we'll let puppeteer try its bundled fallback.
 */
function findChromiumLike(): string | null {
  // We deliberately avoid heavy filesystem walks — only check well-known paths.
  const candidates: string[] = [];
  const platform = process.platform;
  if (platform === "win32") {
    const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const localAppData = process.env["LOCALAPPDATA"] ?? "";
    candidates.push(
      `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${programFilesX86}\\Microsoft\\Edge\\Application\\msedge.exe`,
      localAppData ? `${localAppData}\\Google\\Chrome\\Application\\chrome.exe` : "",
    );
  } else if (platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    );
  } else {
    // Linux + others.
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/microsoft-edge",
      "/snap/bin/chromium",
    );
  }
  for (const c of candidates) {
    if (!c) continue;
    try {
      accessSync(c, fsConstants.F_OK);
      return c;
    } catch {
      /* keep looking */
    }
  }
  return null;
}
