import { describe, it, expect } from "vitest";
import { quantumRank, type FileTensor } from "./quantum-rank.js";

describe("A3. Quantum Superposition Rank", () => {
  // 3 files, 2 features, 2 intents
  const FILES: FileTensor[] = [
    { id: "fileA", matrix: [[1, 0], [0, 1]] }, // strong feat0 on intent0; strong feat1 on intent1
    { id: "fileB", matrix: [[0, 1], [1, 0]] },
    { id: "fileC", matrix: [[0.5, 0.5], [0.5, 0.5]] },
  ];

  it("ranks differently based on intent vector (the 'superposition' core)", () => {
    // Intent fully on intent0 → fileA should win (high feat0 on intent0)
    const r1 = quantumRank({
      files: FILES,
      queryFeatures: [1, 0],
      intentVector: [1, 0],
    });
    expect(r1[0]!.id).toBe("fileA");

    // Intent fully on intent1 → fileB now wins
    const r2 = quantumRank({
      files: FILES,
      queryFeatures: [1, 0],
      intentVector: [0, 1],
    });
    expect(r2[0]!.id).toBe("fileB");
  });

  it("identical intent + features for all files → tied scores", () => {
    const equalFiles: FileTensor[] = [
      { id: "x", matrix: [[1, 1], [1, 1]] },
      { id: "y", matrix: [[1, 1], [1, 1]] },
    ];
    const r = quantumRank({
      files: equalFiles,
      queryFeatures: [1, 1],
      intentVector: [0.5, 0.5],
    });
    expect(r[0]!.score).toBeCloseTo(r[1]!.score);
  });

  it("operator mode (QRS-based) — applies H matrix correctly", () => {
    const H = [[1, 0], [0, 1]]; // identity → score = ||collapsed||²
    const r = quantumRank({
      files: FILES,
      queryFeatures: [1, 1], // ignored when operator is set
      intentVector: [1, 0],
      queryOperator: H,
    });
    // fileA collapsed under intent[1,0] = [1, 0], ||·||² = 1
    // fileB collapsed = [0, 1], ||·||² = 1
    // fileC collapsed = [0.5, 0.5], ||·||² = 0.5
    expect(r[0]!.score).toBeCloseTo(1);
    expect(r[r.length - 1]!.id).toBe("fileC");
  });

  it("empty files → empty result", () => {
    expect(quantumRank({ files: [], queryFeatures: [1], intentVector: [1] })).toEqual([]);
  });

  it("throws on dimension mismatch (rows)", () => {
    expect(() => quantumRank({
      files: [{ id: "x", matrix: [[1, 0]] }], // 1 feature row
      queryFeatures: [1, 1], // 2 features
      intentVector: [1, 0],
    })).toThrow(/feature rows/);
  });

  it("throws on dimension mismatch (cols)", () => {
    expect(() => quantumRank({
      files: [{ id: "x", matrix: [[1, 0, 1], [1, 0, 1]] }], // 3 cols
      queryFeatures: [1, 1],
      intentVector: [1, 0], // 2 intents
    })).toThrow(/cols/);
  });

  it("throws on operator size mismatch", () => {
    expect(() => quantumRank({
      files: FILES,
      queryFeatures: [1, 0],
      intentVector: [1, 0],
      queryOperator: [[1]], // wrong size
    })).toThrow(/operator size/);
  });

  it("deterministic for the same inputs", () => {
    const a = quantumRank({ files: FILES, queryFeatures: [1, 0.5], intentVector: [0.4, 0.6] });
    const b = quantumRank({ files: FILES, queryFeatures: [1, 0.5], intentVector: [0.4, 0.6] });
    expect(a).toEqual(b);
  });
});
