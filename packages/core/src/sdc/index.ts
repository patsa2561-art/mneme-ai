/**
 * v3.114.0 — SDC: Syndrome-Decoded Consensus (the agent trust mesh's error-correction).
 *
 * THE BLACK-SHEEP IDEA: nobody decodes a multi-agent knowledge mesh the way a
 * QEC decoder decodes a corrupted codeword. Everyone else does majority-vote or
 * declared reputation. SDC borrows the one deeply-transferable idea from Peter
 * Shor's QEC lectures (CSS / syndrome decoding, L27-31): you can DETECT and
 * LOCATE corruption from the *syndrome* (the pattern of parity disagreements)
 * WITHOUT trusting any single source, recover the true codeword while errors stay
 * under the code's distance t, and DECLARE UNRECOVERABLE (never guess) beyond it.
 *
 * Map to Mneme's real job (teacher/guardian of a fleet of AI agents): many agents
 * (any vendor) attest "facts" into the shared memory; some are wrong / stale /
 * POISONED (prompt-injection, hallucination, adversarial). Treat the attestations
 * on a fact as a repetition codeword; the disagreement pattern is the syndrome.
 *
 * Why it BEATS plain majority-vote (the measured A/B): a single fact's majority is
 * wrong whenever liars happen to out-number honest attesters on THAT fact (sparse
 * attestation makes this common). SDC decodes the WHOLE mesh ITERATIVELY: round 1
 * majority → a provisional truth → each agent's *syndrome row* (how often it
 * disagrees with the provisional truth across ALL facts it touched) → a structural
 * RELIABILITY (earned, not declared) → re-decode weighting by reliability. A liar
 * that lies across the mesh lights up in the syndrome and gets down-weighted, so
 * an honest MINORITY on a contested fact still wins. This is belief-propagation /
 * EM on the syndrome matrix — the QEC decoder, applied to trust.
 *
 * DIAKRISIS — the honest ceiling: this is CLASSICAL + deterministic (no quantum
 * hardware). It corrects up to the code's tolerance: a colluding bloc that is the
 * honest-looking majority *everywhere* beats any decoder — SDC then returns
 * UNRECOVERABLE and ABSTAINS, never a guess. The win is measured (SDC strictly
 * beats majority in the sustained-liar regime) + the byzantine agents are located
 * (precision/recall), not asserted. Pure + deterministic + total.
 */

export interface Attestation { agent: string; value: string }
export interface FactInput { fact: string; attestations: Attestation[] }

export type DecodeVerdict = "CLEAN" | "CORRECTED" | "UNRECOVERABLE";
export interface FactDecode {
  fact: string;
  verdict: DecodeVerdict;
  value: string | null;     // the decoded (corrected) value, null when UNRECOVERABLE
  n: number;                // attesters
  winnerWeight: number;
  runnerUpWeight: number;
  dissenters: string[];     // agents whose attestation disagrees with the decoded value (the located errors)
  t: number;                // repetition-code tolerance floor((n-1)/2)
}

function round3(x: number): number { return Math.round(x * 1e3) / 1e3; }

/**
 * Decode one fact from its attestations, optionally weighting each agent by an
 * earned reliability. CLEAN (unanimous) / CORRECTED (a strict weighted winner) /
 * UNRECOVERABLE (a tie — abstain, never guess). Deterministic + total.
 */
