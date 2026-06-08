/**
 * CRITICAL UNTESTED SURFACE — the cross-layer Test-Gap that hides the scariest changes.
 *
 * Coverage tools tell you a % of lines. None tell you the thing that actually matters: "the most
 * CRITICAL cross-layer nodes — a keystone function that's the sole writer to a table, an endpoint that
 * owns user-facing behaviour — that NO test file even mentions." A change to an untested keystone is
 * the highest-risk edit in a codebase, and it's invisible today: line-coverage averages it away, and
 * nothing maps coverage onto the cross-layer blast radius.
 *
 * This composes the deterministic graph + keystone analysis + a scan of the repo's TEST files: a node
 * is "covered" if its name (a distinctive function name, a table, an endpoint path) appears in a test
 * file. It then surfaces the UNTESTED critical surface, and — for a specific diff — the untested nodes
 * inside that change's blast radius.
 *
 * ★HONEST (DIAKRISIS): "covered" here = a test file MENTIONS the node by name — a deterministic
 * heuristic, not true execution coverage. It is most reliable for distinctive function names (a
 * keystone like `createUserWallet`), weaker for short table names. So it's a prove-or-LOOK signal:
 * an UNCOVERED keystone is a strong "write a test here first" flag; a covered one is "probably fine".
 */
import { type CrossLayerGraph, type SourceFile, type GNode, buildCrossLayerGraph, graphHealth, diffBlastRadius, type DiffChange, type Keystone } from "../cross_layer_graph/index.js";

const lc = (s: string) => String(s ?? "").toLowerCase();
const isTestFile = (path: string) => /(\.|_)(test|spec)\.[a-z]+$|(^|\/)(tests?|__tests__|spec|e2e)\//i.test(String(path ?? ""));

