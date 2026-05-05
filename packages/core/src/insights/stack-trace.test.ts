import { describe, it, expect } from "vitest";
import { parseStackTrace, detectLanguage } from "./stack-trace.js";

describe("parseStackTrace — JavaScript/TypeScript", () => {
  it("parses V8-style frames with function name", () => {
    const trace = `TypeError: Cannot read property 'amount' of undefined
    at parseAmount (src/payment.ts:42:15)
    at processCharge (src/payment.ts:78:9)
    at Object.<anonymous> (src/index.ts:5:1)`;
    const frames = parseStackTrace(trace);
    expect(frames).toHaveLength(3);
    expect(frames[0]).toMatchObject({ file: "src/payment.ts", line: 42, function: "parseAmount", language: "js" });
    expect(frames[1]!.function).toBe("processCharge");
  });

  it("parses anonymous frames (no function name)", () => {
    const trace = `Error: kaboom
    at /app/dist/main.js:1:42`;
    const frames = parseStackTrace(trace);
    expect(frames[0]?.file).toBe("/app/dist/main.js");
    expect(frames[0]?.function).toBeUndefined();
  });
});

describe("parseStackTrace — Python", () => {
  it("parses CPython tracebacks", () => {
    const trace = `Traceback (most recent call last):
  File "/app/main.py", line 42, in process_charge
    amount = parse_amount(payload["amount"])
  File "/app/payment.py", line 17, in parse_amount
    return Decimal(value)
ValueError: not a number`;
    const frames = parseStackTrace(trace);
    expect(frames.length).toBeGreaterThanOrEqual(2);
    const main = frames.find((f) => f.file.endsWith("main.py"));
    expect(main).toMatchObject({ line: 42, function: "process_charge", language: "python" });
  });
});

describe("parseStackTrace — Go", () => {
  it("parses Go panic file:line references", () => {
    const trace = `goroutine 1 [running]:
main.foo(0x0)
	/home/dev/app/main.go:42 +0x12
runtime.main()
	/usr/local/go/src/runtime/proc.go:250`;
    const frames = parseStackTrace(trace);
    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect(frames.find((f) => f.file === "/home/dev/app/main.go")?.line).toBe(42);
  });
});

describe("parseStackTrace — Java", () => {
  it("parses Java stack frames with class.method(File.java:line)", () => {
    const trace = `Exception in thread "main" java.lang.NullPointerException
    at com.example.Foo.bar(Foo.java:42)
    at com.example.App.main(App.java:7)`;
    const frames = parseStackTrace(trace);
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({ file: "Foo.java", line: 42, language: "java" });
    expect(frames[0]!.function).toContain("Foo.bar");
  });
});

describe("parseStackTrace — edge cases", () => {
  it("returns empty array for empty input", () => {
    expect(parseStackTrace("")).toEqual([]);
    expect(parseStackTrace("   \n  \n")).toEqual([]);
  });

  it("dedupes consecutive identical (file, line) frames", () => {
    const trace = `at a (foo.ts:42:1)
at a (foo.ts:42:1)
at a (foo.ts:42:1)`;
    expect(parseStackTrace(trace)).toHaveLength(1);
  });

  it("filters out non-matching language extensions", () => {
    // ".java" file should not match the JS regex even if the format looks similar.
    const trace = `at com.x.Foo.bar(Foo.java:42)`;
    const frames = parseStackTrace(trace);
    expect(frames.every((f) => f.language === "java")).toBe(true);
  });

  it("handles a mixed trace (multiple languages in one input)", () => {
    const trace = `TypeError: kaboom
    at handler (src/api.ts:42:1)
And in the worker:
  File "/app/worker.py", line 7, in run_job`;
    const frames = parseStackTrace(trace);
    expect(frames.find((f) => f.language === "js")).toBeDefined();
    expect(frames.find((f) => f.language === "python")).toBeDefined();
  });
});

describe("detectLanguage — heuristic top-level detection", () => {
  it("python (Traceback header)", () => {
    expect(detectLanguage("Traceback (most recent call last):\n  File \"x.py\", line 1, in f")).toBe("python");
  });
  it("go (goroutine header)", () => {
    expect(detectLanguage("goroutine 1 [running]:\n/x/main.go:1 +0x")).toBe("go");
  });
  it("java (.java:N pattern)", () => {
    expect(detectLanguage("at com.x.Foo.bar(Foo.java:42)")).toBe("java");
  });
  it("js (TypeError keyword)", () => {
    expect(detectLanguage("TypeError: Cannot read property 'x' of undefined")).toBe("js");
  });
  it("unknown when no marker", () => {
    expect(detectLanguage("just some random text")).toBe("unknown");
  });
});
