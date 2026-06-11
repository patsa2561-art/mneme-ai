import { describe, it, expect } from "vitest";
import { mineScars, scarMiningGauntlet, type MineCommit } from "./index.js";

const history: MineCommit[] = [
  { sha: "aaaa1111", message: "add retry wrapper around charge", files: ["payments/retry.ts"], added: ["chargeWithRetry", "retry", "charge"] },
  { sha: "bbbb2222", message: "fix: retry double-charged — add idempotency key", files: ["payments/retry.ts"], added: ["idempotencyKey", "chargeWithRetry"] },
  { sha: "cccc3333", message: "chore: unrelated", files: ["README.md"], added: ["documentation"] },
];

describe("scar_mining", () => {
  it("gauntlet is 100", () => expect(scarMiningGauntlet().score).toBe(100));

  it("mines a scar from a fix+mistake pair sharing a file", () => {
    const scars = mineScars(history);
    const s = scars.find((x) => x.files.some((f) => /retry/.test(f)));
    expect(s).toBeTruthy();
    expect(s!.triggers.some((t) => /retry|charge/i.test(t))).toBe(true);
    expect(s!.antibodies.some((a) => /idempotency/i.test(a))).toBe(true);
    expect(s!.severity === "high" || s!.severity === "critical").toBe(true);
  });

  it("mined scars are vaccine-compatible (drop into scar_vaccine)", () => {
    const s = mineScars(history)[0];
    expect(s).toHaveProperty("triggers");
    expect(s).toHaveProperty("antibodies");
    expect(s).toHaveProperty("lesson");
    expect(s.id.startsWith("SCAR-")).toBe(true);
  });

  it("hotfix/incident/revert → critical severity", () => {
    const s = mineScars([
      { sha: "x", message: "add q", files: ["a.ts"], added: ["queryThing", "loopVar"] },
      { sha: "y", message: "hotfix: prod incident — batch the query", files: ["a.ts"], added: ["batchQuery"] },
    ]);
    expect(s[0]?.severity).toBe("critical");
  });

  it("no fix commit, no shared file, or <2 commits → no scars", () => {
    expect(mineScars([{ sha: "a", message: "feat", files: ["a.ts"], added: ["alpha"] }, { sha: "b", message: "feat", files: ["a.ts"], added: ["beta"] }]).length).toBe(0);
    expect(mineScars([{ sha: "a", message: "feat", files: ["a.ts"], added: ["alpha"] }, { sha: "b", message: "fix: b", files: ["b.ts"], added: ["beta"] }]).length).toBe(0);
    expect(mineScars([{ sha: "a", message: "fix: x", files: ["a.ts"], added: ["z"] }]).length).toBe(0);
  });

  it("never throws on garbage", () => {
    expect(() => mineScars(null as never)).not.toThrow();
    expect(mineScars([]).length).toBe(0);
  });
});
