/**
 * v2.77.0 — interactive TUI: pure-logic tests (no terminal needed).
 *   T1 — catalog load (dedup + defensive)
 *   T2 — fuzzy filter + ranking (the "type plain language" core)
 *   T3 — keypress reducer (search / navigate / run / quit transitions)
 *   T4 — run classification (parameterless vs needs-args vs MCP-only)
 *   T5 — render frame (layout, selection, output pane)
 */

import { describe, it, expect } from "vitest";
import { loadCatalog, toCapItem, filterItems, initState, reduce, isParameterless, shellArgsFor, type CapItem } from "../src/ui/tui_core.js";
import { renderFrame, stripAnsi, truncate } from "../src/ui/tui_render.js";

const SAMPLE: CapItem[] = [
  { command: "mneme verify <claim>", since: "1.0", what: "Verify a claim against ground truth", when: "before relaying a factual claim", group: "verify" },
  { command: "mneme status", since: "1.0", what: "Show health + version", when: "session start", group: "core" },
  { command: "mneme chronos record", since: "2.74.0", what: "record an answer + classify temporal drift", when: "after every substantive answer", group: "core" },
  { command: "mneme.truth.check", since: "1.0", what: "ACGV truth-check a claim", when: "MCP agents verifying claims", group: "verify" },
  { command: "mneme bloom --probe <verb>", since: "2.21", what: "probe the catalog bloom filter", when: "membership test", group: "atlas" },
];

describe("v2.77.0 T1 — catalog load (PINNED)", () => {
  it("T1.1 dedups by command + drops malformed entries", () => {
    const out = loadCatalog([SAMPLE[0], SAMPLE[0], { what: "no command" }, null, SAMPLE[1]]);
    expect(out.map((c) => c.command)).toEqual(["mneme verify <claim>", "mneme status"]);
  });
  it("T1.2 toCapItem fills defaults + rejects junk", () => {
    expect(toCapItem({ command: "mneme x" })).toMatchObject({ command: "mneme x", group: "core", since: "?" });
    expect(toCapItem({})).toBeNull();
    expect(toCapItem("nope")).toBeNull();
  });
});

describe("v2.77.0 T2 — fuzzy filter + ranking (PINNED)", () => {
  it("T2.1 empty query → all (stable)", () => {
    expect(filterItems(SAMPLE, "").length).toBe(SAMPLE.length);
    expect(filterItems(SAMPLE, "   ").length).toBe(SAMPLE.length);
  });
  it("T2.2 command-name match ranks above a what/when-only match", () => {
    const r = filterItems(SAMPLE, "verify");
    // "mneme verify <claim>" (name) + "mneme.truth.check" (when: 'verifying') both match;
    // the command-name match must come first.
    expect(r[0]!.command).toBe("mneme verify <claim>");
  });
  it("T2.3 natural-language words match the what/when text", () => {
    const r = filterItems(SAMPLE, "temporal drift");
    expect(r[0]!.command).toBe("mneme chronos record");
  });
  it("T2.4 multi-term is AND; no match → []", () => {
    expect(filterItems(SAMPLE, "verify claim").some((c) => c.command.includes("verify"))).toBe(true);
    expect(filterItems(SAMPLE, "verify zzzznomatch")).toEqual([]);
  });
});

describe("v2.77.0 T3 — keypress reducer (PINNED)", () => {
  const base = () => initState(SAMPLE, 4);
  it("T3.1 printable chars build the query + refilter + reset selection", () => {
    let s = base();
    for (const ch of "status") s = reduce(s, { sequence: ch }).state;
    expect(s.query).toBe("status");
    expect(s.filtered[0]!.command).toBe("mneme status");
    expect(s.selected).toBe(0);
  });
  it("T3.2 backspace trims the query", () => {
    let s = reduce(reduce(base(), { sequence: "x" }).state, { name: "backspace" }).state;
    expect(s.query).toBe("");
  });
  it("T3.3 up/down clamp within bounds", () => {
    let s = base();
    s = reduce(s, { name: "up" }).state; expect(s.selected).toBe(0);          // clamp at top
    s = reduce(s, { name: "down" }).state; expect(s.selected).toBe(1);
    for (let i = 0; i < 50; i++) s = reduce(s, { name: "down" }).state;
    expect(s.selected).toBe(SAMPLE.length - 1);                                 // clamp at bottom
  });
  it("T3.4 Enter on a selected item emits a run action", () => {
    const r = reduce(base(), { name: "return" });
    expect(r.action.type).toBe("run");
    expect(r.action.type === "run" && r.action.item.command).toBe(SAMPLE[0]!.command);
  });
  it("T3.5 Esc clears query first, then quits when empty; Ctrl-C quits", () => {
    let s = reduce(base(), { sequence: "a" }).state;
    const cleared = reduce(s, { name: "escape" });
    expect(cleared.action.type).toBe("none");
    expect(cleared.state.query).toBe("");
    expect(reduce(cleared.state, { name: "escape" }).action.type).toBe("quit");
    expect(reduce(base(), { name: "c", ctrl: true }).action.type).toBe("quit");
  });
  it("T3.6 output mode: any key returns to browse", () => {
    const s = { ...base(), mode: "output" as const, output: "hi" };
    const r = reduce(s, { name: "x" });
    expect(r.state.mode).toBe("browse");
    expect(r.action.type).toBe("none");
  });
});

describe("v2.77.0 T4 — run classification (PINNED)", () => {
  it("T4.1 parameterless vs needs-args vs MCP-only", () => {
    expect(isParameterless(SAMPLE[1]!)).toBe(true);                 // mneme status
    expect(isParameterless(SAMPLE[0]!)).toBe(false);                // has <claim>
    expect(isParameterless(SAMPLE[3]!)).toBe(false);                // mneme.truth.check (MCP)
    expect(isParameterless(SAMPLE[4]!)).toBe(false);                // has --probe <verb>
    expect(shellArgsFor(SAMPLE[2]!)).toEqual(["chronos", "record"]);
  });
});

describe("v2.77.0 T5 — render frame (PINNED)", () => {
  it("T5.1 renders a bounded frame; highlights the selection; shows counts", () => {
    const s = initState(SAMPLE, 4);
    const frame = renderFrame(s, 80, 24, "2.77.0");
    expect(frame.length).toBeGreaterThan(8);
    const plain = frame.map(stripAnsi);
    expect(plain[0]).toContain("Mneme");
    expect(plain.join("\n")).toContain(`(${SAMPLE.length}/${SAMPLE.length})`);
    expect(plain.some((l) => l.includes("mneme verify"))).toBe(true);
  });
  it("T5.2 output mode shows the title + body", () => {
    const s = { ...initState(SAMPLE, 4), mode: "output" as const, outputTitle: "mneme status ✓", output: "all good" };
    const plain = renderFrame(s, 80, 24, "2.77.0").map(stripAnsi);
    expect(plain.join("\n")).toContain("mneme status");
    expect(plain.join("\n")).toContain("all good");
  });
  it("T5.3 truncate pads short + ellipsizes long (ANSI-aware)", () => {
    expect(stripAnsi(truncate("hi", 5)).length).toBe(5);
    expect(stripAnsi(truncate("abcdefghij", 5))).toBe("abcd…");
  });
});
