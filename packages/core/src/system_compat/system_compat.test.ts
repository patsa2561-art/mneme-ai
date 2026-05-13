import { describe, it, expect } from "vitest";
import { platform } from "node:os";

import {
  probeOs,
  probeNode,
  probePackageManagers,
  probeGlobalInstall,
  decideStrategy,
  probeUpgradeEnvironment,
  formatPulseLine,
  commandFor,
  gateDaemonUpgrade,
  type SystemCompatProbe,
} from "./index.js";

describe("v1.93 SYSTEM-COMPAT · OS probe", () => {
  it("returns platform + release + arch", () => {
    const os = probeOs();
    expect(["win32", "darwin", "linux", "freebsd", "aix", "openbsd", "sunos"]).toContain(os.platform);
    expect(typeof os.release).toBe("string");
    expect(typeof os.arch).toBe("string");
    expect(os.label.length).toBeGreaterThan(0);
  });

  it("labels Windows / macOS / Linux distinctly", () => {
    const os = probeOs();
    if (os.platform === "win32") expect(os.label).toMatch(/Windows/);
    if (os.platform === "darwin") expect(os.label).toMatch(/macOS/);
    if (os.platform === "linux") expect(os.label).toMatch(/Linux/);
  });
});

describe("v1.93 SYSTEM-COMPAT · Node probe", () => {
  it("parses major from process.version", () => {
    const n = probeNode();
    expect(n.version).toBe(process.version);
    expect(n.major).toBeGreaterThanOrEqual(20); // anyone running tests has a sane Node
    expect(n.minRequired).toBe("v22.0.0");
    expect(typeof n.ok).toBe("boolean");
  });

  it("ok=true when major >= 22", () => {
    const n = probeNode();
    if (n.major >= 22) expect(n.ok).toBe(true);
    else expect(n.ok).toBe(false);
  });
});

describe("v1.93 SYSTEM-COMPAT · package managers", () => {
  it("returns shape for every checked manager", () => {
    const pm = probePackageManagers();
    for (const key of ["npm", "yarn", "pnpm", "brew", "docker"] as const) {
      expect(pm[key]).toHaveProperty("available");
      expect(pm[key]).toHaveProperty("version");
      expect(pm[key]).toHaveProperty("path");
      expect(typeof pm[key].available).toBe("boolean");
    }
  });

  it("npm SHOULD be available when running these tests via vitest", () => {
    const pm = probePackageManagers();
    expect(pm.npm.available).toBe(true);
    expect(pm.npm.version).toBeTruthy();
  });
});

describe("v1.93 SYSTEM-COMPAT · global-install probe", () => {
  it("returns prefix when npm is available", () => {
    const g = probeGlobalInstall();
    // npm is available in test env; prefix should be a non-empty string
    expect(g.prefix).toBeTruthy();
    expect(g.binDir).toBeTruthy();
    expect(g.modulesDir).toBeTruthy();
  });

  it("writable is a boolean and reflects reality", () => {
    const g = probeGlobalInstall();
    expect(typeof g.writable).toBe("boolean");
    expect(typeof g.needsElevation).toBe("boolean");
  });
});

