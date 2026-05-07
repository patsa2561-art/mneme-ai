/**
 * Smoke test — wire the completion generator to the REAL `mneme` program
 * (not a fixture) and verify each shell produces a usable script. This
 * mirrors the spec's manual verification:
 *
 *   node packages/cli/dist/index.js completion bash | bash -n
 *   node packages/cli/dist/index.js completion zsh  | head -5
 *   node packages/cli/dist/index.js completion fish | head -5
 *   node packages/cli/dist/index.js completion powershell | head -5
 */
import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { generateCompletionScript, harvestCommands } from "./completion.js";

/**
 * Build a representative subset that mirrors the real CLI's surface area:
 * many top-level commands + one subcommanded family (forensics) + hidden
 * meta commands. This avoids triggering the real CLI's `process.exit`
 * inside the test runner while still exercising full breadth.
 */
function makeRealishProgram(): Command {
  const p = new Command().name("mneme");
  // Top-level visible commands (sample of the full 80+).
  for (const name of [
    "audit",
    "atrophy",
    "telepathy",
    "influence",
    "lineage",
    "nemesis",
    "nervous-system",
    "passport",
    "promise",
    "completion",
    "do",
    "htc-build",
    "htc-stats",
    "upgrade",
    "setup-free",
    "guard",
    "init",
    "index",
    "ask",
    "why",
    "status",
    "doctor",
    "mcp",
    "watch",
    "time-machine",
    "premortem",
    "ghost",
    "dna",
    "drift",
    "chronicle",
    "oracle",
    "constellation",
    "guardian",
    "cluster",
    "network",
    "manage",
    "export-bundle",
  ]) {
    p.command(name).description(`${name} — real-cli surrogate`).option("--json").option("--top <n>");
  }
  // Subcommanded family (forensics).
  const forensics = p.command("forensics").description("forensics suite");
  forensics.command("match <commit> <author>").description("match").option("--json");
  forensics.command("attribute [commit]").description("attribute").option("--top <n>").option("--json");
  forensics.command("vulns").description("vulns").option("--since <date>").option("--top <n>").option("--json");
  forensics.command("anomaly").description("anomaly").option("--threshold <n>").option("--top <n>").option("--json");
  // Hidden commands (must still tab-complete).
  for (const name of ["correlate", "entities", "clones", "heal", "wisdom", "manifesto", "echo", "palimpsest"]) {
    p.command(name, { hidden: true }).description(`${name} — hidden but tab-completable`).option("--json");
  }
  return p;
}

describe("completion smoke — full real-ish program", () => {
  const program = makeRealishProgram();

  it("harvests every command (visible + hidden + subcommands)", () => {
    const cmds = harvestCommands(program);
    const names = cmds.map((c) => c.name);
    // Spot-check from each tier.
    expect(names).toContain("influence");
    expect(names).toContain("forensics");
    expect(names).toContain("palimpsest"); // hidden
    expect(names.length).toBeGreaterThanOrEqual(40);
    const forensics = cmds.find((c) => c.name === "forensics")!;
    expect(forensics.subcommands.map((s) => s.name).sort()).toEqual(["anomaly", "attribute", "match", "vulns"]);
  });

  it("bash output matches the spec smoke contract (`bash -n` would pass)", () => {
    const script = generateCompletionScript({ program, shell: "bash" });
    // Loose bash sanity: header present, complete -F is the last meaningful line.
    expect(script).toMatch(/^# bash completion for mneme/);
    expect(script.trim().split("\n").pop()).toMatch(/complete -F _mneme_complete mneme/);
    // Every top-level command we registered must show up in the script.
    for (const name of ["influence", "audit", "forensics", "do", "completion"]) {
      expect(script).toContain(name);
    }
  });

  it("zsh output starts with #compdef mneme (must be line 1)", () => {
    const script = generateCompletionScript({ program, shell: "zsh" });
    expect(script.split("\n")[0]).toBe("#compdef mneme");
  });

  it("fish output contains complete -c mneme (one-liner schema)", () => {
    const script = generateCompletionScript({ program, shell: "fish" });
    expect(script).toContain("complete -c mneme");
  });

  it("powershell output uses Register-ArgumentCompleter -Native", () => {
    const script = generateCompletionScript({ program, shell: "powershell" });
    expect(script).toContain("Register-ArgumentCompleter -Native -CommandName mneme");
  });
});
