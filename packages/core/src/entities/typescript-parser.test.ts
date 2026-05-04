import { describe, it, expect, beforeAll } from "vitest";
import { TypeScriptParser } from "./typescript-parser.js";

let parser: TypeScriptParser;

beforeAll(async () => {
  parser = new TypeScriptParser();
  await parser.preload();
});

function parse(filePath: string, source: string) {
  return Array.from(parser.parseFile(filePath, source));
}

describe("TypeScriptParser", () => {
  it("extracts function declarations", () => {
    const out = parse(
      "x.ts",
      `
      export function charge(amount: number): number {
        return amount;
      }
    `,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("function");
    expect(out[0]!.name).toBe("charge");
    expect(out[0]!.signature).toContain("charge(amount: number): number");
  });

  it("extracts class declarations", () => {
    const out = parse(
      "x.ts",
      `
      export class OrderQueue {
        enqueue(x: any) {}
      }
    `,
    );
    const cls = out.find((e) => e.kind === "class");
    expect(cls).toBeDefined();
    expect(cls!.name).toBe("OrderQueue");
  });

  it("extracts interfaces and type aliases as 'type'", () => {
    const out = parse(
      "x.ts",
      `
      export interface User { id: string; }
      export type Email = string;
    `,
    );
    const kinds = out.filter((e) => e.kind === "type").map((e) => e.name);
    expect(kinds).toContain("User");
    expect(kinds).toContain("Email");
  });

  it("treats exported arrow functions as 'function' kind", () => {
    const out = parse(
      "x.ts",
      `export const handler = (x: number) => x + 1;`,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("function");
    expect(out[0]!.name).toBe("handler");
  });

  it("treats exported plain values as 'variable' kind", () => {
    const out = parse(
      "x.ts",
      `export const VERSION = "0.2.0";`,
    );
    expect(out[0]!.kind).toBe("variable");
    expect(out[0]!.name).toBe("VERSION");
  });

  it("does not emit non-exported variables", () => {
    const out = parse(
      "x.ts",
      `
      const internal = 42;
      export const exposed = 1;
    `,
    );
    const names = out.map((e) => e.name);
    expect(names).not.toContain("internal");
    expect(names).toContain("exposed");
  });

  it("captures startLine and endLine accurately", () => {
    const src = [
      "// line 1",
      "// line 2",
      "export function foo() {",
      "  return 1;",
      "}",
    ].join("\n");
    const [foo] = parse("x.ts", src);
    expect(foo!.startLine).toBe(3);
    expect(foo!.endLine).toBe(5);
  });

  it("produces stable, file-specific ids", () => {
    const a = parse("a.ts", "export function f() {}");
    const b = parse("b.ts", "export function f() {}");
    expect(a[0]!.id).not.toBe(b[0]!.id);
    const a2 = parse("a.ts", "export function f() {}");
    expect(a[0]!.id).toBe(a2[0]!.id);
  });

  it("handles TSX files", () => {
    const out = parse(
      "Component.tsx",
      `export function Button(props: { label: string }) {
        return <button>{props.label}</button>;
      }`,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.language).toBe("tsx");
  });

  it("handles JS files", () => {
    const out = parse(
      "a.js",
      `export function add(a, b) { return a + b; }`,
    );
    expect(out[0]!.language).toBe("javascript");
  });

  it("extracts multiple top-level statements", () => {
    const out = parse(
      "x.ts",
      `
      export function a() {}
      export class B {}
      export interface C {}
      export const d = 1;
      export const e = () => 2;
    `,
    );
    expect(out.map((e) => e.name).sort()).toEqual(["B", "C", "a", "d", "e"]);
  });
});
