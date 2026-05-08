/**
 * Periodic table — manifest + registry + catalog tests.
 *
 * The integration test (every primitive validates + every cross-ref
 * resolves) runs at CI gate so manifest drift is caught immediately.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { validateManifest, type AnyManifest } from "./manifest.js";
import { Registry, declare } from "./registry.js";
import "./catalog.js"; // side-effect: populates the global registry
import { registry } from "./registry.js";

describe("periodic — manifest validation", () => {
  it("accepts a valid element manifest", () => {
    const m: AnyManifest = {
      id: "test.fixture",
      kind: "element",
      summary: "fixture summary",
      description: "fixture description that is long enough for tests",
      inputs: { x: "number" },
      output: "number",
      cost: { io: "none", cpu: "trivial", msP50: 0.1 },
      deterministic: true,
      sideEffect: "none",
      tags: ["test"],
    };
    expect(validateManifest(m)).toEqual([]);
  });

  it("rejects bad ids", () => {
    const m = base({ id: "BAD ID" });
    expect(validateManifest(m).join()).toMatch(/lowercase/);
  });

  it("rejects empty tags", () => {
    const m = base({ tags: [] });
    expect(validateManifest(m).join()).toMatch(/non-empty array/);
  });

  it("rejects negative cost.msP50", () => {
    const m = base({ cost: { io: "none", cpu: "trivial", msP50: -1 } });
    expect(validateManifest(m).join()).toMatch(/non-negative/);
  });

  it("rejects atom missing parent element", () => {
    const m = { ...base({}), kind: "atom" } as AnyManifest;
    const issues = validateManifest(m);
    expect(issues.join()).toMatch(/parent element/);
  });

  it("rejects molecule with empty composes list", () => {
    const m: AnyManifest = {
      id: "test.empty-mol",
      kind: "molecule",
      summary: "fixture summary",
      description: "fixture description that is long enough",
      inputs: {},
      output: "void",
      cost: { io: "none", cpu: "trivial", msP50: 1 },
      deterministic: true,
      sideEffect: "none",
      tags: ["test"],
      composes: [],
    };
    expect(validateManifest(m).join()).toMatch(/compose ≥ 1/);
  });
});

describe("periodic — Registry isolation (instances)", () => {
  let r: Registry;
  beforeEach(() => {
    r = new Registry();
  });

  it("indexes by id, kind, and tag", () => {
    const m = base({ id: "a.b" });
    r.register(m);
    expect(r.get("a.b")).toBe(m);
    expect(r.elements()).toContain(m);
    expect(r.byTags(["test"])).toContain(m);
  });

  it("throws on invalid manifest", () => {
    const bad = base({ id: "X" });
    expect(() => r.register(bad)).toThrow(/invalid/);
  });

  it("idempotent re-registration replaces in place", () => {
    r.register(base({ id: "a.b", summary: "first long enough" }));
    r.register(base({ id: "a.b", summary: "second long enough" }));
    expect(r.elements()).toHaveLength(1);
    expect(r.get("a.b")!.summary).toBe("second long enough");
  });

  it("clear empties the registry", () => {
    r.register(base({ id: "a.b" }));
    r.clear();
    expect(r.all()).toEqual([]);
  });
});

describe("periodic — catalog integration (global registry)", () => {
  it("validates every catalog manifest", () => {
    const result = registry.validateAll();
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("ships at least 15 elements + 5 atoms + 2 molecules (v0.40 floor)", () => {
    expect(registry.elements().length).toBeGreaterThanOrEqual(15);
    expect(registry.atoms().length).toBeGreaterThanOrEqual(5);
    expect(registry.molecules().length).toBeGreaterThanOrEqual(2);
  });

  it("every atom resolves to a known element", () => {
    for (const a of registry.atoms()) {
      const parent = registry.get(a.element);
      expect(parent, `atom ${a.id} parent`).toBeDefined();
      expect(parent!.kind).toBe("element");
    }
  });

  it("every molecule's composes references resolve", () => {
    for (const m of registry.molecules()) {
      for (const ref of m.composes) {
        expect(registry.get(ref), `molecule ${m.id} → ${ref}`).toBeDefined();
      }
    }
  });

  it("ids are unique across all kinds", () => {
    const ids = registry.all().map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("byTags filter returns at least one primitive for common tags", () => {
    expect(registry.byTags(["git"]).length).toBeGreaterThan(0);
    expect(registry.byTags(["vector"]).length).toBeGreaterThan(0);
    expect(registry.byTags(["security"]).length).toBeGreaterThan(0);
  });

  it("declare() returns the same manifest it registered", () => {
    const r = new Registry();
    // declare uses the global registry; here we hand-roll the same
    // pattern with the local Registry to test the contract.
    const m = base({ id: "declare.test" });
    r.register(m);
    expect(r.get("declare.test")).toBe(m);
  });
});

describe("periodic — declare helper (global side effect)", () => {
  it("registers and returns the manifest", () => {
    const m = declare(base({ id: "global.helper.test" }));
    expect(m.id).toBe("global.helper.test");
    expect(registry.get("global.helper.test")).toBe(m);
  });
});

/* ──────  helpers  ────── */

function base(overrides: Partial<AnyManifest>): AnyManifest {
  const m: AnyManifest = {
    id: "fixture.id",
    kind: "element",
    summary: "fixture summary",
    description: "fixture description that is long enough for tests",
    inputs: {},
    output: "void",
    cost: { io: "none", cpu: "trivial", msP50: 0.1 },
    deterministic: true,
    sideEffect: "none",
    tags: ["test"],
    ...overrides,
  } as AnyManifest;
  return m;
}
