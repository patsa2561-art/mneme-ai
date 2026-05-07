import { describe, it, expect } from "vitest";
import { Command } from "commander";
import {
  generateCompletionScript,
  harvestCommands,
  completionCommand,
} from "./completion.js";

/**
 * Build a small representative program with: one simple command, one
 * subcommanded command (mimicking `forensics`), one hidden command.
 *
 * Tab-completion should still surface hidden commands — they're hidden from
 * `--help`, not from the user's muscle memory.
 */
function makeFixture(): Command {
  const program = new Command().name("mneme").description("test fixture");
  program.command("audit").description("run audit").option("--certify").option("--baseline");
  program.command("influence").description("cultural alpha rank").option("--top <n>").option("--json");
  program.command("status").description("show status");
  const forensics = program.command("forensics").description("forensics suite");
  forensics.command("match <commit> <author>").description("STR-loci match").option("--json");
  forensics.command("attribute [commit]").description("attribute commit").option("--top <n>");
  program.command("internal", { hidden: true }).description("hidden meta").option("--debug");
  return program;
}

describe("harvestCommands", () => {
  it("returns one entry per top-level command (incl. hidden)", () => {
    const cmds = harvestCommands(makeFixture());
    const names = cmds.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["audit", "influence", "status", "forensics", "internal"]));
  });

  it("captures long options", () => {
    const cmds = harvestCommands(makeFixture());
    const audit = cmds.find((c) => c.name === "audit")!;
    expect(audit.options).toEqual(expect.arrayContaining(["--certify", "--baseline", "--help"]));
  });

  it("recursively captures subcommands", () => {
    const cmds = harvestCommands(makeFixture());
    const forensics = cmds.find((c) => c.name === "forensics")!;
    const subNames = forensics.subcommands.map((s) => s.name).sort();
    expect(subNames).toEqual(["attribute", "match"]);
  });

  it("commands sorted alphabetically", () => {
    const cmds = harvestCommands(makeFixture());
    const names = cmds.map((c) => c.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });
});

