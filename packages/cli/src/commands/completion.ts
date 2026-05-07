/**
 * `mneme completion <shell>` — emit a shell-completion script for bash, zsh,
 * fish, or powershell.
 *
 * Why this matters: Mneme has 80+ commands. Without tab-completion, users
 * have to remember names like `palimpsest`, `nemesis`, `crystal-ball`. With
 * tab-completion they type `mneme p<TAB>` and see the menu. That's the
 * difference between "I'll learn this someday" and "I use this every day".
 *
 * Implementation strategy:
 *
 *   1. Walk the registered commander tree (program.commands) and harvest
 *      { name, description, options[] } for every command — including
 *      hidden ones (we DO want them tab-completable; hidden just means
 *      "not in --help").
 *   2. Emit a single, self-contained script for the requested shell.
 *      No external deps, no companion files. The script is the install.
 *   3. Bash gets a `complete -F` function. Zsh gets a `#compdef`. Fish
 *      gets `complete -c mneme ...` lines. PowerShell gets
 *      `Register-ArgumentCompleter`.
 *
 * What it does NOT do:
 *
 *   • Argument-value completion for things like `<file>` or `<commit>` —
 *     bash/zsh do file completion natively when we tell them to via
 *     `_files` / `_arguments`. Commit completion isn't standardised
 *     across shells, so we leave it to git's own completion to chain.
 *   • Dynamic completion (e.g. "complete --author <email> from your
 *     repo's authors"). That'd require shelling back into Mneme on every
 *     <TAB>; not worth the latency.
 */

import { Command } from "commander";

/* ───────────────────────  Public surface  ─────────────────────── */

export interface CompletionOptions {
  /** The CLI program (must already have all commands registered). */
  program: Command;
  /** Target shell. */
  shell: "bash" | "zsh" | "fish" | "powershell";
}

/**
 * Produce the completion script as a string. Pure — no I/O. Callers (the
 * CLI action) write to stdout.
 */
export function generateCompletionScript(opts: CompletionOptions): string {
  const cmds = harvestCommands(opts.program);
  switch (opts.shell) {
    case "bash":
      return renderBash(cmds);
    case "zsh":
      return renderZsh(cmds);
    case "fish":
      return renderFish(cmds);
    case "powershell":
      return renderPowerShell(cmds);
  }
}

/**
 * CLI action: print the script to stdout and exit. Returns an exit code so
 * callers can `process.exit(...)`.
 */
export function completionCommand(opts: CompletionOptions & { write?: (s: string) => void }): number {
  const supported: ReadonlyArray<CompletionOptions["shell"]> = ["bash", "zsh", "fish", "powershell"];
  if (!supported.includes(opts.shell)) {
    const writeErr = (s: string) => process.stderr.write(s);
    writeErr(`Unsupported shell: ${opts.shell}\n`);
    writeErr(`Supported: ${supported.join(", ")}\n`);
    return 1;
  }
  const script = generateCompletionScript(opts);
  const write = opts.write ?? ((s: string) => process.stdout.write(s));
  write(script);
  if (!script.endsWith("\n")) write("\n");
  return 0;
}

/* ───────────────────────  Command harvest  ─────────────────────── */

export interface HarvestedCommand {
  /** Top-level name as registered (no leading `mneme `). */
  name: string;
  description: string;
  /** Long flags only (e.g. `--certify`, `--baseline`). Short flags omitted to keep the script tight. */
  options: string[];
  /** Subcommands keyed by name (e.g. forensics → match / attribute / vulns / anomaly). */
  subcommands: HarvestedCommand[];
}

/**
 * Walk the commander tree and produce a flat-but-nested list of commands.
 * Exported so tests can hand it a stub program and verify the harvest.
 */
