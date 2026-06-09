/**
 * THE LOGIC ENGINE — a deterministic reasoner that checks whether an AI agent's REASONING is sound,
 * not whether its facts are true.
 *
 * Every truth layer checks individual claims ("is X true?"). Nothing checks the SHAPE of the argument:
 * does the conclusion actually FOLLOW from the premises, and do the premises secretly CONTRADICT each
 * other? An LLM emits fluent chains of "A, therefore B, therefore C" that are individually plausible and
 * collectively invalid. This is a tiny, sound inference engine — forward-chaining over Horn clauses
 * (when ALL of `when` hold → `then`) plus mutual-exclusion constraints (these can't all be true at once)
 * — that derives the full logical closure, returns a PROOF tree for everything it concludes, flags any
 * CONTRADICTION (with the minimal conflicting set), and answers a goal as PROVEN / CONTRADICTED /
 * UNKNOWN. It never guesses: a goal it cannot derive is UNKNOWN, never false (prove-or-unknown — the
 * deepest expression of Mneme's soul, applied to logic itself). Domain-agnostic: the atoms are plain
 * strings, so it reasons over code facts, business rules, an agent's plan — anything.
 *
 * ★HONEST (DIAKRISIS): sound monotone reasoning (no negation-as-failure in the core — that would let it
 * conclude falsehood from absence). It proves what FOLLOWS and catches stated contradictions; it does
 * NOT invent missing premises. The power is that the verdict is mechanical, reproducible, and signable —
 * a logic an agent can run on its OWN argument before it acts.
 */
export interface Rule { id?: string; when: string[]; then: string }
export interface Mutex { all: string[]; note?: string }
export interface ProofStep { atom: string; via: string; from: string[] }
export interface Contradiction { atoms: string[]; note?: string }
export interface Reasoning { derived: string[]; proof: Record<string, ProofStep>; contradictions: Contradiction[]; consistent: boolean }
export type ProveStatus = "PROVEN" | "CONTRADICTED" | "UNKNOWN";

const clean = (a: unknown): string[] => Array.isArray(a) ? a.map((x) => String(x).trim()).filter(Boolean) : [];

/** Forward-chain facts + Horn rules to the fixpoint closure; flag any mutex that is fully satisfied. */
export function reason(facts: ReadonlyArray<string>, rules: ReadonlyArray<Rule>, mutexes: ReadonlyArray<Mutex> = []): Reasoning {
  const derived = new Set<string>(); const proof: Record<string, ProofStep> = {};
  for (const f of clean(facts)) { if (!derived.has(f)) { derived.add(f); proof[f] = { atom: f, via: "given", from: [] }; } }
  const rs = (rules ?? []).filter((r) => r && typeof r.then === "string").map((r) => ({ id: r.id, when: clean(r.when), then: String(r.then).trim() }));
  let changed = true; let guard = 0;
  while (changed && guard++ < 10000) {
    changed = false;
    for (const r of rs) {
      if (!r.then || derived.has(r.then)) continue;
      if (r.when.every((w) => derived.has(w))) {
        derived.add(r.then); proof[r.then] = { atom: r.then, via: r.id || (r.when.join(" ∧ ") + " → " + r.then), from: r.when }; changed = true;
      }
    }
  }
  const contradictions: Contradiction[] = [];
  for (const m of mutexes ?? []) { const all = clean(m?.all); if (all.length >= 1 && all.every((a) => derived.has(a))) contradictions.push({ atoms: all, note: m?.note }); }
  return { derived: [...derived].sort(), proof, contradictions, consistent: contradictions.length === 0 };
}

/** Walk the proof tree for an atom → the ordered steps (premises before conclusions), facts first. */
export function explain(r: Reasoning, atom: string): ProofStep[] {
  const out: ProofStep[] = []; const seen = new Set<string>();
  const visit = (a: string) => {
    if (seen.has(a)) return; seen.add(a);
    const step = r.proof[a]; if (!step) return;
    for (const p of step.from) visit(p);
    out.push(step);
  };
  visit(String(atom).trim());
  return out;
}

/** The verdict on a goal: PROVEN (with the proof chain) / CONTRADICTED (premises are inconsistent) / UNKNOWN. */
export function prove(facts: ReadonlyArray<string>, rules: ReadonlyArray<Rule>, goal: string, mutexes: ReadonlyArray<Mutex> = []): { status: ProveStatus; chain: ProofStep[]; contradictions: Contradiction[]; reason: string } {
  const r = reason(facts, rules, mutexes); const g = String(goal ?? "").trim();
  if (!r.consistent) return { status: "CONTRADICTED", chain: [], contradictions: r.contradictions, reason: `the premises are inconsistent — they entail a contradiction: ${r.contradictions.map((c) => c.atoms.join(" ∧ ")).join("; ")}. No conclusion can be trusted.` };
  if (g && r.derived.includes(g)) { const chain = explain(r, g); return { status: "PROVEN", chain, contradictions: [], reason: `'${g}' follows in ${chain.filter((s) => s.via !== "given").length} step(s) from the given facts` }; }
  return { status: "UNKNOWN", chain: [], contradictions: [], reason: g ? `'${g}' does not follow from the given facts + rules — it is UNKNOWN, not false (supply the missing premise/rule, or it cannot be concluded)` : "no goal supplied" };
}