describe("v1.93 SYSTEM-COMPAT · decideStrategy", () => {
  const baseOk = {
    os: { platform: platform(), release: "x", arch: "x64", label: "Test OS" },
    node: { version: "v22.7.0", major: 22, ok: true, minRequired: "v22.0.0" },
    packageManagers: {
      npm: { available: true, version: "10.0.0", path: "/usr/bin/npm" },
      yarn: { available: false, version: null, path: null },
      pnpm: { available: false, version: null, path: null },
      brew: { available: false, version: null, path: null },
      docker: { available: false, version: null, path: null },
    },
    globalInstall: { prefix: "/home/u/.npm-global", binDir: "/home/u/.npm-global/bin", modulesDir: "/home/u/.npm-global/lib/node_modules", writable: true, needsElevation: false, notWritableReason: null },
  } as const;

  it("BLOCKS when Node is too old", () => {
    const d = decideStrategy({ ...baseOk, node: { version: "v20.0.0", major: 20, ok: false, minRequired: "v22.0.0" } });
    expect(d.verdict).toBe("BLOCK");
    expect(d.strategy).toBe("manual");
    expect(d.reasons[0]).toContain("too old");
  });

  it("returns SAFE + global-npm when npm available and prefix writable", () => {
    const d = decideStrategy(baseOk);
    expect(d.verdict).toBe("SAFE");
    expect(d.strategy).toBe("global-npm");
  });

  it("DEFERS when prefix needs elevation (sudo)", () => {
    const d = decideStrategy({
      ...baseOk,
      globalInstall: { prefix: "/usr/local", binDir: "/usr/local/bin", modulesDir: "/usr/local/lib/node_modules", writable: false, needsElevation: true, notWritableReason: "EACCES" },
    });
    expect(d.verdict).toBe("DEFER");
    expect(d.strategy).toBe("user-npm");
    expect(d.reasons.some((r) => r.includes("elevation"))).toBe(true);
  });

  it("falls back to user-npm SAFELY when prefix not writable but no elevation needed", () => {
    const d = decideStrategy({
      ...baseOk,
      globalInstall: { prefix: "/home/u/.npm-global", binDir: "/home/u/.npm-global/bin", modulesDir: "/home/u/.npm-global/lib/node_modules", writable: false, needsElevation: false, notWritableReason: "ENOENT" },
    });
    expect(d.verdict).toBe("SAFE");
    expect(d.strategy).toBe("user-npm");
  });

  it("uses docker when npm gone but docker is around", () => {
    const d = decideStrategy({
      ...baseOk,
      packageManagers: { ...baseOk.packageManagers, npm: { available: false, version: null, path: null }, docker: { available: true, version: "Docker version 27.0.1", path: "/usr/bin/docker" } },
      globalInstall: { prefix: null, binDir: null, modulesDir: null, writable: false, needsElevation: false, notWritableReason: "npm not on PATH" },
    });
    expect(d.verdict).toBe("SAFE");
    expect(d.strategy).toBe("docker");
  });

  it("BLOCKS when nothing is available", () => {
    const d = decideStrategy({
      ...baseOk,
      packageManagers: {
        npm: { available: false, version: null, path: null },
        yarn: { available: false, version: null, path: null },
        pnpm: { available: false, version: null, path: null },
        brew: { available: false, version: null, path: null },
        docker: { available: false, version: null, path: null },
      },
      globalInstall: { prefix: null, binDir: null, modulesDir: null, writable: false, needsElevation: true, notWritableReason: "npm not on PATH" },
    });
    expect(d.verdict).toBe("BLOCK");
    expect(d.strategy).toBe("manual");
  });

  it("macOS + brew + no npm + docker → docker strategy", () => {
    const d = decideStrategy({
      ...baseOk,
      os: { platform: "darwin", release: "23.0.0", arch: "arm64", label: "macOS Sonoma" },
      packageManagers: {
        npm: { available: false, version: null, path: null },
        yarn: { available: false, version: null, path: null },
        pnpm: { available: false, version: null, path: null },
        brew: { available: true, version: "Homebrew 4.0.0", path: "/opt/homebrew/bin/brew" },
        docker: { available: true, version: "27", path: "/usr/local/bin/docker" },
      },
      globalInstall: { prefix: null, binDir: null, modulesDir: null, writable: false, needsElevation: false, notWritableReason: "npm not on PATH" },
    });
    expect(d.verdict).toBe("SAFE");
    expect(d.strategy).toBe("docker");
  });
});

describe("v1.93 SYSTEM-COMPAT · top-level probe", () => {
  it("returns a complete probe object", () => {
    const p = probeUpgradeEnvironment();
    expect(p.ts).toBeGreaterThan(0);
    expect(p.os).toBeTruthy();
    expect(p.node).toBeTruthy();
    expect(p.packageManagers).toBeTruthy();
    expect(p.globalInstall).toBeTruthy();
    expect(["SAFE", "DEFER", "BLOCK"]).toContain(p.verdict);
    expect(["global-npm", "user-npm", "brew", "docker", "manual"]).toContain(p.upgradeStrategy);
    expect(p.reasons.length).toBeGreaterThan(0);
    expect(p.pulseLine).toContain("SYSTEM-COMPAT");
  });

  it("pulseLine reflects verdict (✓ / ⏳ / ✗)", () => {
    const p = probeUpgradeEnvironment();
    if (p.verdict === "SAFE") expect(p.pulseLine).toContain("✓");
    if (p.verdict === "DEFER") expect(p.pulseLine).toContain("⏳");
    if (p.verdict === "BLOCK") expect(p.pulseLine).toContain("✗");
  });
});

describe("v1.93 SYSTEM-COMPAT · commandFor + daemon gate", () => {
  it("returns the right shell command for each strategy", () => {
    const g = commandFor("global-npm");
    expect(g!.cmd).toBe("npm");
    expect(g!.args).toContain("-g");
    expect(g!.args.some((a) => a.includes("mneme-ai"))).toBe(true);

    const u = commandFor("user-npm");
    expect(u!.cmd).toBe("npm");
    expect(u!.args).toContain("--prefix");

    const d = commandFor("docker");
    expect(d!.cmd).toBe("docker");
    expect(d!.args[0]).toBe("pull");

    expect(commandFor("manual")).toBeNull();
  });

  it("gateDaemonUpgrade decides shouldProceed", () => {
    const g = gateDaemonUpgrade();
    expect(typeof g.shouldProceed).toBe("boolean");
    if (g.shouldProceed) {
      expect(g.command).toBeTruthy();
      expect(g.command!.cmd).toMatch(/npm|docker|brew/);
    } else {
      expect(g.inboxLine).toBeTruthy();
    }
  });
});

describe("v1.93 SYSTEM-COMPAT · formatPulseLine", () => {
  it("uses ✓ for SAFE, ⏳ for DEFER, ✗ for BLOCK", () => {
    const os = { platform: "linux" as const, release: "5.10", arch: "x64", label: "Linux" };
    const node = { version: "v22.0.0", major: 22, ok: true, minRequired: "v22.0.0" };
    expect(formatPulseLine({ os, node, verdict: "SAFE", strategy: "global-npm" })).toContain("✓");
    expect(formatPulseLine({ os, node, verdict: "DEFER", strategy: "user-npm" })).toContain("⏳");
    expect(formatPulseLine({ os, node, verdict: "BLOCK", strategy: "manual" })).toContain("✗");
  });
});
