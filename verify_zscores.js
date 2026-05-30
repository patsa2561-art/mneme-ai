// Calculate z-scores for the actual test case that PASSED

const sampleBytes = 64;
const totalBits = sampleBytes * 8;  // 512

const observedMonobit = 0.301;
const observedOnes = Math.round(observedMonobit * totalBits);

console.log("=== Z-score Analysis (actual passing case) ===\n");
console.log(`Sample: 64 bytes = 512 bits`);
console.log(`Observed: ${observedOnes} ones out of ${totalBits} bits`);
console.log(`Monobit: ${observedMonobit.toFixed(3)}`);
console.log();

// Binomial: X ~ B(512, 0.5)
const n = totalBits;
const p = 0.5;
const mu = n * p;
const variance = n * p * (1-p);
const sigma = Math.sqrt(variance);

const zScore = (observedOnes - mu) / sigma;

console.log(`Under random hypothesis (p=0.5):`);
console.log(`  μ = ${mu}`);
console.log(`  σ = ${sigma.toFixed(2)}`);
console.log(`  Z = (${observedOnes} - ${mu}) / ${sigma.toFixed(2)} = ${zScore.toFixed(2)}`);
console.log();
console.log(`This monobit=0.301 is ${Math.abs(zScore).toFixed(1)} standard deviations`);
console.log(`from random! This would occur in truly random data with p < 10^-18.`);
console.log();
console.log(`Yet it PASSES the monobit check because:`);
console.log(`  |0.301 - 0.5| = 0.199 < 0.20 (the tolerance)\n`);
console.log(`Statistical 95% CI would be: ±${(1.96*sigma/totalBits).toFixed(4)} = ±${(1.96*sigma/totalBits*100).toFixed(2)}%`);
console.log(`The 0.20 tolerance is ~3x looser than statistically appropriate.`);