export function harvestCommands(program: Command): HarvestedCommand[] {
  const out: HarvestedCommand[] = [];
  for (const cmd of program.commands) {
    out.push(harvestOne(cmd));
  }
  // Sort alphabetically — keeps the script diff-friendly across releases.
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function harvestOne(cmd: Command): HarvestedCommand {
  // Commander's `.name()` returns the bare name (no `<args>` suffix).
  const name = cmd.name();
  const description = cmd.description() ?? "";
  const options: string[] = [];
  for (const opt of cmd.options) {
    // `opt.long` is the `--xxx` form. `opt.flags` includes both short + long.
    if (opt.long) options.push(opt.long);
  }
  options.push("--help");
  options.sort();

  const subcommands: HarvestedCommand[] = [];
  for (const sub of cmd.commands) {
    subcommands.push(harvestOne(sub));
  }
  subcommands.sort((a, b) => a.name.localeCompare(b.name));

  return { name, description, options, subcommands };
}

/* ───────────────────────  Renderers  ─────────────────────── */

/** Escape a string so it's safe between single quotes in bash / zsh / fish. */
function shellSingleQuote(s: string): string {
  // POSIX trick: end the single-quoted string, emit an escaped quote, restart.
  return "'" + s.replace(/'/g, `'\\''`) + "'";
}

/** Strip ANSI/control chars + collapse whitespace — descriptions become one-liners. */
function flattenDescription(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\s+/g, " ").trim();
}

function renderBash(cmds: HarvestedCommand[]): string {
  const topNames = cmds.map((c) => c.name).join(" ");

  // For each command, emit a per-command option list.
  const perCommandOptions: string[] = [];
  for (const c of cmds) {
    const opts = c.options.join(" ");
    perCommandOptions.push(`        ${c.name})\n            COMPREPLY=( $(compgen -W ${shellSingleQuote(opts)} -- "$cur") )\n            return 0\n            ;;`);
    if (c.subcommands.length > 0) {
      const subList = c.subcommands.map((s) => s.name).join(" ");
      // Subcommand dispatch lives inside the parent case block; we already
      // returned above for option completion. To handle `forensics match
      // --<TAB>`, peek at $prev / $words.
      perCommandOptions.push(
        `        ${c.name}_sub)\n            COMPREPLY=( $(compgen -W ${shellSingleQuote(subList)} -- "$cur") )\n            return 0\n            ;;`,
      );
    }
  }

  const subcommandHandlers: string[] = [];
  for (const c of cmds) {
    if (c.subcommands.length === 0) continue;
    for (const sub of c.subcommands) {
      const opts = sub.options.join(" ");
      subcommandHandlers.push(
        `        "${c.name} ${sub.name}")\n            COMPREPLY=( $(compgen -W ${shellSingleQuote(opts)} -- "$cur") )\n            return 0\n            ;;`,
      );
    }
  }

  return `# bash completion for mneme — generated by \`mneme completion bash\`.
# Install:
#   mneme completion bash > ~/.local/share/bash-completion/completions/mneme
#   # then start a new shell, or:
#   source ~/.local/share/bash-completion/completions/mneme

_mneme_complete() {
    local cur prev words cword
    if declare -F _init_completion >/dev/null 2>&1; then
        _init_completion -n = || return
    else
        # Fallback when bash-completion package isn't installed.
        cur="\${COMP_WORDS[COMP_CWORD]}"
        prev="\${COMP_WORDS[COMP_CWORD-1]}"
        words=("\${COMP_WORDS[@]}")
        cword=$COMP_CWORD
    fi

    local commands=${shellSingleQuote(topNames)}
    local global_opts='--help --version'

    # No subcommand chosen yet → complete the top-level command name.
    if [ "$cword" -eq 1 ]; then
        if [[ "$cur" == --* ]]; then
            COMPREPLY=( $(compgen -W "$global_opts" -- "$cur") )
        else
            COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
        fi
        return 0
    fi

    local cmd="\${words[1]}"
    local subcmd="\${words[2]:-}"

    # Two-level dispatch (e.g. mneme forensics match --<TAB>).
    case "$cmd $subcmd" in
${subcommandHandlers.join("\n")}
    esac

    # Single-level dispatch.
    if [[ "$cur" == --* ]]; then
        case "$cmd" in
${perCommandOptions.filter((s) => !s.includes("_sub)")).join("\n")}
        esac
    fi

    # Default: file completion.
    COMPREPLY=( $(compgen -f -- "$cur") )
    return 0
}

complete -F _mneme_complete mneme
`;
}