export interface TestCoverage { covered: (n: GNode) => boolean; testFileCount: number }
/** Build a coverage oracle from the repo's test files (a node is covered if a test mentions it). */
export function buildCoverage(files: ReadonlyArray<SourceFile>): TestCoverage {
  const testFiles = (files ?? []).filter((f) => f && isTestFile(f.path));
  const blob = lc(testFiles.map((f) => f.content).join("\n"));
  const testFileCount = testFiles.length;
  const mentions = (name: string, kind: GNode["type"]): boolean => {
    const n = lc(name); if (!n || !blob) return false;
    if (kind === "function") return new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`).test(blob) || new RegExp(`['"\`]${n}['"\`]`).test(blob);   // a call or a string ref
    if (kind === "api_endpoint") { const p = n.replace(/^\/+/, ""); return p.length > 1 && blob.includes(p); }
    // db_table: distinctive enough only when ≥4 chars; require a word-boundary hit
    if (kind === "db_table") return n.length >= 4 && new RegExp(`\\b${n}\\b`).test(blob);
    return blob.includes(n);
  };
  return { covered: (node: GNode) => mentions(node.name, node.type), testFileCount };
}

export interface TestGap {
  testFileCount: number;
  uncoveredKeystones: Array<{ node: GNode; soleWriterOf: string[]; fanIn: number; reason: string }>;
  uncoveredTables: GNode[];
  uncoveredEndpoints: GNode[];
  coveredKeystones: number;
  totalKeystones: number;
}
/** The repo's critical untested surface: keystones / data tables / endpoints no test mentions. */
export function analyzeTestGap(files: ReadonlyArray<SourceFile>, opts?: { graph?: CrossLayerGraph }): TestGap {
  const g = opts?.graph ?? buildCrossLayerGraph(files as SourceFile[]);
  const cov = buildCoverage(files);
  const h = graphHealth(g);
  const touchedTables = new Set(g.edges.filter((e) => e.relation === "WRITES_TO" || e.relation === "READS").map((e) => e.target));
  const uncoveredKeystones = h.keystones.filter((k) => !cov.covered(k.node)).map((k) => ({ node: k.node, soleWriterOf: k.soleWriterOf, fanIn: k.fanIn, reason: `sole writer to ${k.soleWriterOf.map((t) => "'" + t + "'").join(", ")} · no test mentions it` }));
  const uncoveredTables = g.nodes.filter((n) => n.type === "db_table" && touchedTables.has(n.id) && !cov.covered(n)).sort((a, b) => a.name.localeCompare(b.name));
  const uncoveredEndpoints = g.nodes.filter((n) => n.type === "api_endpoint" && !cov.covered(n)).sort((a, b) => a.name.localeCompare(b.name));
  return { testFileCount: cov.testFileCount, uncoveredKeystones, uncoveredTables, uncoveredEndpoints, coveredKeystones: h.keystones.length - uncoveredKeystones.length, totalKeystones: h.keystones.length };
}

export interface ChangeTestGap { reached: number; untestedTables: string[]; untestedEndpoints: string[]; untestedFunctions: string[]; untestedKeystones: string[]; verdict: "TESTED" | "GAP" | "EMPTY"; reason: string }
/** For a specific diff: which nodes in its blast radius are UNTESTED (the risk surface to cover first). */
export function changeTestGap(files: ReadonlyArray<SourceFile>, diff: string | ReadonlyArray<DiffChange>, opts?: { graph?: CrossLayerGraph }): ChangeTestGap {
  const g = opts?.graph ?? buildCrossLayerGraph(files as SourceFile[]);
  const cov = buildCoverage(files);
  const b = diffBlastRadius(g, diff as never, { maxDepth: 1 });
  if (!b.changed) return { reached: 0, untestedTables: [], untestedEndpoints: [], untestedFunctions: [], untestedKeystones: [], verdict: "EMPTY", reason: "no changed functions resolved to the graph" };
  const keystoneNames = new Set(graphHealth(g).keystones.map((k) => k.node.name));
  const reachedFns = [...b.origins, ...b.functions];   // include the CHANGED functions themselves, not just what they reach
  const untestedTables = b.tables.filter((t) => !cov.covered(t)).map((t) => t.name);
  const untestedEndpoints = b.endpoints.filter((e) => !cov.covered(e)).map((e) => `${e.method} ${e.name}`);
  const untestedFunctions = [...new Set(reachedFns.filter((f) => !cov.covered(f)).map((f) => f.name))];
  const untestedKeystones = [...new Set(reachedFns.filter((f) => keystoneNames.has(f.name) && !cov.covered(f)).map((f) => f.name))];
  const gap = untestedTables.length + untestedEndpoints.length + untestedKeystones.length;
  return {
    reached: b.reachable,
    untestedTables, untestedEndpoints, untestedFunctions, untestedKeystones,
    verdict: gap ? "GAP" : "TESTED",
    reason: gap ? `this change reaches untested critical surface: ${[...untestedKeystones.map((k) => "keystone " + k), ...untestedTables.map((t) => "table " + t), ...untestedEndpoints.map((e) => "endpoint " + e)].join(", ")}` : "the critical nodes this change reaches are mentioned by tests",
  };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface TestGapGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function testGapGauntlet(): TestGapGauntlet {
  // createUserWallet is the sole writer to Wallet (a keystone, reached by register). No test mentions it.
  const base: SourceFile[] = [
    { path: "schema.prisma", content: "model Wallet { id Int @id }" },
    { path: "auth.ts", content: "export function register(uid){ return createUserWallet(uid); }\nexport function createUserWallet(uid){ return prisma.wallet.create({data:{uid}}); }" },
  ];
  const noTest = analyzeTestGap(base);
  const uncoveredOK = noTest.uncoveredKeystones.some((k) => k.node.name === "createUserWallet");
  // now add a test that calls createUserWallet → it becomes covered
  const withTest = analyzeTestGap([...base, { path: "auth.test.ts", content: "import { createUserWallet } from './auth';\ntest('wallet', () => { createUserWallet(1); });" }]);
  const coveredOK = !withTest.uncoveredKeystones.some((k) => k.node.name === "createUserWallet");
  // change gap: a diff touching createUserWallet with NO test → GAP naming the keystone
  const diff = "--- a/auth.ts\n+++ b/auth.ts\n@@ -1,1 +1,2 @@ export function createUserWallet(uid){\n+x\n";
  const cg = changeTestGap(base, diff);
  const gapOK = cg.verdict === "GAP" && cg.untestedKeystones.includes("createUserWallet");
  const cgTested = changeTestGap([...base, { path: "auth.test.ts", content: "createUserWallet(1)" }], diff);
  const testedOK = cgTested.untestedKeystones.length === 0;
  const total = (() => { try { analyzeTestGap(null as never); changeTestGap(null as never, "x"); buildCoverage(null as never); return true; } catch { return false; } })();
  const checks = [
    { name: "UNCOVERED-KEYSTONE", pass: uncoveredOK, detail: "a keystone (sole-writer) no test mentions → flagged as critical untested surface" },
    { name: "COVERED-WHEN-TESTED", pass: coveredOK, detail: "add a test that calls it → no longer flagged (the heuristic responds to real tests)" },
    { name: "CHANGE-GAP", pass: gapOK, detail: "a diff reaching an untested keystone → GAP, naming exactly what to test first" },
    { name: "CHANGE-TESTED", pass: testedOK, detail: "once a test mentions it, the same diff is no longer a keystone gap" },
    { name: "TOTAL", pass: total, detail: "null/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