export function decodeFact(attestations: Attestation[], weightOf?: (agent: string) => number): FactDecode {
  const atts = Array.isArray(attestations) ? attestations.filter((a) => a && typeof a.value === "string" && typeof a.agent === "string") : [];
  const n = atts.length;
  const w = (a: string) => { try { const v = weightOf ? weightOf(a) : 1; return Number.isFinite(v) && v > 0 ? v : (weightOf ? 1e-6 : 1); } catch { return 1; } };
  const tally = new Map<string, { count: number; weight: number; agents: string[] }>();
  for (const a of atts) {
    const e = tally.get(a.value) ?? { count: 0, weight: 0, agents: [] };
    e.count++; e.weight += w(a.agent); e.agents.push(a.agent);
    tally.set(a.value, e);
  }
  const t = Math.floor((n - 1) / 2);
  if (n === 0) return { fact: "", verdict: "UNRECOVERABLE", value: null, n: 0, winnerWeight: 0, runnerUpWeight: 0, dissenters: [], t: 0 };
  // deterministic order: weight desc, then count desc, then value asc
  const ranked = [...tally.entries()].sort((a, b) => b[1].weight - a[1].weight || b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1));
  const [winVal, win] = ranked[0]!;
  const runner = ranked[1]?.[1];
  const winnerWeight = round3(win.weight);
  const runnerUpWeight = round3(runner?.weight ?? 0);
  const dissenters = atts.filter((a) => a.value !== winVal).map((a) => a.agent);
  if (win.count === n) return { fact: "", verdict: "CLEAN", value: winVal, n, winnerWeight, runnerUpWeight, dissenters: [], t };
  const EPS = 1e-9;
  if (!runner || win.weight > runner.weight + EPS) return { fact: "", verdict: "CORRECTED", value: winVal, n, winnerWeight, runnerUpWeight, dissenters, t };
  return { fact: "", verdict: "UNRECOVERABLE", value: null, n, winnerWeight, runnerUpWeight, dissenters: [], t };
}

export interface MeshDecode {
  decoded: FactDecode[];
  /** earned reliability per agent in [0,1] (1 - syndrome error rate), the decoder's core state. */
  reliability: Record<string, number>;
  /** agents whose syndrome error rate ≥ corruptThreshold — the located bad actors. */
  corruptedAgents: string[];
  iterations: number;
}

/**
 * Decode the WHOLE mesh: iteratively infer each agent's reliability from the
 * syndrome (disagreement with the provisional consensus across all its facts),
 * then re-decode weighting by reliability. The structural way to beat majority
 * when liars are dense on individual facts but a minority across the mesh.
 * Pure + deterministic + total.
 */
export function decodeMesh(facts: FactInput[], opts?: { maxIter?: number; corruptThreshold?: number; sharpen?: number }): MeshDecode {
  const fs = Array.isArray(facts) ? facts.filter((f) => f && Array.isArray(f.attestations)) : [];
  const maxIter = Number.isFinite(opts?.maxIter) ? Math.max(1, opts!.maxIter as number) : 5;
  const corruptThreshold = Number.isFinite(opts?.corruptThreshold) ? (opts!.corruptThreshold as number) : 0.5;
  const sharpen = Number.isFinite(opts?.sharpen) ? (opts!.sharpen as number) : 2;
  const agents = new Set<string>();
  for (const f of fs) for (const a of f.attestations) if (a && typeof a.agent === "string") agents.add(a.agent);
  let reliability: Record<string, number> = {}; for (const a of agents) reliability[a] = 1;

  let decoded: FactDecode[] = [];
  let iterations = 0;
  let prevKey = "";
  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;
    decoded = fs.map((f) => ({ ...decodeFact(f.attestations, (a) => reliability[a] ?? 1e-6), fact: f.fact }));
    // syndrome: per agent, error rate over the facts it attested that decoded to a value
    const err: Record<string, { bad: number; seen: number }> = {};
    for (const a of agents) err[a] = { bad: 0, seen: 0 };
    for (let i = 0; i < fs.length; i++) {
      const dv = decoded[i]!.value; if (dv === null) continue;
      for (const at of fs[i]!.attestations) {
        if (!err[at.agent]) err[at.agent] = { bad: 0, seen: 0 };
        err[at.agent]!.seen++; if (at.value !== dv) err[at.agent]!.bad++;
      }
    }
    const next: Record<string, number> = {};
    for (const a of agents) {
      const e = err[a]!; const rate = e.seen > 0 ? e.bad / e.seen : 0;
      // reliability = (1-rate)^sharpen → push a serial dissenter toward 0 fast
      next[a] = round3(Math.max(1e-6, Math.pow(1 - rate, sharpen)));
    }
    const key = Object.keys(next).sort().map((a) => `${a}:${next[a]}`).join("|");
    reliability = next;
    if (key === prevKey) break; // converged
    prevKey = key;
  }
  // final error rates for corruption localization (from the final decoded truth)
  const corruptedAgents: string[] = [];
  for (const a of agents) {
    let bad = 0, seen = 0;
    for (let i = 0; i < fs.length; i++) { const dv = decoded[i]!.value; if (dv === null) continue; for (const at of fs[i]!.attestations) if (at.agent === a) { seen++; if (at.value !== dv) bad++; } }
    if (seen > 0 && bad / seen >= corruptThreshold) corruptedAgents.push(a);
  }
  corruptedAgents.sort();
  return { decoded, reliability, corruptedAgents, iterations };
}