/** Parse a compact text program into facts/rules/mutexes/goal. Lines:
 *   `a`  (fact) · `a & b => c` (rule) · `never: x & y` (mutex) · `goal: g`  · `# comment`. */
export function parseProgram(text: string): { facts: string[]; rules: Rule[]; mutexes: Mutex[]; goal: string } {
  const facts: string[] = []; const rules: Rule[] = []; const mutexes: Mutex[] = []; let goal = "";
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim(); if (!line) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^goal\s*:\s*(.+)$/i))) { goal = m[1].trim(); continue; }
    if ((m = line.match(/^never\s*:\s*(.+)$/i))) { mutexes.push({ all: m[1].split("&").map((s) => s.trim()).filter(Boolean) }); continue; }
    if (line.includes("=>")) { const [lhs, rhs] = line.split("=>"); rules.push({ when: lhs.split("&").map((s) => s.trim()).filter(Boolean), then: rhs.trim() }); continue; }
    facts.push(line);
  }
  return { facts, rules, mutexes, goal };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface LogicGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function logicGauntlet(): LogicGauntlet {
  // 1. valid chain: deploy ← tests_pass ∧ reviewed ; tests_pass ← built ; built, reviewed given → PROVEN
  const rules: Rule[] = [{ id: "r-deploy", when: ["tests_pass", "reviewed"], then: "can_deploy" }, { id: "r-tests", when: ["built"], then: "tests_pass" }];
  const p1 = prove(["built", "reviewed"], rules, "can_deploy");
  const provenOK = p1.status === "PROVEN" && p1.chain.some((s) => s.atom === "tests_pass") && p1.chain[p1.chain.length - 1].atom === "can_deploy";
  // 2. UNKNOWN (not false): without `reviewed`, can_deploy is not derivable
  const p2 = prove(["built"], rules, "can_deploy");
  const unknownOK = p2.status === "UNKNOWN";
  // 3. CONTRADICTION: agent claims safe_to_drop AND a rule derives breaks_consumer; mutex says they can't coexist
  const dropRules: Rule[] = [{ id: "r-break", when: ["reads(web,users)"], then: "breaks_consumer" }];
  const mut: Mutex[] = [{ all: ["safe_to_drop", "breaks_consumer"], note: "can't be safe to drop AND break a consumer" }];
  const p3 = prove(["safe_to_drop", "reads(web,users)"], dropRules, "safe_to_drop", mut);
  const contraOK = p3.status === "CONTRADICTED" && p3.contradictions.some((c) => c.atoms.includes("breaks_consumer"));
  // 4. proof is sound — every derived atom traces to facts
  const r4 = reason(["built", "reviewed"], rules);
  const proofOK = r4.proof["can_deploy"] && r4.proof["tests_pass"].from.includes("built");
  // 5. parse the text DSL
  const prog = parseProgram("# plan\nbuilt\nreviewed\nbuilt & reviewed => shippable\nnever: shippable & has_secret\ngoal: shippable");
  const parseOK = prog.facts.includes("built") && prog.rules.length === 1 && prog.rules[0].then === "shippable" && prog.mutexes.length === 1 && prog.goal === "shippable";
  const total = (() => { try { reason(null as never, null as never); prove(null as never, null as never, null as never); parseProgram(null as never); explain({ derived: [], proof: {}, contradictions: [], consistent: true }, "x"); return true; } catch { return false; } })();
  const checks = [
    { name: "PROVEN-WITH-CHAIN", pass: provenOK, detail: "a valid reasoning chain → PROVEN, with the full proof tree (facts → intermediate → goal)" },
    { name: "UNKNOWN-NOT-FALSE", pass: unknownOK, detail: "a goal that doesn't follow → UNKNOWN (never asserted false — prove-or-unknown)" },
    { name: "CATCHES-CONTRADICTION", pass: contraOK, detail: "premises that entail a mutually-exclusive pair → CONTRADICTED (the argument is unsound even if each fact sounds plausible)" },
    { name: "SOUND-PROOF", pass: proofOK, detail: "every derived atom traces back to the given facts via real rules" },
    { name: "TEXT-DSL", pass: parseOK, detail: "a compact program (facts · `a & b => c` · `never: x & y` · `goal:`) parses correctly" },
    { name: "TOTAL", pass: total, detail: "null/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
