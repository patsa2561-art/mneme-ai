#!/usr/bin/env node
/**
 * mneme-upgrade-bootstrap (v1.95.0+)
 *
 * Standalone single-file upgrader. Does NOT depend on the installed
 * Mneme — runs even when the installed copy is broken / too old to
 * have SYSTEM-COMPAT. Solves the chicken-and-egg where you need the
 * new auto-upgrade code to install the new auto-upgrade code.
 *
 * Run via:
 *   node upgrade-bootstrap.mjs
 *   npx mneme-ai upgrade-bootstrap
 *   curl -fsSL https://raw.githubusercontent.com/patsa2561-art/mneme-ai/main/packages/cli/upgrade-bootstrap.mjs | node
 *
 * Cross-platform:
 *   ✓ Windows 10/11 (x64/ARM64) · macOS Big Sur→Sequoia · Linux any distro · WSL2
 *   ✓ Node >= 22 (refuses earlier with clear message)
 *   ✓ Strategies: global-npm · user-npm · brew · docker · manual
 *   ✓ Refuses to auto-sudo. Refuses to assume registry. Refuses silent fail.
 *
 * Exit codes:
 *   0 = installed
 *   1 = error (cause printed)
 *   2 = blocked (Node too old, no pkg manager, etc.) — user action required
 *   3 = deferred (needs user decision — prompts for explicit confirm)
 */

import { spawnSync } from "node:child_process";
import { existsSync, accessSync, constants } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, platform, release, arch } from "node:os";

const COLOR = process.stdout.isTTY ? { red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m" } : { red: "", green: "", yellow: "", cyan: "", reset: "", dim: "", bold: "" };
const C = COLOR;
const MIN_NODE = 22;
const PKG = "mneme-ai";

function log(level, msg) {
  const prefix = level === "ok" ? `${C.green}✓${C.reset}` : level === "err" ? `${C.red}✗${C.reset}` : level === "warn" ? `${C.yellow}⚠${C.reset}` : level === "step" ? `${C.cyan}→${C.reset}` : "·";
  console.log(`${prefix} ${msg}`);
}

function header() {
  console.log("");
  console.log(`${C.bold}${C.cyan}mneme-upgrade-bootstrap${C.reset} ${C.dim}(standalone, no dep on installed Mneme)${C.reset}`);
  console.log(`${C.dim}─────────────────────────────────────────────────────────${C.reset}`);
}

function whichPath(name) {
  const cmd = platform() === "win32" ? "where" : "which";
  const r = spawnSync(cmd, [name], { encoding: "utf8", windowsHide: true, shell: platform() === "win32" });
  if (r.status !== 0) return null;
  return (r.stdout || "").split(/\r?\n/)[0]?.trim() || null;
}

function runVersion(name) {
  const path = whichPath(name);
  if (!path) return { available: false, version: null, path: null };
  const r = spawnSync(name, ["--version"], { encoding: "utf8", windowsHide: true, shell: platform() === "win32", timeout: 5000 });
  if (r.status !== 0) return { available: false, version: null, path };
  return { available: true, version: (r.stdout || "").split(/\r?\n/)[0]?.trim() || null, path };
}

function probeOs() {
  const p = platform();
  const r = release();
  let label;
  if (p === "win32") label = r.startsWith("10.0") ? "Windows 10/11" : `Windows ${r}`;
  else if (p === "darwin") {
    const major = parseInt(r.split(".")[0] || "0", 10);
    const labels = { 20: "macOS Big Sur", 21: "macOS Monterey", 22: "macOS Ventura", 23: "macOS Sonoma", 24: "macOS Sequoia" };
    label = labels[major] || `macOS ${r}`;
  } else if (p === "linux") {
    label = `Linux ${r}`;
  } else label = `${p} ${r}`;
  return { platform: p, release: r, arch: arch(), label };
}

function probeNode() {
  const v = process.version;
  const major = parseInt(v.replace(/^v/, "").split(".")[0] || "0", 10);
  return { version: v, major, ok: major >= MIN_NODE };
}

function probeGlobalPrefix() {
  const npm = whichPath("npm");
  if (!npm) return { prefix: null, writable: false, needsElevation: false, reason: "npm not on PATH" };
  const r = spawnSync("npm", ["config", "get", "prefix"], { encoding: "utf8", windowsHide: true, shell: platform() === "win32", timeout: 5000 });
  if (r.status !== 0) return { prefix: null, writable: false, needsElevation: false, reason: "npm config get prefix failed" };
  const prefix = (r.stdout || "").trim();
  if (!prefix) return { prefix: null, writable: false, needsElevation: false, reason: "empty prefix" };
  const isWin = platform() === "win32";
  const modulesDir = isWin ? join(prefix, "node_modules") : join(prefix, "lib", "node_modules");
  let target = modulesDir;
  for (let i = 0; i < 8 && !existsSync(target); i++) target = dirname(target);
  let writable = false, reason = null;
  try {
    if (existsSync(target)) {
      accessSync(target, constants.W_OK);
      writable = true;
    } else reason = "no existing ancestor directory";
  } catch (e) { reason = e.message; }
  const needsElevation = !writable && (prefix.startsWith("/usr") || prefix.startsWith("/opt") || (isWin && /Program Files/i.test(prefix)));
  return { prefix, modulesDir, writable, needsElevation, reason };
}

function decideStrategy(os, node, mgrs, prefix) {
  if (!node.ok) return { strategy: "manual", verdict: "BLOCK", reason: `Node ${node.version} too old (need v${MIN_NODE}+). Install newer Node first.` };
  if (mgrs.npm.available && prefix.writable) return { strategy: "global-npm", verdict: "SAFE", reason: `npm ${mgrs.npm.version} + prefix ${prefix.prefix} writable` };
  if (mgrs.npm.available && !prefix.writable) {
    if (prefix.needsElevation) return { strategy: "user-npm", verdict: "DEFER", reason: `prefix ${prefix.prefix} requires sudo. Refusing to auto-sudo. Will install to ~/.local` };
    return { strategy: "user-npm", verdict: "SAFE", reason: `prefix not writable (${prefix.reason}); user-prefix fallback` };
  }
  if (os.platform === "darwin" && mgrs.brew.available && !mgrs.npm.available) {
    if (mgrs.docker.available) return { strategy: "docker", verdict: "SAFE", reason: "no npm; brew has no mneme tap yet; docker available" };
    return { strategy: "manual", verdict: "DEFER", reason: "no npm; brew has no mneme tap; install Node or Docker first" };
  }
  if (mgrs.docker.available) return { strategy: "docker", verdict: "SAFE", reason: "npm unavailable; docker fallback" };
  return { strategy: "manual", verdict: "BLOCK", reason: "no supported package manager (npm/brew/docker). Install Node ≥ 22 first." };
}

function commandFor(strategy) {
  switch (strategy) {
    case "global-npm": return { cmd: "npm", args: ["install", "-g", `${PKG}@latest`] };
    case "user-npm": return { cmd: "npm", args: ["install", "--prefix", join(homedir(), ".local"), "-g", `${PKG}@latest`] };
    case "brew": return { cmd: "brew", args: ["upgrade", PKG] };
    case "docker": return { cmd: "docker", args: ["pull", "ghcr.io/patsa2561-art/mneme-ai:latest"] };
    case "manual": return null;
  }
}

function runUpgrade(cmd, args) {
  log("step", `running: ${cmd} ${args.join(" ")}`);
  const start = Date.now();
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: platform() === "win32", timeout: 180_000 });
  const elapsed = Date.now() - start;
  if (r.status === 0) {
    log("ok", `upgrade complete in ${(elapsed / 1000).toFixed(1)}s`);
    return 0;
  }
  log("err", `exit code ${r.status} after ${(elapsed / 1000).toFixed(1)}s`);
  return r.status || 1;
}