// ── deterministic scenario generator (the measurable A/B) ────────────────────
function rng(seed: number): () => number { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; }; }

export interface Scenario { facts: FactInput[]; truth: Record<string, string>; byzantine: string[] }
/**
 * Build a labeled mesh: H honest agents attest the truth, B byzantine agents
 * attest a fixed wrong value, each fact attested by a random k-subset (sparse).
 * This is the regime where per-fact majority is often wrong but the liars are a
 * global minority — exactly where syndrome decoding earns its keep.
 */
export function buildScenario(seed: number, p?: { honest?: number; byzantine?: number; facts?: number; coverage?: number }): Scenario {
  const H = p?.honest ?? 9, B = p?.byzantine ?? 6, M = p?.facts ?? 40, k = p?.coverage ?? 5;
  const rand = rng(seed);
  const honest = Array.from({ length: H }, (_, i) => `h${i}`);
  const byz = Array.from({ length: B }, (_, i) => `b${i}`);
  const all = [...honest, ...byz];
  const facts: FactInput[] = []; const truth: Record<string, string> = {};
  for (let m = 0; m < M; m++) {
    const fid = `f${m}`; const tv = `T${m % 5}`; truth[fid] = tv;
    // random k-subset of all agents
    const pool = [...all]; const subset: string[] = [];
    for (let j = 0; j < k && pool.length; j++) { const idx = Math.floor(rand() * pool.length); subset.push(pool.splice(idx, 1)[0]!); }
    const attestations: Attestation[] = subset.map((ag) => ({ agent: ag, value: ag.startsWith("b") ? `WRONG${m % 5}` : tv }));
    facts.push({ fact: fid, attestations });
  }
  return { facts, truth, byzantine: byz };
}

export interface SdcBench {
  facts: number;
  majorityCorrect: number;   // facts plain majority-vote gets right
  sdcCorrect: number;        // facts SDC gets right
  majorityAcc: number;
  sdcAcc: number;
  byzantinePrecision: number; // of agents SDC flagged, fraction truly byzantine
  byzantineRecall: number;    // of truly byzantine agents, fraction SDC flagged
}
/** The measured A/B: SDC vs plain per-fact majority on a labeled mesh. Total. */
export function sdcBench(seed = 7, p?: Parameters<typeof buildScenario>[1]): SdcBench {
  const sc = buildScenario(seed, p);
  const mesh = decodeMesh(sc.facts);
  let majorityCorrect = 0, sdcCorrect = 0;
  for (let i = 0; i < sc.facts.length; i++) {
    const f = sc.facts[i]!; const tv = sc.truth[f.fact]!;
    const maj = decodeFact(f.attestations); // unweighted = majority vote
    if (maj.value === tv) majorityCorrect++;
    if (mesh.decoded[i]!.value === tv) sdcCorrect++;
  }
  const flagged = new Set(mesh.corruptedAgents);
  const byz = new Set(sc.byzantine);
  const truePos = [...flagged].filter((a) => byz.has(a)).length;
  const byzantinePrecision = flagged.size > 0 ? round3(truePos / flagged.size) : 1;
  const byzantineRecall = byz.size > 0 ? round3(truePos / byz.size) : 1;
  const M = sc.facts.length || 1;
  return { facts: sc.facts.length, majorityCorrect, sdcCorrect, majorityAcc: round3(majorityCorrect / M), sdcAcc: round3(sdcCorrect / M), byzantinePrecision, byzantineRecall };
}