describe("generateCompletionScript — bash", () => {
  it("starts with bash header and registers complete -F", () => {
    const script = generateCompletionScript({ program: makeFixture(), shell: "bash" });
    expect(script).toContain("# bash completion for mneme");
    expect(script).toContain("complete -F _mneme_complete mneme");
  });

  it("includes every registered command in the COMPREPLY word list", () => {
    const script = generateCompletionScript({ program: makeFixture(), shell: "bash" });
    for (const name of ["audit", "influence", "status", "forensics", "internal"]) {
      expect(script).toContain(name);
    }
  });

  it("includes per-command option dispatch (option names appear)", () => {
    const script = generateCompletionScript({ program: makeFixture(), shell: "bash" });
    expect(script).toContain("--certify");
    expect(script).toContain("--baseline");
  });

  it("emits subcommand handler entries for forensics", () => {
    const script = generateCompletionScript({ program: makeFixture(), shell: "bash" });
    expect(script).toMatch(/"forensics match"/);
    expect(script).toMatch(/"forensics attribute"/);
  });

  it("uses POSIX-safe single-quote escape ('\\\\'') for embedded apostrophes", () => {
    // shellSingleQuote() must turn `it's` into `'it'\''s'`. We confirm the
    // generated script never produces an unbalanced run that breaks bash.
    const program = new Command().name("mneme");
    program.command("don't-break").description("safety check").option("--ok");
    const script = generateCompletionScript({ program, shell: "bash" });
    // The script must contain the command name (raw — no apostrophes here
    // since command names from commander wouldn't have quotes anyway).
    expect(script).toContain("don't-break");
    // Sanity: no naked /''/ runs that would terminate a quoted string mid-word.
    expect(script).not.toMatch(/'\s+''\s/);
  });
});

describe("generateCompletionScript — zsh", () => {
  it("starts with #compdef directive on the first line (zsh requirement)", () => {
    const script = generateCompletionScript({ program: makeFixture(), shell: "zsh" });
    const firstLine = script.split("\n")[0];
    expect(firstLine).toBe("#compdef mneme");
  });

  it("defines _mneme function and invokes it", () => {
    const script = generateCompletionScript({ program: makeFixture(), shell: "zsh" });
    expect(script).toContain("_mneme()");
    expect(script).toContain('_mneme "$@"');
  });

  it("includes every command in the description list", () => {
    const script = generateCompletionScript({ program: makeFixture(), shell: "zsh" });
    expect(script).toContain("audit:");
    expect(script).toContain("influence:");
    expect(script).toContain("forensics:");
  });

  it("renders subcommands for forensics", () => {
    const script = generateCompletionScript({ program: makeFixture(), shell: "zsh" });
    expect(script).toContain("match:");
    expect(script).toContain("attribute:");
  });
});

describe("generateCompletionScript — fish", () => {
  it("contains complete -c mneme lines", () => {
    const script = generateCompletionScript({ program: makeFixture(), shell: "fish" });
    expect(script).toContain("complete -c mneme");
  });

  it("emits one top-level completion entry per command", () => {
    const script = generateCompletionScript({ program: makeFixture(), shell: "fish" });
    expect(script).toContain("-a 'audit'");
    expect(script).toContain("-a 'influence'");
    expect(script).toContain("-a 'forensics'");
  });

  it("emits options for each command (e.g. --certify on audit)", () => {
    const script = generateCompletionScript({ program: makeFixture(), shell: "fish" });
    expect(script).toContain("__mneme_using_command audit");
    expect(script).toContain("-l 'certify'");
  });

  it("emits forensics subcommand completion", () => {
    const script = generateCompletionScript({ program: makeFixture(), shell: "fish" });
    expect(script).toContain("__mneme_using_command forensics");
    expect(script).toMatch(/-a 'match'/);
  });
});

describe("generateCompletionScript — powershell", () => {
  it("registers a native argument completer", () => {
    const script = generateCompletionScript({ program: makeFixture(), shell: "powershell" });
    expect(script).toContain("Register-ArgumentCompleter");
    expect(script).toContain("-CommandName mneme");
  });

  it("includes each command name as a hashtable entry", () => {
    const script = generateCompletionScript({ program: makeFixture(), shell: "powershell" });
    expect(script).toContain("Name = 'audit'");
    expect(script).toContain("Name = 'forensics'");
  });

  it("includes subcommand entries via Subs array", () => {
    const script = generateCompletionScript({ program: makeFixture(), shell: "powershell" });
    expect(script).toContain("Name = 'match'");
    expect(script).toContain("Name = 'attribute'");
  });

  it("emits CompletionResult constructor calls", () => {
    const script = generateCompletionScript({ program: makeFixture(), shell: "powershell" });
    expect(script).toContain("[System.Management.Automation.CompletionResult]");
  });
});

describe("completionCommand — top-level CLI action", () => {
  it("returns 1 and writes error for an unsupported shell", () => {
    let stderrCaptured = "";
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      stderrCaptured += chunk;
      return true;
    }) as typeof process.stderr.write;
    try {
      const code = completionCommand({
        program: makeFixture(),
        // @ts-expect-error testing the runtime guard
        shell: "tcsh",
        write: () => {},
      });
      expect(code).toBe(1);
      expect(stderrCaptured).toContain("Unsupported shell");
    } finally {
      process.stderr.write = origWrite;
    }
  });

  it("returns 0 and writes the script for a supported shell", () => {
    let captured = "";
    const code = completionCommand({
      program: makeFixture(),
      shell: "bash",
      write: (s) => {
        captured += s;
      },
    });
    expect(code).toBe(0);
    expect(captured).toContain("complete -F _mneme_complete mneme");
  });

  it("each shell produces non-empty output", () => {
    for (const shell of ["bash", "zsh", "fish", "powershell"] as const) {
      let captured = "";
      const code = completionCommand({
        program: makeFixture(),
        shell,
        write: (s) => {
          captured += s;
        },
      });
      expect(code).toBe(0);
      expect(captured.length).toBeGreaterThan(50);
    }
  });
});