function renderZsh(cmds: HarvestedCommand[]): string {
  // The zsh `#compdef` directive must be the first non-blank line.
  const out: string[] = [];
  out.push(`#compdef mneme`);
  out.push(`# zsh completion for mneme — generated by \`mneme completion zsh\`.`);
  out.push(`# Install:`);
  out.push(`#   mneme completion zsh > "\${fpath[1]}/_mneme"`);
  out.push(`#   compinit  # then restart your shell`);
  out.push(``);
  out.push(`_mneme() {`);
  out.push(`    local -a commands`);
  out.push(`    commands=(`);
  for (const c of cmds) {
    const desc = flattenDescription(c.description).slice(0, 110);
    out.push(`        '${c.name}:${desc.replace(/['`:]/g, " ")}'`);
  }
  out.push(`    )`);
  out.push(``);
  out.push(`    local context state line`);
  out.push(`    _arguments -C \\`);
  out.push(`        '1: :->command' \\`);
  out.push(`        '2: :->subcommand' \\`);
  out.push(`        '*::arg:->args'`);
  out.push(``);
  out.push(`    case $state in`);
  out.push(`        command)`);
  out.push(`            _describe -t commands 'mneme command' commands`);
  out.push(`            ;;`);
  out.push(`        subcommand|args)`);
  out.push(`            case $words[2] in`);
  for (const c of cmds) {
    const opts = c.options.join(" ");
    if (c.subcommands.length > 0) {
      out.push(`                ${c.name})`);
      out.push(`                    local -a sub`);
      out.push(`                    sub=(`);
      for (const s of c.subcommands) {
        const sdesc = flattenDescription(s.description).slice(0, 110);
        out.push(`                        '${s.name}:${sdesc.replace(/['`:]/g, " ")}'`);
      }
      out.push(`                    )`);
      out.push(`                    if (( CURRENT == 3 )); then`);
      out.push(`                        _describe -t sub-commands '${c.name} subcommand' sub`);
      out.push(`                    else`);
      out.push(`                        case $words[3] in`);
      for (const s of c.subcommands) {
        const sopts = s.options.join(" ");
        out.push(`                            ${s.name})`);
        out.push(`                                _values 'option' ${sopts.split(" ").map((o) => `'${o}'`).join(" ")} && return`);
        out.push(`                                _files`);
        out.push(`                                ;;`);
      }
      out.push(`                        esac`);
      out.push(`                    fi`);
      out.push(`                    ;;`);
    } else {
      out.push(`                ${c.name})`);
      out.push(
        `                    _values 'option' ${opts.split(" ").map((o) => `'${o}'`).join(" ")} && return`,
      );
      out.push(`                    _files`);
      out.push(`                    ;;`);
    }
  }
  out.push(`            esac`);
  out.push(`            ;;`);
  out.push(`    esac`);
  out.push(`}`);
  out.push(``);
  out.push(`_mneme "$@"`);
  out.push(``);
  return out.join("\n");
}