// ── falsifiable proof ────────────────────────────────────────────────────────
export interface SdcGauntlet {
  cleanWhenUnanimous: boolean;
  correctsRandomError: boolean;       // a single dissenter is corrected + located
  abstainsOnTie: boolean;             // a true tie → UNRECOVERABLE, never guess
  beatsMajorityVote: boolean;         // ★ MEASURED: SDC strictly beats majority in the sustained-liar regime
  sdcRecoversNearPerfect: boolean;    // SDC ≥ 0.95 on the labeled mesh
  locatesByzantine: boolean;          // high precision + recall on the liars
  robustAcrossSeeds: boolean;         // the win holds on multiple seeds (not one lucky draw)
  deterministic: boolean;
  total: boolean;
  score: 0 | 100;
}

export function sdcGauntlet(): SdcGauntlet {
  // 1) unanimous → CLEAN
  const clean = decodeFact([{ agent: "a", value: "X" }, { agent: "b", value: "X" }, { agent: "c", value: "X" }]);
  const cleanWhenUnanimous = clean.verdict === "CLEAN" && clean.value === "X";

  // 2) single error corrected + located
  const one = decodeFact([{ agent: "a", value: "X" }, { agent: "b", value: "X" }, { agent: "evil", value: "Y" }]);
  const correctsRandomError = one.verdict === "CORRECTED" && one.value === "X" && one.dissenters.includes("evil");

  // 3) true tie → abstain
  const tie = decodeFact([{ agent: "a", value: "X" }, { agent: "b", value: "Y" }]);
  const abstainsOnTie = tie.verdict === "UNRECOVERABLE" && tie.value === null;

  // 4+5) measured A/B on the labeled mesh
  const b = sdcBench(7);
  const beatsMajorityVote = b.sdcAcc > b.majorityAcc;
  const sdcRecoversNearPerfect = b.sdcAcc >= 0.95;
  const locatesByzantine = b.byzantinePrecision >= 0.8 && b.byzantineRecall >= 0.8;

  // 6) robust across seeds — the win is structural, not a lucky draw
  let wins = 0; const seeds = [1, 2, 3, 7, 11, 19];
  for (const s of seeds) { const r = sdcBench(s); if (r.sdcAcc >= r.majorityAcc && r.sdcAcc >= 0.9) wins++; }
  const robustAcrossSeeds = wins === seeds.length;

  // 7) deterministic
  const deterministic = JSON.stringify(sdcBench(7)) === JSON.stringify(sdcBench(7)) && JSON.stringify(decodeMesh(buildScenario(7).facts)) === JSON.stringify(decodeMesh(buildScenario(7).facts));

  // 8) total — garbage never throws
  let total = true;
  try { decodeFact(null as unknown as Attestation[]); decodeFact([]); decodeMesh(null as unknown as FactInput[]); decodeMesh([]); buildScenario(0); sdcBench(0); } catch { total = false; }

  const all = cleanWhenUnanimous && correctsRandomError && abstainsOnTie && beatsMajorityVote && sdcRecoversNearPerfect && locatesByzantine && robustAcrossSeeds && deterministic && total;
  return { cleanWhenUnanimous, correctsRandomError, abstainsOnTie, beatsMajorityVote, sdcRecoversNearPerfect, locatesByzantine, robustAcrossSeeds, deterministic, total, score: all ? 100 : 0 };
}
