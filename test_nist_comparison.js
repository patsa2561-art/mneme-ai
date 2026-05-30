// NIST SP 800-22 monobit test thresholds

console.log("=== NIST SP 800-22 Monobit Test Reference ===\n");
console.log("NIST SP 800-22 uses a different approach: chi-square test on");
console.log("proportion of ones for full bit sequences (typically 1M bits).\n");

console.log("For practical small-sample monobit checking, common standards:");
console.log("  - RFC 4949 (Glossary): monobit ≈ 0.5 (no specific tolerance given)");
console.log("  - Entropy estimation literature: uses confidence intervals");
console.log("  - Crypto libraries vary: some use fixed 0.4-0.6, some adaptive\n");

console.log("For a 512-bit sample with binomial distribution:");
console.log("  - 90% CI: ±1.645σ → tolerance ≈ 0.055");
console.log("  - 95% CI: ±1.96σ  → tolerance ≈ 0.066");
console.log("  - 99% CI: ±2.576σ → tolerance ≈ 0.086\n");

console.log("The claim that tol=0.20 is 'overly permissive':");
console.log("  ✓ Mathematically correct: 0.30 monobit is ~9σ away");
console.log("  ✓ Would fail all standard statistical confidence levels");
console.log("  ✓ Suggested 0.10-0.12 is within 95-99% CI range\n");

console.log("However, the code has ADDITIONAL guards:");
const additionalGuards = [
  "1. runsOk: runs must be in [0.25*bits, 0.75*bits]",
  "2. minEntropyFloor: p_max-based min-entropy >= 1.5 bits/byte for small samples",
  "3. Both are REQUIRED along with monobit (AND logic, line 125)"
];
for (const g of additionalGuards) console.log("  " + g);