function renderFish(cmds: HarvestedCommand[]): string {
  const out: string[] = [];
  out.push(`# fish completion for mneme — generated by \`mneme completion fish\`.`);
  out.push(`# Install:`);
  out.push(`#   mneme completion fish > ~/.config/fish/completions/mneme.fish`);
  out.push(``);
  // Helper: complete-no-subcmd predicate.
  out.push(`function __mneme_no_subcommand`);
  out.push(`    set -l cmd (commandline -opc)`);
  out.push(`    if test (count $cmd) -lt 2`);
  out.push(`        return 0`);
  out.push(`    end`);
  out.push(`    return 1`);
  out.push(`end`);
  out.push(``);
  out.push(`function __mneme_using_command`);
  out.push(`    set -l cmd (commandline -opc)`);
  out.push(`    if test (count $cmd) -ge 2`);
  out.push(`        if test "$cmd[2]" = "$argv[1]"`);
  out.push(`            return 0`);
  out.push(`        end`);
  out.push(`    end`);
  out.push(`    return 1`);
  out.push(`end`);
  out.push(``);

  // Top-level commands.
  for (const c of cmds) {
    const desc = flattenDescription(c.description).slice(0, 110).replace(/'/g, "");
    out.push(`complete -c mneme -n '__mneme_no_subcommand' -f -a '${c.name}' -d '${desc}'`);
  }
  out.push(``);

  // Per-command options.
  for (const c of cmds) {
    for (const o of c.options) {
      const flag = o.replace(/^--/, "");
      out.push(`complete -c mneme -n '__mneme_using_command ${c.name}' -l '${flag}'`);
    }
    // Subcommands (e.g. forensics match).
    for (const s of c.subcommands) {
      const sdesc = flattenDescription(s.description).slice(0, 110).replace(/'/g, "");
      out.push(`complete -c mneme -n '__mneme_using_command ${c.name}' -f -a '${s.name}' -d '${sdesc}'`);
    }
  }
  out.push(``);
  return out.join("\n");
}

function renderPowerShell(cmds: HarvestedCommand[]): string {
  // PowerShell completion uses Register-ArgumentCompleter. We emit one
  // top-level completer that inspects the position and emits matching
  // CompletionResult objects.
  const cmdEntries: string[] = [];
  for (const c of cmds) {
    const desc = flattenDescription(c.description).slice(0, 200).replace(/'/g, "''");
    cmdEntries.push(
      `        @{ Name = '${c.name}'; Desc = '${desc}'; Options = @(${c.options
        .map((o) => `'${o}'`)
        .join(", ")}); Subs = @(${c.subcommands
        .map((s) => `@{ Name = '${s.name}'; Options = @(${s.options.map((o) => `'${o}'`).join(", ")}) }`)
        .join(", ")}) }`,
    );
  }

  return `# PowerShell completion for mneme — generated by \`mneme completion powershell\`.
# Install (session-only):
#   mneme completion powershell | Out-String | Invoke-Expression
# Install (persistent):
#   mneme completion powershell >> $PROFILE
#
# After editing $PROFILE: open a new PowerShell session.

Register-ArgumentCompleter -Native -CommandName mneme -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)

    $commands = @(
${cmdEntries.join(",\n")}
    )

    $tokens = $commandAst.CommandElements | ForEach-Object { $_.Extent.Text }
    # tokens[0] is 'mneme'. Position 1 = top-level command, 2 = subcommand or option, etc.
    $position = $tokens.Count
    if ($wordToComplete -eq '') { $position = $position + 1 }

    if ($position -le 2) {
        # Completing the top-level command.
        $commands |
            Where-Object { $_.Name -like "$wordToComplete*" } |
            ForEach-Object {
                [System.Management.Automation.CompletionResult]::new(
                    $_.Name, $_.Name, 'ParameterValue', $_.Desc
                )
            }
        return
    }

    $cmdName = $tokens[1]
    $cmd = $commands | Where-Object { $_.Name -eq $cmdName } | Select-Object -First 1
    if (-not $cmd) { return }

    # If the command has subcommands and we're at position 3, suggest subcommands.
    if ($cmd.Subs.Count -gt 0 -and $position -le 3) {
        $cmd.Subs |
            Where-Object { $_.Name -like "$wordToComplete*" } |
            ForEach-Object {
                [System.Management.Automation.CompletionResult]::new(
                    $_.Name, $_.Name, 'ParameterValue', "$cmdName $($_.Name)"
                )
            }
        return
    }

    # Option completion.
    $options = $cmd.Options
    if ($cmd.Subs.Count -gt 0) {
        $subName = $tokens[2]
        $sub = $cmd.Subs | Where-Object { $_.Name -eq $subName } | Select-Object -First 1
        if ($sub) { $options = $sub.Options }
    }
    $options |
        Where-Object { $_ -like "$wordToComplete*" } |
        ForEach-Object {
            [System.Management.Automation.CompletionResult]::new(
                $_, $_, 'ParameterName', $_
            )
        }
}
`;
}
