// Verify the monobit tolerance claim numerically

// Test case: 64-byte sample (512 bits) with monobit=0.30
const sampleSizeBytes = 64;
const totalBits = sampleSizeBytes * 8; // 512
const monobits = 0.30; // 30% ones
const observedOnes = Math.round(monobits * totalBits); // ~154

console.log("=== Monobit Tolerance Analysis ===\n");
console.log(`Sample size: ${sampleSizeBytes} bytes = ${totalBits} bits`);
console.log(`Monobit value: ${monobits} (${observedOnes} ones out of ${totalBits} bits)`);
console.log(`Expected (random): 0.5 (${totalBits/2} ones)`);
console.log();

// Binomial distribution: X ~ B(n, p=0.5)
const n = totalBits;
const p = 0.5;
const mu = n * p; // Expected ones
const variance = n * p * (1-p);
const sigma = Math.sqrt(variance);

console.log(`Binomial statistics (null hypothesis: random, p=0.5):`);
console.log(`  Expected ones (μ): ${mu}`);
console.log(`  Variance (σ²): ${variance}`);
console.log(`  Std Dev (σ): ${sigma.toFixed(2)}`);
console.log();

// Z-score calculation
const zScore = (observedOnes - mu) / sigma;
console.log(`Z-score for monobit=0.30: ${zScore.toFixed(2)} standard deviations`);
console.log(`  P(|Z| ≥ ${Math.abs(zScore).toFixed(2)}) ≈ ${pValue(Math.abs(zScore)).toExponential(2)}`);
console.log();

// Tolerance analysis
const currentTol = 0.20;
const monobitsPassingCurrent = Math.abs(monobits - 0.5) <= currentTol;
console.log(`Current code tolerance: ${currentTol}`);
console.log(`  |${monobits} - 0.5| = ${Math.abs(monobits - 0.5)} <= ${currentTol}? ${monobitsPassingCurrent}`);
console.log(`  ⚠️  PASSES with extremely biased data (${Math.abs(zScore).toFixed(1)} σ away)!`);
console.log();

// What tolerance would be statistically appropriate?
// 95% confidence: z=1.96 → tolerance = 1.96 * sigma / n_bits
const tol95CI = 1.96 * sigma / totalBits;
const tol99_7CI = 3.0 * sigma / totalBits; // 3-sigma
const tolClaim = 0.11; // midpoint of claimed 0.10-0.12

console.log(`Statistical tolerances for small samples (512 bits):`);
console.log(`  95% CI (z=1.96): ${tol95CI.toFixed(4)} (${(tol95CI*100).toFixed(2)}%)`);
console.log(`  99.7% CI (3σ):   ${tol99_7CI.toFixed(4)} (${(tol99_7CI*100).toFixed(2)}%)`);
console.log(`  Claim (0.10-0.12): ${tolClaim} (${(tolClaim*100).toFixed(0)}%)`);
console.log();

// Test what monobits values would pass/fail under different thresholds
console.log(`Monobit pass/fail boundaries:`);
const testTols = [0.05, 0.10, 0.11, 0.12, 0.15, 0.20];
for (const tol of testTols) {
  const bounds = [0.5 - tol, 0.5 + tol];
  const range = `[${bounds[0].toFixed(3)}, ${bounds[1].toFixed(3)}]`;
  const mon030Passes = Math.abs(0.30 - 0.5) <= tol;
  console.log(`  tol=${tol.toFixed(2)}: ${range} - monobit=0.30 ${mon030Passes ? '✓ PASSES' : '✗ FAILS'}`);
}
console.log();

// Additional sample sizes
console.log(`Tolerance across sample sizes (at tolerance=${currentTol}):`);
for (const bytes of [16, 32, 64, 128, 256, 512]) {
  const bits = bytes * 8;
  const meanBits = bits / 2;
  const var2 = bits * 0.25;
  const sigma2 = Math.sqrt(var2);
  const zFor020 = (0.30 * bits - meanBits) / sigma2;
  const passFor020 = Math.abs(0.30 - 0.5) <= currentTol;
  console.log(`  ${bytes.toString().padStart(3)} bytes: monobit=0.30 has z=${zFor020.toFixed(1)} σ - ${passFor020 ? 'PASSES' : 'FAILS'}`);
}

// Helper: approximate p-value from z-score (two-tailed normal)
function pValue(z) {
  // Φ(-|z|) for standard normal (very simplified)
  const absZ = Math.abs(z);
  if (absZ > 8) return 0;
  // Using error function approximation
  const erfApprox = Math.tanh(1.202 * absZ);
  return 1 - erfApprox;
}
