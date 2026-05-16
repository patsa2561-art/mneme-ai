import { describe, it, expect } from "vitest";
import {
  createChimera,
  classifyDomain,
  chimeraEmbed,
  disagreementCheck,
  listChimeraDomains,
  formatChimeraLine,
  DOMAINS,
} from "./index.js";

const TS_SAMPLE = `import { foo } from "./bar";
export interface UserConfig {
  name: string;
  age: number;
}
const greet = (u: UserConfig) => \`Hello \${u.name}\`;`;

const PY_SAMPLE = `import math
class Animal:
    def __init__(self, name):
        self.name = name
    def speak(self):
        return f"{self.name} says hi"

def main():
    a = Animal("dog")
    print(a.speak())
`;

const GO_SAMPLE = `package main
import "fmt"
type Greeter interface {
  Greet() string
}
type User struct {
  Name string
  Age  int
}
func (u User) Greet() string { return "Hi " + u.Name }
ch := make(chan int)`;

const MD_SAMPLE = `# Mneme README

Welcome to **Mneme** — the memory layer for AI agents.

## Features

- one
- two

\`\`\`ts
const x = 1;
\`\`\`

See [docs](https://mneme.ai) for more.`;

const PROSE_SAMPLE = `Yesterday I went to the park. The weather was lovely and I sat by the fountain reading a book about the history of bicycles.`;

describe("v2.19.14 CHIMERA EMBEDDER · createChimera", () => {
  it("creates 5 SNN instances, one per domain, with distinct seeds", () => {
    const c = createChimera();
    expect(Object.keys(c.embedders).sort()).toEqual([...DOMAINS].sort());
    const seeds = DOMAINS.map((d) => c.embedders[d].config.seed);
    expect(new Set(seeds).size).toBe(5); // all distinct
  });

  it("listChimeraDomains reports per-domain config", () => {
    const c = createChimera();
    const list = listChimeraDomains(c);
    expect(list).toHaveLength(5);
    expect(list.every((x) => x.dimension === 2048)).toBe(true);
  });
});

describe("v2.19.14 CHIMERA EMBEDDER · classifyDomain", () => {
  it("classifies TypeScript correctly", () => {
    const c = classifyDomain({ text: TS_SAMPLE });
    expect(c.domain).toBe("typescript");
    expect(c.scoreboard.typescript).toBeGreaterThan(c.scoreboard.python);
    expect(c.scoreboard.typescript).toBeGreaterThan(c.scoreboard.go);
  });

  it("classifies Python correctly", () => {
    const c = classifyDomain({ text: PY_SAMPLE });
    expect(c.domain).toBe("python");
    expect(c.scoreboard.python).toBeGreaterThan(c.scoreboard.typescript);
  });

  it("classifies Go correctly", () => {
    const c = classifyDomain({ text: GO_SAMPLE });
    expect(c.domain).toBe("go");
    expect(c.scoreboard.go).toBeGreaterThan(c.scoreboard.python);
  });

  it("classifies Markdown correctly", () => {
    const c = classifyDomain({ text: MD_SAMPLE });
    expect(c.domain).toBe("markdown");
    expect(c.scoreboard.markdown).toBeGreaterThan(c.scoreboard.typescript);
  });

  it("falls back to prose for neutral text with no markers", () => {
    const c = classifyDomain({ text: PROSE_SAMPLE });
    expect(c.domain).toBe("prose");
  });

  it("filenameHint adds +5 to that domain — overrides weak signal", () => {
    const c = classifyDomain({ text: PROSE_SAMPLE, filenameHint: "notes.py" });
    expect(c.domain).toBe("python");
    expect(c.scoreboard.python).toBeGreaterThanOrEqual(5);
  });

  it("returns a [0,1] confidence proportional to top-score share", () => {
    const c = classifyDomain({ text: TS_SAMPLE });
    expect(c.confidence).toBeGreaterThan(0);
    expect(c.confidence).toBeLessThanOrEqual(1);
  });
});

describe("v2.19.14 CHIMERA EMBEDDER · chimeraEmbed routing", () => {
  it("routes TS sample to the typescript SNN", () => {
    const c = createChimera();
    const r = chimeraEmbed({ chimera: c, text: TS_SAMPLE });
    expect(r.routedDomain).toBe("typescript");
    expect(r.vector.length).toBe(2048);
  });

  it("forceDomain overrides classifier (caller knows better)", () => {
    const c = createChimera();
    const r = chimeraEmbed({ chimera: c, text: TS_SAMPLE, forceDomain: "go" });
    expect(r.routedDomain).toBe("go");
    // classification still reflects the original signal
    expect(r.classification.domain).toBe("typescript");
  });

  it("same text routed twice → same vector (determinism within a domain)", () => {
    const c = createChimera();
    const a = chimeraEmbed({ chimera: c, text: PY_SAMPLE }).vector;
    const b = chimeraEmbed({ chimera: c, text: PY_SAMPLE }).vector;
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("same text routed to different domains → different vectors (per-domain phenotype)", () => {
    const c = createChimera();
    const ts = chimeraEmbed({ chimera: c, text: TS_SAMPLE, forceDomain: "typescript" }).vector;
    const py = chimeraEmbed({ chimera: c, text: TS_SAMPLE, forceDomain: "python" }).vector;
    expect(Array.from(ts)).not.toEqual(Array.from(py));
  });
});

describe("v2.19.14 CHIMERA EMBEDDER · disagreementCheck", () => {
  it("reports cosineSimilarity + cosineDistance + ambiguous flag", () => {
    const c = createChimera();
    const r = disagreementCheck({ chimera: c, text: "hello world", domainA: "typescript", domainB: "python" });
    expect(r.cosineSimilarity).toBeGreaterThanOrEqual(-1);
    expect(r.cosineSimilarity).toBeLessThanOrEqual(1);
    expect(r.cosineDistance).toBeCloseTo(1 - r.cosineSimilarity, 6);
    expect(typeof r.ambiguous).toBe("boolean");
  });

  it("custom threshold tightens or relaxes the ambiguity bar", () => {
    const c = createChimera();
    const strict = disagreementCheck({ chimera: c, text: "hello world", domainA: "typescript", domainB: "python", threshold: 0.01 });
    const lax = disagreementCheck({ chimera: c, text: "hello world", domainA: "typescript", domainB: "python", threshold: 0.99 });
    // strict threshold makes ambiguous=true more likely; lax makes it false
    expect(strict.threshold).toBe(0.01);
    expect(lax.threshold).toBe(0.99);
    expect(lax.ambiguous).toBe(false);
  });

  it("disagreement on the same domain pair on the same text is symmetric (cosine is)", () => {
    const c = createChimera();
    const ab = disagreementCheck({ chimera: c, text: TS_SAMPLE, domainA: "typescript", domainB: "python" });
    const ba = disagreementCheck({ chimera: c, text: TS_SAMPLE, domainA: "python", domainB: "typescript" });
    expect(ab.cosineSimilarity).toBeCloseTo(ba.cosineSimilarity, 6);
  });
});

describe("v2.19.14 CHIMERA EMBEDDER · formatter", () => {
  it("formatter shows domain + confidence + scoreboard", () => {
    const c = classifyDomain({ text: TS_SAMPLE });
    const line = formatChimeraLine(c);
    expect(line).toContain("🧪");
    expect(line).toContain("typescript");
    expect(line).toContain("conf=");
  });
});