function verifyInstalled() {
  // Try the mneme CLI to confirm the new version is now on PATH.
  const r = spawnSync("mneme", ["--version"], { encoding: "utf8", windowsHide: true, shell: platform() === "win32", timeout: 5000 });
  if (r.status === 0) {
    const v = (r.stdout || "").trim();
    log("ok", `mneme on PATH: ${v}`);
    return true;
  }
  log("warn", "mneme CLI not on PATH yet. You may need to restart your shell (or add npm bin to PATH).");
  return false;
}

async function main() {
  header();

  const os = probeOs();
  const node = probeNode();
  log("step", `OS: ${C.bold}${os.label}${C.reset} ${C.dim}(${os.platform} ${os.arch})${C.reset}`);
  if (node.ok) log("ok", `Node ${C.bold}${node.version}${C.reset} (>= v${MIN_NODE})`);
  else log("err", `Node ${node.version} too old — need v${MIN_NODE}+`);

  const mgrs = {
    npm: runVersion("npm"),
    yarn: runVersion("yarn"),
    pnpm: runVersion("pnpm"),
    brew: runVersion("brew"),
    docker: runVersion("docker"),
  };
  const present = Object.entries(mgrs).filter(([_, v]) => v.available).map(([k, v]) => `${k} ${v.version}`);
  log("step", `package managers: ${present.length ? present.join(" · ") : "(none found)"}`);

  const prefix = probeGlobalPrefix();
  if (prefix.prefix) log("step", `npm prefix: ${prefix.prefix} ${prefix.writable ? C.green + "(writable)" + C.reset : C.yellow + "(needs elevation)" + C.reset}`);

  const { strategy, verdict, reason } = decideStrategy(os, node, mgrs, prefix);
  console.log("");
  log("step", `${C.bold}strategy:${C.reset} ${strategy}`);
  log("step", `${C.bold}verdict:${C.reset} ${verdict === "SAFE" ? C.green + "SAFE" + C.reset : verdict === "DEFER" ? C.yellow + "DEFER" + C.reset : C.red + "BLOCK" + C.reset}`);
  log("step", `reason: ${reason}`);
  console.log("");

  if (verdict === "BLOCK") {
    log("err", "cannot proceed automatically.");
    log("step", "next: " + reason);
    process.exit(2);
  }
  if (verdict === "DEFER") {
    log("warn", "deferring auto-execution. Suggested manual:");
    const c = commandFor(strategy);
    if (c) log("step", `  ${c.cmd} ${c.args.join(" ")}`);
    log("step", "or set npm config prefix to a user-writable directory and rerun.");
    process.exit(3);
  }

  const c = commandFor(strategy);
  if (!c) {
    log("err", `no command derived for strategy=${strategy}`);
    process.exit(1);
  }

  const code = runUpgrade(c.cmd, c.args);
  if (code !== 0) process.exit(code);

  console.log("");
  verifyInstalled();
  console.log("");
  log("ok", `done. tell your AI: "Mneme is upgraded — show me what's new" and it will fetch the latest manifest.`);
  process.exit(0);
}

main().catch((e) => {
  log("err", `bootstrap crashed: ${e.message}`);
  process.exit(1);
});
