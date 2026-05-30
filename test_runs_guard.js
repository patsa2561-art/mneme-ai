// Can the runs check catch data with monobit=0.30 but no other issues?

console.log("=== Can 'runs' check compensate for loose monobit tolerance? ===\n");

// If we have 30% ones, 70% zeros in 512 bits, what's the expected run count?
const totalBits = 512;
const ones = Math.round(0.30 * totalBits);  // 154
const zeros = totalBits - ones;  // 358

console.log(`Data pattern: 154 ones, 358 zeros in 512 bits\n`);

// Most adversarial case for runs: alternate as much as possible
// With 154 ones and 358 zeros, best alternation is:
// 101010...10 repeating, which gives us roughly 2*(min(ones, zeros)) runs
const maxPossibleRuns = 2 * Math.min(ones, zeros);
const minPossibleRuns = 1; // All ones then all zeros

console.log(`Run count bounds: [${minPossibleRuns}, ${maxPossibleRuns}]`);
console.log(`Pass range for runsOk: [${(0.25*totalBits).toFixed(0)}, ${(0.75*totalBits).toFixed(0)}]`);
console.log(`  (which is [${0.25*totalBits}, ${0.75*totalBits}])`);
console.log();

// Example: maximally alternating bit pattern with 30% ones density
// This would have ~2*154 = 308 runs
console.log(`If bits are maximally alternated (Z, O, Z, O, ...):`);
console.log(`  Runs ≈ 2 * min(154, 358) = ${maxPossibleRuns}`);
console.log(`  Check: ${maxPossibleRuns} in [128, 384]? ${maxPossibleRuns >= 128 && maxPossibleRuns <= 384 ? '✓ PASSES' : '✗ FAILS'}`);
console.log();

// Example: worst case - all zeros first, then ones
const worstRuns = 1; // Just one transition
console.log(`If bits are grouped (all 0s then all 1s):`);
console.log(`  Runs = 1`);
console.log(`  Check: 1 in [128, 384]? ${worstRuns >= 128 && worstRuns <= 384 ? '✓ PASSES' : '✗ FAILS'}`);
console.log();

console.log("=== Conclusion ===");
console.log("The 'runs' check DOES catch clustering (grouped zeros/ones),");
console.log("so it requires SOME alternation. However:");
console.log("  - With 154 ones in 512 bits, even moderate alternation passes");
console.log("  - A cleverly constructed adversarial pattern could have:");
console.log("    • monobit=0.30 (loose monobit check passes)");
console.log("    • runs in valid range via alternation (runs check passes)");
console.log("    • Result: BIASED but PASSES both checks\n");

console.log("The three checks are NOT independent:");
console.log("  - A sample with few distinct byte values can have high entropy");
console.log("  - A sample with specific bit patterns can pass monobit+runs");
console.log("  - The minEntropy check (p_max) requires uniform byte distribution");
