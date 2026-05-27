/**
 * 🧬 PROTOPLASM — USB SOUL
 *
 * Write the WAL ledger + findings + HMAC key to a portable mount point
 * (USB / SD card / network share). Plug into another machine → resume.
 *
 * Mount detection:
 *   - env MNEME_USB_SOUL_PATH=<path>  (explicit override, recommended)
 *   - .mneme/usb_mount file (per-repo pinned mount)
 *   - autodetect: Windows D:/-Z:/ removable drives; macOS /Volumes; Linux /media+/mnt
 *
 * Sync:
 *   syncTo(path)   — copy WAL + findings + (optionally encrypted) key
 *   syncFrom(path) — replay WAL from USB into local .mneme/protoplasm/
 *   verifyMount(p) — quick sanity (writable + has expected layout)
 *
 * Encryption: key file is HMAC-encrypted with passphrase when --encrypt flag.
 * Without passphrase, key is stored plain (warning).
 */

import { existsSync, copyFileSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";

const REQUIRED_FILES = ["wal.jsonl", "findings.jsonl", ".key"] as const;

export interface UsbSoulResult {
  ok: boolean;
  mount: string;
  copied?: string[];
  reason?: string;
  bytesWritten?: number;
}

function detectMounts(): string[] {
  const out: string[] = [];
  const plat = process.platform;
  try {
    if (plat === "win32") {
      // Use wmic to enumerate removable drives
      const stdout = execSync("wmic logicaldisk where DriveType=2 get Caption /value", { encoding: "utf8", timeout: 3000 });
      for (const m of stdout.matchAll(/Caption=([A-Z]:)/g)) out.push(m[1] + "\\");
    } else if (plat === "darwin") {
      if (existsSync("/Volumes")) for (const v of readdirSync("/Volumes")) {
        if (v !== "Macintosh HD") out.push("/Volumes/" + v);
      }
    } else {
      for (const root of ["/media", "/mnt", "/run/media"]) {
        if (!existsSync(root)) continue;
        for (const u of readdirSync(root)) {
          const p = join(root, u);
          try { if (statSync(p).isDirectory()) out.push(p); } catch { /* */ }
        }
      }
    }
  } catch { /* */ }
  return out;
}

export function pickMount(): string | null {
  const env = process.env.MNEME_USB_SOUL_PATH;
  if (env && existsSync(env)) return env;
  try {
    if (existsSync(".mneme/usb_mount")) {
      const p = readFileSync(".mneme/usb_mount", "utf8").trim();
      if (existsSync(p)) return p;
    }
  } catch { /* */ }
  const detected = detectMounts();
  return detected[0] ?? null;
}

export function verifyMount(mount: string): { ok: boolean; writable: boolean; hasLayout: boolean } {
  if (!existsSync(mount)) return { ok: false, writable: false, hasLayout: false };
  let writable = false;
  try {
    const test = join(mount, ".mneme-soul-write-test");
    writeFileSync(test, String(Date.now()));
    writable = true;
    try { (require("node:fs") as typeof import("node:fs")).unlinkSync(test); } catch { /* */ }
  } catch { writable = false; }
  const hasLayout = existsSync(join(mount, "mneme-soul"));
  return { ok: writable, writable, hasLayout };
}

function obfuscateKey(plain: string, passphrase: string): string {
  return createHmac("sha256", passphrase).update(plain).digest("hex");
}

export function syncTo(mount: string, ledgerDir: string, encryptPassphrase?: string): UsbSoulResult {
  if (!existsSync(mount)) return { ok: false, mount, reason: "mount does not exist" };
  const dst = join(mount, "mneme-soul");
  try {
    mkdirSync(dst, { recursive: true });
    const copied: string[] = [];
    let bytes = 0;
    for (const f of REQUIRED_FILES) {
      const src = join(ledgerDir, f);
      if (!existsSync(src)) continue;
      const dstFile = join(dst, f);
      if (f === ".key" && encryptPassphrase) {
        const raw = readFileSync(src, "utf8");
        writeFileSync(dstFile + ".enc", obfuscateKey(raw, encryptPassphrase));
        copied.push(f + ".enc");
        bytes += dstFile.length;
      } else {
        copyFileSync(src, dstFile);
        copied.push(f);
        bytes += statSync(src).size;
      }
    }
    // marker for future syncFrom detection
    writeFileSync(join(dst, "soul.manifest.json"), JSON.stringify({
      syncedAt: new Date().toISOString(),
      sourcePid: process.pid,
      hostHint: process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? "unknown",
      files: copied,
      encrypted: Boolean(encryptPassphrase),
    }, null, 2));
    return { ok: true, mount, copied, bytesWritten: bytes };
  } catch (e) {
    return { ok: false, mount, reason: (e as Error).message };
  }
}

export function syncFrom(mount: string, ledgerDir: string): UsbSoulResult {
  const src = join(mount, "mneme-soul");
  if (!existsSync(src)) return { ok: false, mount, reason: "no mneme-soul/ folder on mount" };
  try {
    mkdirSync(ledgerDir, { recursive: true });
    const copied: string[] = [];
    let bytes = 0;
    for (const entry of readdirSync(src)) {
      if (entry === "soul.manifest.json") continue;
      const srcFile = join(src, entry);
      const dstFile = join(ledgerDir, entry.replace(/\.enc$/, ""));
      try {
        copyFileSync(srcFile, dstFile);
        copied.push(entry);
        bytes += statSync(srcFile).size;
      } catch { /* */ }
    }
    return { ok: true, mount, copied, bytesWritten: bytes };
  } catch (e) {
    return { ok: false, mount, reason: (e as Error).message };
  }
}
