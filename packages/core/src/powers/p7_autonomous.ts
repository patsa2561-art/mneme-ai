/**
 * POWER 7 — AUTONOMOUS ECONOMY (v1.48.0)
 *
 * The 60/20/10/10 treasury allocation models how Mneme's revenue (when
 * it eventually exists) routes itself: R&D / bug-bounty / vendor outreach /
 * validator yield. This module SIMULATES the math today so the
 * governance contract can be specified before any real revenue lands.
 *
 * IDEA-CHEST:
 *   - Allocations are policy-driven; a future on-chain policy contract
 *     just plugs into this same simulator API.
 *   - "Sustainability runway" = months of operation at current burn,
 *     given a hypothetical revenue stream. Surface it so we don't
 *     architect feature creep that the treasury can't pay for.
 *   - Add a 4th-quarter "rainy day" reservoir: no autonomous transfer
 *     ever drains the treasury below 6 months of runway -- prevents
 *     a runaway DAO bot from bankrupting the protocol.
 */

export interface TreasuryPolicy {
  rdSplit: number;            // default 0.60
  bountySplit: number;        // 0.20
  bdSplit: number;            // 0.10
  validatorSplit: number;     // 0.10
  /** Floor (in dollars) below which the treasury never auto-spends. */
  rainyDayFloorUsd: number;
  /** Burn estimate (USD/month) used to compute the runway gauge. */
  monthlyBurnUsd: number;
}

export const DEFAULT_TREASURY_POLICY: TreasuryPolicy = {
  rdSplit: 0.60,
  bountySplit: 0.20,
  bdSplit: 0.10,
  validatorSplit: 0.10,
  rainyDayFloorUsd: 50_000,
  monthlyBurnUsd: 8_000,        // conservative solo-dev cloud + tooling
};

export interface AllocationResult {
  inputs: { incomingRevenueUsd: number; treasuryStartUsd: number; policy: TreasuryPolicy };
  /** Per-bucket auto-spends after rainy-day rule applied. */
  rd: number;
  bounty: number;
  bd: number;
  validator: number;
  reserved: number;             // amount held back for rainy-day floor
  treasuryEndUsd: number;
  runwayMonths: number;
  reasoning: string;
}

export function allocateRevenue(
  incomingRevenueUsd: number,
  treasuryStartUsd: number,
  policy: TreasuryPolicy = DEFAULT_TREASURY_POLICY,
): AllocationResult {
  const splitsTotal = policy.rdSplit + policy.bountySplit + policy.bdSplit + policy.validatorSplit;
  if (Math.abs(splitsTotal - 1) > 0.001) {
    throw new Error(`treasury splits must sum to 1.0 (got ${splitsTotal.toFixed(3)})`);
  }
  const startingTotal = treasuryStartUsd + incomingRevenueUsd;
  // Reserve enough to never drop below the rainy-day floor.
  const spendable = Math.max(0, startingTotal - policy.rainyDayFloorUsd);
  const rd = +(spendable * policy.rdSplit).toFixed(2);
  const bounty = +(spendable * policy.bountySplit).toFixed(2);
  const bd = +(spendable * policy.bdSplit).toFixed(2);
  const validator = +(spendable * policy.validatorSplit).toFixed(2);
  const reserved = +(startingTotal - rd - bounty - bd - validator).toFixed(2);
  const treasuryEndUsd = +(reserved).toFixed(2);
  const runwayMonths = policy.monthlyBurnUsd > 0 ? +(treasuryEndUsd / policy.monthlyBurnUsd).toFixed(2) : Number.POSITIVE_INFINITY;

  const reasoning = startingTotal <= policy.rainyDayFloorUsd
    ? `treasury below rainy-day floor of $${policy.rainyDayFloorUsd.toLocaleString()}; NO auto-allocation this period.`
    : `Allocated $${(rd + bounty + bd + validator).toFixed(0)} per policy (${(splitsTotal * 100).toFixed(0)}% of $${spendable.toFixed(0)} spendable). Reserved $${reserved.toFixed(0)} for rainy day. Runway: ${runwayMonths} months.`;

  return {
    inputs: { incomingRevenueUsd, treasuryStartUsd, policy },
    rd, bounty, bd, validator, reserved,
    treasuryEndUsd,
    runwayMonths,
    reasoning,
  };
}

/** Project N months forward at fixed monthly revenue. Gives a feel for
 *  whether the policy converges to sustainability or whether the
 *  monthly burn will eat the treasury. */
export function projectTreasury(
  startingTreasuryUsd: number,
  monthlyRevenueUsd: number,
  months: number,
  policy: TreasuryPolicy = DEFAULT_TREASURY_POLICY,
): { month: number; treasury: number; rd: number; bounty: number; bd: number; validator: number }[] {
  const out: { month: number; treasury: number; rd: number; bounty: number; bd: number; validator: number }[] = [];
  let treasury = startingTreasuryUsd;
  for (let m = 1; m <= months; m++) {
    const a = allocateRevenue(monthlyRevenueUsd, treasury, policy);
    treasury = a.treasuryEndUsd;
    out.push({ month: m, treasury, rd: a.rd, bounty: a.bounty, bd: a.bd, validator: a.validator });
  }
  return out;
}

/** Render a simple text projection for the CLI. */
export function renderProjectionText(rows: ReturnType<typeof projectTreasury>): string {
  const lines: string[] = [];
  lines.push(`month  treasury($)    rd($)    bounty($)  bd($)   validator($)`);
  lines.push(`-----  ------------   ------   ---------  ------  ------------`);
  for (const r of rows) {
    lines.push(`${String(r.month).padStart(5)}  ${r.treasury.toFixed(0).padStart(11)}   ${r.rd.toFixed(0).padStart(6)}   ${r.bounty.toFixed(0).padStart(7)}   ${r.bd.toFixed(0).padStart(5)}   ${r.validator.toFixed(0).padStart(10)}`);
  }
  return lines.join("\n");
}
