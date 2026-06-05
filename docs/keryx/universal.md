# 🌐 Universal Gate — every vendor, even a human

**Claude Code** has a `PreToolUse` hook, so the approve-from-chat flow drives it directly. But
**Grok / Gemini / Cursor / aider** each have a different (or no) hook API. Chasing every
vendor's hook is a losing game.

**The insight: gate the _command_, not the _agent_.** Every coding agent — and every human —
ultimately runs **shell commands**, and the shell/PATH layer is *universal*. So Mneme intercepts
there.

## How it works

`mneme pager shim install` writes a tiny **shim**, first on `PATH`, for a curated set of
high-risk commands (`rm`, `git`, `kubectl`, `terraform`, `dd`, `docker`, …). When *any* agent —
or you — runs e.g. `git push --force`, the shim:

1. calls `mneme pager request` **first** (which broadcasts the ask to your chats),
2. `exec`s the **real** binary only on **allow**,
3. refuses on **deny** — and **fails open** (runs normally) if the gate is unreachable, so it
   never wedges your shell.

The real binary path is resolved + baked at install time, so the shim never recurses into itself.

```bash
mneme pager shim install                 # guard the default high-risk set
mneme pager shim install --commands rm,git,kubectl   # or pick your own
mneme pager shim status                  # what's guarded
mneme pager shim uninstall               # remove
```
Then put the shim dir **first** on `PATH` in the environment your AI agent runs in:
- **macOS / Linux:** `export PATH="$HOME/.mneme/shims:$PATH"`
- **Windows:** `$env:PATH = "$HOME\.mneme\shims;" + $env:PATH`

That's it — now a `git push --force` from **Claude, Grok, Gemini, Cursor, aider, or your own
keyboard** all flow through the same approve-from-phone gate. One engine, every vendor.

## Honest scope

- It gates the commands you shim, **only when the agent uses the shimmed PATH** (most do; an
  absolute-path invocation like `/usr/bin/git` bypasses it).
- It's **defense-in-depth**, not a kernel sandbox — pair with `mneme heph` (CERBERUS) for
  blast-radius classification of the command itself.
- **Claude Code** still gets the richer native path (the `PreToolUse` hook, with pre-flight +
  Trust-Tide auto-allow); the shim is the universal fallback for everyone else.

> Measured: `universalGateGauntlet = 100` — decision parsing (deny/allow/ask), fail-open on
> garbage, correct shim shape (sh + PowerShell), and no self-recursion.
