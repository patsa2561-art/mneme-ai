/**
 * Sample-output verification — exercises the regex extractors against
 * realistic-looking source files and exposes the captured Entity shapes
 * via a deterministic snapshot. This is the "show me what it sees" test.
 */
import { describe, it, expect } from "vitest";
import { extractPythonShapes, extractGoShapes } from "./index.js";

const PYTHON_SAMPLE = `
"""util.py — invoice tools."""
from decimal import Decimal

def parse_amount(s: str) -> Decimal:
    return Decimal(s)

async def fetch_rate(currency: str) -> float:
    return 1.0

class Cache:
    def __init__(self, size: int = 100):
        self._size = size

    def get(self, key: str):
        return None

    @staticmethod
    def from_env() -> "Cache":
        return Cache()
`.trim();

const GO_SAMPLE = `
package invoice

import "fmt"

// ParseAmount converts the string to a value.
func ParseAmount(s string) int { return 0 }

// FetchRate returns the rate for a currency.
func FetchRate(currency string) (float64, error) { return 1.0, nil }

type Cache struct {
    size int
}

func NewCache(size int) *Cache { return &Cache{size: size} }

func (c *Cache) Get(key string) string { return "" }

func (c *Cache) Set(key string, val string) {
    fmt.Println(key, val)
}

func Map[T any, U any](xs []T, fn func(T) U) []U { return nil }
`.trim();

describe("sample output — Python + Go shapes side by side", () => {
  it("Python extractor surfaces parse_amount / fetch_rate / Cache + methods", () => {
    const out = extractPythonShapes(PYTHON_SAMPLE, "py/util.py");
    const summary = out.map((e) => `${e.kind}:${e.name}`).sort();
    expect(summary).toContain("function:parse_amount");
    expect(summary).toContain("function:fetch_rate");
    expect(summary).toContain("class:Cache");
    expect(summary).toContain("function:get");
    expect(summary).toContain("function:from_env");
  });

  it("Go extractor surfaces ParseAmount / FetchRate / NewCache + methods + generic Map", () => {
    const out = extractGoShapes(GO_SAMPLE, "go/invoice.go");
    const names = out.map((e) => e.name).sort();
    expect(names).toContain("ParseAmount");
    expect(names).toContain("FetchRate");
    expect(names).toContain("NewCache");
    expect(names).toContain("Cache.Get");
    expect(names).toContain("Cache.Set");
    expect(names).toContain("Map");
  });

  it("each detected shape is decorated with file path, language, and a 1-based line number", () => {
    const py = extractPythonShapes(PYTHON_SAMPLE, "py/util.py");
    const go = extractGoShapes(GO_SAMPLE, "go/invoice.go");
    for (const e of [...py, ...go]) {
      expect(e.filePath).toBeTruthy();
      expect(["python", "go"]).toContain(e.language);
      expect(e.startLine).toBeGreaterThanOrEqual(1);
      expect(e.signature).toBeTruthy();
    }
  });
});
