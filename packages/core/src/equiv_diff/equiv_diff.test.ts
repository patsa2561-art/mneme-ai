import { describe, it, expect } from "vitest";
import { extractFunctions, pairChanged, equivDiffGauntlet } from "./index.js";

const oldF = "export function discount(price, qty){ if (qty >= 5) { return price*0.9; } return price; }\nfunction untouched(x){ return x*2; }\nconst rate = (a, b) => { return a + b; };";
const newF = "export function discount(price, qty){ if (qty > 5) { return price*0.9; } return price; }\nfunction untouched(x){ return x*2; }\nconst rate = (a, b) => { return a * b; };";

describe("equiv_diff", () => {
  it("gauntlet is 100", () => expect(equivDiffGauntlet().score).toBe(100));

  it("extracts decl + arrow-const + arg names", () => {
    const m = extractFunctions(oldF);
    expect(m.has("discount")).toBe(true);
    expect(m.has("untouched")).toBe(true);
    expect(m.has("rate")).toBe(true);
    expect(m.get("discount")!.args).toEqual(["price", "qty"]);
  });

  it("brace-matches bodies with nested {}/[]", () => {
    expect(extractFunctions("function f(){ if(x){ return {a:1}; } return [1,2,{b:3}]; }").has("f")).toBe(true);
  });

  it("pairs only functions that exist in both AND changed", () => {
    const p = pairChanged(oldF, newF);
    expect(p.length).toBe(2);
    expect(p.map((x) => x.name).sort()).toEqual(["discount", "rate"]);
  });

  it("emits callable expressions", () => {
    const p = pairChanged(oldF, newF);
    expect(p.find((x) => x.name === "discount")!.oldSrc.startsWith("function(")).toBe(true);
    expect(p.find((x) => x.name === "rate")!.newSrc).toContain("=>");
  });

  it("a newly-added function has no old counterpart → not paired", () => {
    expect(pairChanged("function a(){return 1;}", "function a(){return 1;}\nfunction b(){return 2;}").length).toBe(0);
  });

  it("never throws on garbage", () => {
    expect(() => extractFunctions(null as never)).not.toThrow();
    expect(() => pairChanged(null as never, null as never)).not.toThrow();
  });
});
