import { describe, it, expect } from "vitest";
import { extractLogEntry, formatForCortex, logpipeGauntlet } from "./index.js";
import { failureSignature } from "../shell_autopilot/index.js";

describe("v2.109 MNEME LOGPIPE — deterministic terminal-knowledge extraction", () => {
  it("extracts an error + its class from a failed command (no hallucination)", () => {
    const e = extractLogEntry("git push", "fatal: The current branch has no upstream branch", 1);
    expect(e.hadError).toBe(true);
    expect(e.errorClass).toBe("no-upstream");
    expect(e.excerpt).toContain("upstream");
    expect(e.kind).toBe("error");
  });

  it("classifies OOM / module / port / segfault / not-found", () => {
    expect(extractLogEntry("py x", "CUDA out of memory", 1).errorClass).toBe("oom");
    expect(extractLogEntry("node a", "Cannot find module 'x'", 1).errorClass).toBe("missing-module");
    expect(extractLogEntry("serve", "EADDRINUSE: address already in use", 1).errorClass).toBe("port-busy");
    expect(extractLogEntry("foo", "command not found: foo", 127).errorClass).toBe("not-found");
  });

  it("a clean success is recorded as a fact, not an error", () => {
    const e = extractLogEntry("npm run build", "Build complete in 4.2s", 0);
    expect(e.hadError).toBe(false);
    expect(e.kind).toBe("success");
    expect(formatForCortex(e).kind).toBe("fact");
  });

  it("infers an error from output even when exit code is missing (NaN)", () => {
    const e = extractLogEntry("script.sh", "Traceback (most recent call last): Exception", NaN);
    expect(e.hadError).toBe(true);
  });

  it("THE LOOP — the signature matches the Shell Autopilot's, so absorb feeds suggest", () => {
    const e = extractLogEntry("git push", "no upstream branch", 1);
    expect(e.signature).toBe(failureSignature("git push", 1, "no upstream branch"));
  });

  it("formatForCortex shapes an error as a warning fact keyed by signature", () => {
    const e = extractLogEntry("git push", "no upstream", 1);
    const f = formatForCortex(e);
    expect(f.kind).toBe("warning");
    expect(f.key.startsWith("log.error:")).toBe(true);
  });

  it("logpipe gauntlet scores 100", () => {
    const g = logpipeGauntlet();
    expect(g.extractsError).toBe(true);
    expect(g.extractsSuccess).toBe(true);
    expect(g.classifies).toBe(true);
    expect(g.signatureSharedWithAutopilot).toBe(true);
    expect(g.deterministic).toBe(true);
    expect(g.score).toBe(100);
  });

  it("STABILITY — total on garbage", () => {
    expect(() => extractLogEntry(null as never, null as never, null as never)).not.toThrow();
    expect(extractLogEntry(null as never, null as never, null as never).kind).toBe("success");
    expect(() => formatForCortex(null as never)).not.toThrow();
  });
});
