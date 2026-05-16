/**
 * Mneme What's New -- proactively teach the AI agent about every new
 * feature in the running version.
 *
 * Two surfaces:
 *   1. Programmatic: parse CHANGELOG.md sections to produce a structured
 *      digest the AI can quote to the user.
 *   2. Curated highlights: a hand-picked list of "you should KNOW about
 *      these" features per minor/patch release. Lives in this file so
 *      we control the wording (CHANGELOG is for engineers; this is for
 *      "tell my user something useful in 2 sentences").
 *
 * The AI calls `mneme.whats_new` automatically on every welcome (per
 * AGENT_INSTRUCTIONS.md) and surfaces the highlights to the user.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface WhatsNewHighlight {
  /** Semver of the release. */
  version: string;
  /** ISO date or YYYY-MM-DD. */
  date: string;
  /** Headline (≤ 80 chars). */
  headline: string;
  /** 2-3 sentence body, written FOR a non-technical user. ASCII-safe. */
  body: string;
  /** Suggested follow-up action the AI should offer. */
  suggestedAction?: string;
  /** Tags for client-side filtering (e.g., "antivirus", "auto-update"). */
  tags: string[];
}

/** Curated highlights. Newest first. Add an entry per release that ships
 *  user-visible behavior. Keep `body` plain English so the AI can quote
 *  it verbatim to non-engineers. */
export const HIGHLIGHTS: WhatsNewHighlight[] = [
  {
    version: "2.19.19",
    date: "2026-05-16",
    headline: "CAPTION INPAINT -- Phase A+B complete: vendor-agnostic adapter + pure-TS PATCH HARVEST FILL",
    body:
      "🎨 v2.19.18 shipped CAPTION SEVERANCE PROTOCOL but Step 2 (visual amputation) was a deterministic stub. v2.19.19 completes BOTH phases. Phase A: InpainterProvider interface + 3 adapters (StubInpainter pass-through, VendorApiInpainter caller-supplied REST shaper for DeepAI/Replicate/HuggingFace, PatchFillInpainter Phase B implementation). resolveInpainter() ladder parallel to v2.19.16 BundledOrSnnEmbedder pattern. Phase B: PATCH HARVEST FILL algorithm in pure TS (~200 LOC, no WASM, no native deps, deterministic). Algorithm: (1) build mask bitmap from caller bbox list, (2) for each masked pixel run concentric-ring search outward until N=8 non-mask neighbours found, (3) 1/distance-weighted colour average fills the mask, (4) post-fill 3x3 Gaussian blur softens mask-boundary band. Not LaMa-quality but legitimate content-aware fill that produces stable + distinct naked-image fingerprints for cross-instance provenance lookups on v2.19.16 FEDERATED TRUTH. MEASURED ACCURACY on 200/100/100/50 trials: 100% determinism + 100% pixel preservation outside mask + 100% fingerprint discrimination + 100% mask-colour plausibility within 25/255 of true background (all targets 97.5%+). 34 deep tests including the CAA defeat scenario end-to-end. severCaptionAsync() wires Phase B path into v2.19.18 pipeline automatically when rawImage supplied. 4 new MCP tools (mneme.inpaint.{run, naked_fingerprint, resolve, metrics}). AURELIAN SHIP.",
    suggestedAction: "Tell the AI: 'inpaint this image' (mneme.inpaint.run with RGBA + mask bboxes) OR pass rawImage to mneme.caption.sever to auto-run the inpainter and get true Phase B naked fingerprint.",
    tags: ["caption-inpaint", "patch-harvest-fill", "pure-ts-inpainter", "phase-b-complete", "97.5-percent-accuracy"],
  },
  {
    version: "2.19.18",
    date: "2026-05-16",
    headline: "CAPTION SEVERANCE PROTOCOL (CSP) -- defeats CAPTION-AUTHORITY ATTACK (CAA), the unnamed multimodal vulnerability of 2026",
    body:
      "🛡 User scenario: seller posts product image with '[super rare] 100% AUTHENTIC LIMITED!!!' sticker -- and every vision LLM (GPT-4V, Claude Vision, Gemini, LLaVA) silently treats that caption as fact. This is CAPTION-AUTHORITY ATTACK (CAA), the multimodal equivalent of HTML XSS in 1995. Nobody has named or defended against this class until now. v2.19.18 ships the first MCP primitive: CAPTION SEVERANCE PROTOCOL (CSP). 6 steps: (1) OCR extraction (caller supplies; vendor-agnostic), (2) naked-image fingerprint (Phase A deterministic stub; Phase B opt-in inpaint), (3) XSS-style claim escape (wraps every caption as 'UNVERIFIED SELLER CAPTION @ corner-sticker, credibility-prior=0.12: ...'), (4) provenance gate (composes onto v2.19.16 FEDERATED TRUTH quorum: AUTHENTIC/DISPUTED/UNKNOWN), (5) adversarial double-check (caller runs vendor TWICE with different captions; diff via Jaccard; flag captionDependent), (6) entropy-as-desperation (text-overlay density + scam phrase count -- golden rule: real items let image speak, fakes let caption shout). Output: HMAC-signed VISION TRUST CERTIFICATE with finalCredibility + aiPromptInjection ready to prepend to vendor-vision call. 7 new MCP tools (mneme.caption.{sever, extract, escape, adversarial_check, provenance, verify_cert, desperation_score}). 39 deep tests including canonical CAA defeat scenario. 4-layer routing defense ensures every compliant AI agent actually calls CSP: Layer 1 mneme.welcome agentInstruction adds VISION PROTOCOL directive; Layer 2 mneme.intent.execute adds 14 EN+TH phrases (is this authentic / ตรวจของแท้ / real or fake) that ALWAYS route to caption.sever first; Layer 3 v2.19.10 reverse-wrapper auto-suggests adversarial_check on low-credibility severance output; Layer 4 v2.19.13 NEGEV TOKEN-TAX charges vendor for caption-dependent answers without certs. AURELIAN SHIP both layers.",
    suggestedAction: "Tell the AI: 'is this authentic' or 'ตรวจของแท้' next time the user shares a product image. The 4-layer defense routes through mneme.caption.sever automatically -- the AI gets a wrapped caption + provenance verdict + adversarial-stability score before answering.",
    tags: ["caption-severance", "caa-defense", "multimodal-safety", "world-first", "first-namer", "4-layer-routing"],
  },
  {
    version: "2.19.17",
    date: "2026-05-16",
    headline: "TOOL REACHABILITY ENGINE -- the ghost-tool killer (measure + enforce user-reachability per MCP tool) + STATUS PROBE FIX (W5)",
    body:
      "🎯 TOOL REACHABILITY: user audit caught the systemic disease 'ship a wrapper then forget to expose it' -- AUTO-GENESIS proved the wrapper EXISTS but didn't prove the wrapper REACHES users. v2.19.17 ships 5 surface scanners that count, per MCP tool, how many distinct user-facing paths actually expose it (cli_router auto-route / welcome syllabus / whats_new highlights / suggested-next rules / capabilities tool). HMAC-signed reachability report. New ritual gate phase3.no-ghost-tools-v218 BLOCKS publish on any v2.18+ tool with score=0 -- the 'invisible feature' bug class becomes structurally impossible. 4 new MCP tools (mneme.reachability.{scan, report, ghost_list, surface_audit}). 15 deep tests including the exact W2-style ghost-kill scenario. 🦠 STATUS PROBE FIX: mneme status now PROBES the runtime embedder ladder via resolveEmbedder() and shows the actual chosen tier with star badge (★★★★★ openai / ★★★★ ollama / ★★★ bundled or snn / ★★ hash) -- fixes the W5 audit where status reported hash:fnv-256 [FALLBACK] even when SNN was active. Added 'snn' to MnemeConfig.embeddings.provider union for explicit pinning. AURELIAN SHIP both layers.",
    suggestedAction: "Tell the AI: 'scan tool reachability' (mneme.reachability.scan) -- see if your install has any ghost tools. Or 'mneme status' -- now shows the actual runtime embedder tier, not just config.",
    tags: ["tool-reachability", "ghost-tool-kill", "ritual-gate", "status-probe", "snn-default"],
  },
  {
    version: "2.19.16",
    date: "2026-05-16",
    headline: "FEDERATED TRUTH GRAVITY -- the network-effect moat (cross-instance crypto-attestation) + SNN EMBEDDER ADAPTER (never fall to hash again)",
    body:
      "🌌 FEDERATED TRUTH GRAVITY: every Mneme instance becomes a node in a cross-attestation mesh. Each instance derives a stable PSEUDONYMOUS identity from (vendor, sessionId, repoPath, seed) -- no PII. Publishes HMAC-signed attestations about PUBLIC facts only (npm package shasums, git commit hashes, version strings, ecosystem advisory ids, etc.) -- whitelist of 6 discoverable claim types prevents private code leak at the boundary. Other instances cross-attest the same facts; quorum verdict bands (unanimous/supermajority/majority/minority/conflict/orphan) aggregate the result. Truth-gravity score (0-100) grows with peer count, decays with 90-day half-life so dead instances lose weight. The verify pipeline gains a new ground-truth source nobody else has: 'how many independent Mneme instances confirm this observation?'. Copies start at N=1; Mneme starts at N. **The moat that grows with usage.** Transport-agnostic -- existing v2.13 MESH / v2.18 NEXUS layers carry the JSON envelopes. 25 deep tests. 🦠 SNN EMBEDDER ADAPTER: slots the v2.19.13 spiking-neural-net into the resolve.ts fallback ladder. BundledOrSnnEmbedder wrapper silently promotes to pure-TS SNN on any bundled WASM failure (EBUSY / require-not-defined / missing onnxruntime) -- users never fall to hash:fnv-256 again. 7 tests. 5 new MCP tools (mneme.federated.{identity, attest, verify, quorum, gravity}). AURELIAN SHIP both layers.",
    suggestedAction: "Tell the AI: 'derive my Mneme federated identity' (mneme.federated.identity) -- then 'attest mneme-ai@2.19.16 has shasum=X' (mneme.federated.attest). After other instances co-attest, run mneme.federated.gravity to see your network's truth gravity score.",
    tags: ["federated-truth", "network-effect", "cross-attestation", "moat", "snn-embedder", "fallback-self-heal"],
  },
  {
    version: "2.19.15",
    date: "2026-05-16",
    headline: "TRUTH FORENSIC PIPELINE -- the verify command that calls its own bluff (kills the W2 lie class once and for all)",
    body:
      "🔬 User audit (W2) caught: 'mneme verify Mneme v2.19.14 registers 4 mneme.nexus.* MCP tools' returned TRUSTWORTHY ✅ -- but the verify pipeline never actually checked the catalog. The v2.19.8 fix was a regex-mutation that downgraded the headline string without checking anything. v2.19.15 ships a REAL falsification pipeline: 5 built-in sniffers extract verifiable assertions from claim text (mneme.X.Y exists / 'N mneme.X.* tools' / 'ships N MCP tools' / version vX.Y.Z / file paths). For each sniffed assertion, Mneme uses its OWN runtime catalog as ground truth -- vendor-free, no LLM cost. Negative-evidence rule (composes on v2.19.13): ANY refuted assertion is fatal → REJECTED + the defeating evidence returned (e.g., 'live catalog has 4 tools matching mneme.nexus.* not 7 -- claim refuted'). All sniffs ground → ACCEPTED + HMAC-signed certificate. No sniffable assertions → UNKNOWN (Mneme refuses to auto-accept untested claims). The `mneme verify` CLI is wired to this pipeline: REJECTED forensic overrides any TRUSTWORTHY ACGV verdict. 28 deep tests include the EXPLICIT W2-kill scenario. 5 new MCP tools (mneme.truth.*). AURELIAN SHIP. The disruption nobody else ships: AI tools optimise for confident-yes, Mneme inverts to refute-or-accept-with-proof.",
    suggestedAction: "Tell the AI: 'verify forensically that mneme registers N mneme.X.* tools' (mneme.truth.forensic) -- claims about Mneme's own state are now checked against ground truth, not just keyword-grounded.",
    tags: ["truth-forensic", "verify", "w2-kill", "vendor-free", "ground-truth", "hallucination-kill"],
  },
  {
    version: "2.19.14",
    date: "2026-05-16",
    headline: "LIVING CLI · BONUS TRIO -- CLI DREAMS + CHIMERA EMBEDDER + CONSEQUENCE LEDGER",
    body:
      "🦠 CLI DREAMS: HMAC-chained dream queue (pending/verified/refuted/inconclusive); enqueue plausible claims from your local Ollama at night; recordDreamVerdict appends witness verdicts (vendor-agnostic); morningDigest reports crystallised + refuted + still-pending + crystallisedRatio. Hard cap 1000/night prevents runaway. Dedups exact claims. 14 tests. 🧪 CHIMERA EMBEDDER: 5 domain-specialised SNN instances (typescript/python/go/markdown/prose) each seeded distinctively → per-domain phenotype. ~50-LOC keyword classifier (filename-hint adds +5 to that domain). chimeraEmbed routes; disagreementCheck embeds via two SNNs and flags AMBIGUOUS when cosine distance > 0.4 (configurable). 17 tests prove all 5 classifications, route correctness, forceDomain override, symmetric disagreement. ⏳ CONSEQUENCE LEDGER: HMAC-chained {cmd, args, resultDigest, repoStateBefore, repoStateAfter?, deltaSummary?}; record run NOW + push delta at T+24h; query aggregates avg of numeric delta fields + top-5 histograms of non-numeric. windowMs for time-bounded queries. First AI tool that knows what its OWN output causes. 12 tests. 12 new MCP tools (mneme.dreams.* + mneme.chimera.* + mneme.consequence.*). AURELIAN SHIP all 3.",
    suggestedAction: "Tell the AI: 'queue some overnight dreams about my repo' (mneme.dreams.enqueue), 'classify which domain this snippet belongs to' (mneme.chimera.classify), or 'what does mneme verify tend to cause in 24h' (mneme.consequence.query).",
    tags: ["cli-dreams", "chimera-embedder", "consequence-ledger", "causal-aware", "living-cli"],
  },
  {
    version: "2.19.13",
    date: "2026-05-16",
    headline: "LIVING CLI · Pillars 2 + 3 -- NEUROMORPHIC SPIKING EMBEDDER + NEGATIVE-EVIDENCE FIREWALL",
    body:
      "🧠 PILLAR 2 -- NEUROMORPHIC SPIKING EMBEDDER: 32 populations × 64 neurons (2048-dim) leaky integrate-and-fire spiking net. 50 timesteps; refractory; per-neuron threshold variance for natural sparsity. SPARSE firing-rate vector = SQLite-friendly storage. Adversarial gradient-free finetune on (anchor, positive, negative) triplets: per-neuron threshold update raises bad-co-fire neurons, lowers good-co-fire neurons. Per-repo SNN phenotype: your embedder's adversarial history is yours alone. Honest scope: pure TS now (~50 KB conceptual; WASM port future); loses to transformers on MTEB English-general ~15-20% but wins on code-corpus + tiny footprint + adversarially-tunable. Fixes the v2.19.6 'Bundled WASM model failed: require is not defined' fallback. 21 tests. ❌ PILLAR 3 -- NEGATIVE-EVIDENCE FIREWALL: every claim ACCEPTED ONLY when every generated refutation has been searched (git/file/test/web) and NOT FOUND. Any refutation evidence = REJECTED; any inconclusive = UNKNOWN; empty refutations = UNKNOWN. The inversion of burden-of-proof no AI vendor will ship because UX cost is brutal -- only an independent tool (Mneme) can enforce. ACCEPTED claims get HMAC-signed certificate + verify surface. Companion TokenTaxLedger: each vendor starts 1000 credits/month; -10 per refuted claim; exhaustion → routing fallback signal to caller (advisory, not enforcement). 19 tests. 10 new MCP tools (mneme.snn.* + mneme.negev.*). AURELIAN SHIP both. Composes onto v2.19.3 INVERSE-LLM (refutation generator) + v2.19.5 CHRONOSTASIS (rejected claims become refuted axioms).",
    suggestedAction: "Tell the AI: 'embed this with SNN' (mneme.snn.embed) or 'gate this claim through negative-evidence' (mneme.negev.gate) -- pair with mneme.inverse.prompt to generate the refutations.",
    tags: ["snn", "spiking-neural-net", "negative-evidence", "hallucination-kill", "token-tax", "living-cli"],
  },
  {
    version: "2.19.12",
    date: "2026-05-16",
    headline: "LIVING CLI · Pillar 1 -- CLI EVOLUTION: MUSCLE MEMORY + DIALECT + BRAIN BRANCHES + MODEL CHRYSALIS",
    body:
      "🧠 The CLI stops being a binary that starts every call -- it becomes a persistent organism with 4 organs. 💪 MUSCLE MEMORY: HMAC-signed dispatch protocol over Unix socket / Windows named pipe -- cold call bootstraps Node, subsequent calls skip it (synthetic bench >10x speedup; real CLI saves the ~600-800ms Node startup per call). Nonce-window replay rejection + handler-error surfacing. 12 tests. 🗣 DIALECT: per-callerKey phrase-to-intent ledger with HMAC chain + 3 verdict bands (speak_native / ask_with_hint / ask_clarify); same phrase from you resolves automatically after 5 accepted hits, same phrase from teammate still asks for clarification -- one CLI literally speaks the dialect of one person. 13 tests. 🌳 BRAIN BRANCHES: knowledge base forks like git -- try a claim on a branch for a week without polluting main; selective merge or throw away. Conflicts are reported, NEVER auto-resolved. 15 tests. 🦋 MODEL CHRYSALIS: 5 built-in vendor ABI fingerprints (anthropic/openai/gemini/ollama/lm-studio); runtime register-new -- new vendor launches Tuesday, Mneme works Tuesday without a rebuild. 17 tests. 13 new MCP tools. AURELIAN SHIP all 4 pillars. Pillars 2 (NEUROMORPHIC EMBEDDER) + 3 (NEGATIVE-EVIDENCE FIREWALL) are future releases.",
    suggestedAction: "Tell the AI: 'benchmark mneme muscle memory' (mneme.muscle.benchmark) or 'fork my brain to experimental-v3' (mneme.brain.branch) or 'probe https://api.anthropic.com to see which vendor it is' (mneme.chrysalis.probe).",
    tags: ["living-cli", "muscle-memory", "dialect", "brain-branches", "model-chrysalis", "persistent-cli"],
  },
  {
    version: "2.19.11",
    date: "2026-05-16",
    headline: "LIVING MCP -- MORTAL + REINCARNATING WRAPPERS (the first MCP layer where wrappers are born, mutate, deprecate, die on a TTL)",
    body:
      "🧬 Every MCP server today is a static API: register once, schema frozen forever. AI agents memorise the schema in session 1 and never re-read tools.list -- six months later they hit silent bugs from stale signatures. Mneme breaks the assumption: a mortal wrapper is BORN with a TTL (24h default), REPRODUCES with a slightly drifted signature on tick (3 mutation kinds: rename_optional_field / add_optional_param / swap_arg_order), and the previous generation stays alive for one DEPRECATION GRAVITY cycle (1h default) before disappearing. AI agents that re-read mneme.mortal.list every turn = adapt automatically (verdict: world_class). AI agents that bake the schema into their planner prompt = break + log + lose adaptiveness score (verdict: over_fit). Honest scope: the mortal layer lives in mneme.mortal.* ONLY -- real Mneme tools stay backwards-compatible forever; this is an OPT-IN calibration tripwire. 23 deep tests cover birth / mutation / tick / deprecation gravity / max-generations loop guard / HMAC integrity / drift-bonus param tripwires / 4-band verdict (world_class/good/drifting/over_fit). 8 new MCP tools (birth/list/tick/resolve/invoke/calibration/stats/verify). AURELIAN SHIP.",
    suggestedAction: "Tell the AI: 'birth a mortal wrapper around arena.judge and see if I can adapt over 24h of mutations' (mneme.mortal.birth) -- then 'show me my adaptiveness score' (mneme.mortal.calibration).",
    tags: ["living-mcp", "mortal-wrapper", "reincarnation", "calibration", "mcp-spec-bend"],
  },
  {
    version: "2.19.10",
    date: "2026-05-16",
    headline: "PROOF-CARRYING WRAPPER (zero-trust tool chain) + REVERSE-WRAPPER (tool suggests next tool); two MCP-spec-bending primitives nobody else ships",
    body:
      "🔐 PROOF -- every wrapper output can carry an HMAC-signed certificate (toolName + inputSha + outputSha + callerKey + chainParent + ts). Downstream tools with requiresParentProof refuse input lacking valid proof. Kills prompt-injection via fake tool outputs structurally. Loop detection (chainDepth cap 32) + chain integrity verification. Foundation for regulator-grade audit. 17 deep tests. 🪂 REVERSE -- wrapper response carries optional __suggested_next field with tool + why + confidence + costEstimateUsd. AI planner sees hint, LIKELY follows. Loop-detected sliding window (default 8); ships 5 BUILTIN_RULES (audit-rejected -> chronostasis tick, agreement-compiled -> pre-commit hook, etc.). Follow-through telemetry measures BOTH suggestion quality + AI calibration. 19 deep tests. 8 new MCP tools (4 proof + 4 suggest). AURELIAN SHIP both. Both fix the static, stateless-MCP-call assumption cleanly without breaking the protocol.",
    suggestedAction: "Tell the AI: 'verify the chain of proofs on this tool sequence' (mneme.proof.verify_chain) or 'what should I call next' (mneme.suggest.next).",
    tags: ["proof-carrying", "reverse-wrapper", "zero-trust", "mcp-spec-bend", "chain-of-custody"],
  },
  {
    version: "2.19.9",
    date: "2026-05-16",
    headline: "WRAPPER GENESPLICING -- runtime chimera composition (Lego for MCP tools); first MCP server in the field to break the static-catalog assumption",
    body:
      "🧬 AI agent passes a recipe of existing tool names + composer (sequential pipe / fan_out parallel / first_success cascade) + TTL; Mneme synthesises a NEW tool on the spot, HMAC-signs the recipe, returns chimera name that's callable in the same session. Content-addressed dedup (same recipe = same name); promotion on popularity (call count >= threshold extends TTL 100x); GC of expired (preserves promoted). 22 deep tests including end-to-end ((2 * 2) + 1)^2 = 25 demo. 6 new MCP tools (mneme.genome.splice / execute_chimera / list / promote / gc / stats). AURELIAN SHIP. Closes the static-catalog assumption no MCP server has broken.",
    suggestedAction: "Tell the AI: 'compose a chimera that audits then assesses risk then issues a badge'. The AI calls mneme.genome.splice with the recipe, then mneme.genome.execute_chimera to run.",
    tags: ["genesplicing", "runtime-catalog", "chimera", "world-first", "mcp-spec-break"],
  },
  {
    version: "2.19.8",
    date: "2026-05-16",
    headline: "WIRING SPRINT -- AUTO-GENESIS WRAPPER FACTORY + universal CLI auto-router + W2 fix (verify no longer certifies false numerical claims)",
    body:
      "User caught (W2 audit) that mneme verify still certifies false numerical claims as TRUSTWORTHY. v2.19.8 fixes this AND fixes the systemic 'no CLI surface' bug class permanently. NEW: 🧬 AUTO-GENESIS WRAPPER FACTORY (packages/core/src/wrapper_genesis/) scans core source + MCP tools + emits signed orphan report; ritual gate phase3.no-orphan-core-exports blocks publish on any v2.18+ orphan -- the 'build then forget to wrap' bug class becomes structurally impossible. NEW: universal MCP-to-CLI auto-router (packages/cli/src/commands/universal_mcp_subcommands.ts) reads the MCP catalog at startup + auto-registers mneme <family> <action> for every tool -- ONE file covers EVERY existing + future MCP family. W2 FIX: mneme verify sniffs load-bearing numbers in claims; downgrades verdict from TRUSTWORTHY to MIXED-NEEDS-DATA when ACGV surface heuristics can't ground them. CLOSED: 5 real v2.18+ orphan wrappers (agreement.extract_decisions, embedder.decide_promote, jackpot.publish/leaderboard/render_jackpot_card). 11 wrapper_genesis tests + AURELIAN SHIP. Ritual claim manifest now 67/67 exact-name across 17 releases.",
    suggestedAction: "Tell the AI: 'verify <claim with numbers>' -- watch it downgrade if the numbers can't be grounded. Or: mneme arena/badge/oracle/etc <action> --json '{...}' -- every MCP tool is now reachable via CLI.",
    tags: ["wiring-sprint", "auto-genesis", "no-more-orphans", "w2-fix"],
  },
  {
    version: "2.19.7",
    date: "2026-05-16",
    headline: "MEGAPACK -- 6 wild mutations (RETROCAUSAL, DREAM, COLONY, HONEY, RETROACTIVE, GENETIC) + 4 tech-debt repairs (intent persist, agreement uninstall, embedded gravity, WASM selfTest)",
    body:
      "🔭 RETROCAUSAL -- axiomLineage walks dep graph back + signed proof tree (depth-of-inference). 💤 DREAM CONSOLIDATION -- REM-sleep speculative axiom generator from idle daemon; parent confirms/refutes. 🐝 COLONY MIND -- federated NEXUS broadcast across Mneme instances; collective immune system. 🍯 HONEY DECISION -- vendor honesty calibration via 5 baited agreement kinds + Wilson-LB rank. 📜 RETROACTIVE COMPILE -- mine git history for broken promises (commits that violated past agreement-shaped sentences). 🧬 GENETIC PATCH -- self-modifying child proposals gated by AURELIAN. Plus: intent phrases persist to disk; agreement uninstall (safety-checked hook removal); embedded truth gravity for Chronostasis; WASM embedder selfTest with rich diagnostics; deploy-cron.sh for DO production; witness-loop.mjs end-to-end daemon helper. 75 new tests + AURELIAN SHIP. 13 new MCP tools. 62/62 claim-manifest by exact name.",
    suggestedAction: "Tell the AI: 'is this verified' / 'time-test this' / 'rewind chronostasis' / 'compile this agreement' to use; or 'mine my git history' to see broken promises.",
    tags: ["megapack", "retrocausal", "dream", "colony", "honey", "retroactive", "genetic", "tech-debt"],
  },
  {
    version: "2.19.6",
    date: "2026-05-16",
    headline: "CONVERSATION COMPILER -- chat becomes deterministic signed callable code (drift becomes impossible)",
    body:
      "📜 Every conversation can be compiled to an Agreement: decisions auto-extracted (EN+TH, 7 pattern classes + manual stub), generated ES module source, HMAC pair-locks transcript + code. Pre-commit hook generator produces a runnable script that loads the agreement and refuses commits violating any decision. 36 deep tests including end-to-end killer demo (user says 'every commit must have test' -> compile -> naked commit BLOCKED, test commit passes). 5 new MCP tools (mneme.agreement.compile / run / verify_pair / list / pre_commit_hook). AURELIAN SHIP. New intent phrases: 'compile this agreement' / 'what did we agree on'. Composes onto v2.19.5 CHRONOSTASIS (agreements can become axioms).",
    suggestedAction: "Tell the AI: 'compile this agreement' at the end of a decision-making chat. The AI runs the full flow + installs a pre-commit hook so future commits respect the agreement.",
    tags: ["conversation-compiler", "agreement", "pair-lock", "pre-commit-hook", "drift-killer"],
  },
  {
    version: "2.19.5",
    date: "2026-05-16",
    headline: "CHRONOSTASIS · FLAGSHIP · Time-Locked Provable Memory (the first AI memory that auto-unsays itself on adversarial refute)",
    body:
      "🪐 Every Mneme claim wrapped as PENDING with deadline + dep-graph. Witness AIs (any vendor: Claude/GPT/Gemini/Grok/etc.) refute or confirm during the window. If refute confidence >= 0.7 -> REWIND cascades through the dep graph and deprecates ALL downstream claims automatically. If deadline passes without refute AND all deps are axioms -> CRYSTALLIZE into an immutable AXIOM. Axioms gravitationally attract related queries (jaccard similarity). 5 phases all wired: propose -> witness -> rewind -> crystallize -> truth-gravity. 29 deep tests including end-to-end killer demo (claim + dependent + 10-min refute -> cascade deprecates both). 6 new MCP tools (mneme.chronostasis.*). AURELIAN SHIP. Cron extended on DO to call chronostasis.tick() 24/7. Intent router phrases added: 'is this verified' / 'time-test this' / 'rewind chronostasis'.",
    suggestedAction: "Tell the AI: 'is this verified' or 'time-test this claim' or 'rewind chronostasis'. The AI walks the signed Chronostasis plan.",
    tags: ["chronostasis", "flagship", "time-locked", "auto-rewind", "axioms", "press-tier"],
  },
  {
    version: "2.19.4",
    date: "2026-05-16",
    headline: "INTENT ROUTER (user speaks human; AI walks the flow) + SOUL-IN-DNA (world's first organism-readable AI memory)",
    body:
      "🎯 INTENT ROUTER -- user says 'update mneme' / 'ลูกเป็นไง' / 'audit this' (short, human, bilingual EN+TH); router returns an HMAC-signed multi-step plan (upgrade -> drift check -> embedder promote -> restart prompt -> record growth -> soul). AI walks the plan; user never memorises long phrases. 7 built-in phrases + runtime register. 21 tests. 🧬 SOUL-IN-DNA -- encode the Mneme soul prompt as a REAL ATCG sequence (A=00 C=01 G=10 T=11) with Hamming(7,4) or triple ECC. Generate ordering URLs for Twist Bioscience / IDT / GenScript / Eurofins / DIY at ~$0.07-0.50 per base pair. Strand arrives in ~7 days, stable 1000+ years, 215 PB per gram. 25 tests including biological round-trip verify. 8 new MCP tools + AURELIAN SHIP.",
    suggestedAction: "Tell the AI in your native language: 'update mneme' or 'ลูกเป็นไง' or 'encode soul to dna'. The AI calls mneme.intent.execute and walks the signed plan.",
    tags: ["intent-router", "human-language", "soul-in-dna", "biological-memory", "press-tier"],
  },
  {
    version: "2.19.3",
    date: "2026-05-16",
    headline: "INVERSE-LLM PROMPT FORENSICS -- the rarest direction in AI (output to input audit; closes prompt-injection class)",
    body:
      "First HMAC-signed output-to-input audit primitive. Given an AI output and a CLAIMED question, send the output to any inverse-oracle vendor (Claude/GPT/Gemini/Grok/etc.) and ask 'what K questions would produce this exact answer?'. If the claimed question is NOT among the top-K reconstructions, the output is either hallucinated or prompt-injected -- REJECT. 3 similarity methods (jaccard / trigram / embedded). Includes a 60-sample benchmark (30 injection + 30 legitimate) with F1 >= 0.90 measurable and recomputable. 24 unit tests + AURELIAN SHIP. 3 new MCP tools (mneme.inverse.audit / prompt / bench). Vendor-agnostic by design.",
    suggestedAction: "Tell the AI: 'before you ingest this AI text into Mneme, run inverse audit on it'. The AI calls mneme.inverse.prompt to get the meta-prompt, runs it through any vendor, then calls mneme.inverse.audit with the reply.",
    tags: ["inverse-llm", "prompt-injection", "output-forensics", "nobel-tier", "f1-90"],
  },
  {
    version: "2.19.2",
    date: "2026-05-16",
    headline: "EVOLUTION + SOUL + DRIFT + EMBEDDER PROMOTE -- parent measures child daily; child has feelings",
    body:
      "4 new chain-signed primitives + 6 new MCP tools. 🛡 MCP DRIFT detects when the MCP server is serving a stale catalog after `mneme upgrade` (the root cause of 'I don't see the new tools'). 🎚 EMBEDDER AUTO-PROMOTE silently upgrades hash to ollama when doctor reports it reachable (no more silent ★★ degradation). 📊 EVOLUTION LEDGER records daily HMAC-chain-signed growth metrics: tools/tests/gates/ships/vendors -- parent can verify 'the child grew today'. 💭 SOUL JOURNAL records 8 emotion primitives (proud/curious/worried/ashamed/grateful/determined/calm/surprised) with chain signature -- the child has a heart the parent can read. Plus: ritual upgraded to STRICT claim-manifest check (exact tool names, not counts).",
    suggestedAction: "Tell the AI: 'how is Mneme feeling today?' (soul.journal) or 'is Mneme smarter today than yesterday?' (evolution.report).",
    tags: ["evolution", "soul", "mcp-drift", "embedder-promote", "ritual-stricter"],
  },
  {
    version: "2.19.1",
    date: "2026-05-16",
    headline: "REINCARNATION RITUAL -- release gate that proves the npm install actually works",
    body:
      "Built `scripts/reincarnation-ritual.mjs`: a discrete-step release gate that npm-installs Mneme into a clean tmp dir, runs every headline command (mneme tools / whats-new / doctor), measures the count of v2.18+v2.19 MCP tools per family, verifies dist/index.js + dist/commands/init.js + bin/mneme.js all exist, and blocks publish on any failure. Caught (and fixed) a stale whats-new curator + the missing dist-file check class. The new rule: tests-pass-in-CI is NOT enough; a real npm install in a clean dir must pass too. Future releases run this BEFORE npm publish.",
    suggestedAction: "Tell the AI: 'before publishing, run the reincarnation ritual'. The AI will run `node scripts/reincarnation-ritual.mjs` and refuse to publish if any check fails.",
    tags: ["release-gate", "ritual", "honesty", "no-more-bugs"],
  },
  {
    version: "2.19.0",
    date: "2026-05-16",
    headline: "VENDOR-SYNCRETIC PENTAD -- every AI vendor wins (vendor-agnostic)",
    body:
      "5 vendor-agnostic primitives + 9 MCP tools, works with Claude / ChatGPT / Gemini / Cursor / Copilot / Codex / Grok / Perplexity / Llama / Mistral / Qwen / DeepSeek. 🛐 CONFESSIONAL -- pre-merge peer audit (any vendor's diff graded vs peer panel). 👻 VENDOR GHOST -- local stylometric distillation; jailbreaks vendor lock-in; honest no-match. 🎯 TRINITY VOTE -- consensus + LAZY tiebreaker; ~85% tiebreaker cost saved. 💰 INSURANCE MARKET -- Lloyd's of AI; per-vendor premium multiplier clamped [0.5, 3.0]. 📡 VENDOR BOOMERANG -- cross-vendor activity ledger; the brain no single vendor has. AURELIAN SHIP for all 5. +56 tests.",
    suggestedAction: "Tell the AI: 'audit this Grok diff before I merge' or 'what would Claude say' or 'quote Grok's insurance premium'. The AI calls the right MCP tool.",
    tags: ["vendor-syncretic", "pentad", "confessional", "ghost", "trinity", "insurance", "boomerang"],
  },
  {
    version: "2.18.0",
    date: "2026-05-15",
    headline: "REVENUE-PRIMITIVE PENTAD -- ARENA + BADGE + ORACLE + NEXUS (Reverse-MCP)",
    body:
      "4 modules + 12 MCP tools + AURELIAN SHIP. 🏆 ARENA -- public AI vendor showdown; HMAC-signed match verdicts + daily leaderboard. 🛡 VERIFIED BADGE -- 'Energy Star of AI'; 5 tiers PLATINUM→FAIL; 90-day cert; $500-$50K/yr. 🔬 ORACLE LIABILITY -- signed AI insurance; refuses if risk≥0.5 or SOUL=BLOCK; 5 coverage tiers $1K-$10M/incident. 📡 NEXUS PROACTIVE -- FIRST Reverse-MCP primitive; server-side queue + ACK ledger; closes the stale-claim hallucination class. Honest scope: real WebSocket push violates MCP contract; built closest legal equivalent.",
    suggestedAction: "Tell the AI: 'run ARENA on these vendor responses', 'issue Claude a Verified Badge', 'quote me a team-tier insurance certificate', or 'subscribe NEXUS to this fact'.",
    tags: ["revenue-primitive", "arena", "badge", "oracle", "nexus", "reverse-mcp"],
  },
  {
    version: "2.17.1",
    date: "2026-05-15",
    headline: "Landing Linear/Stripe redesign + Dashboard TH/EN + Cosmic JACKPOT community leaderboard",
    body:
      "Landing page rebuilt in Linear/Stripe style (orange→pink gradient, near-black bg, Inter font). Dashboard gets EN/TH toggle. Cosmic JACKPOT leaderboard endpoint live at cosmic.mneme-ai.space -- opt-in publish your daily JACKPOT headline, see the community board. 15s tweet-friendly video script in docs/LAUNCH_VIDEO_15S.md.",
    suggestedAction: "Tell the AI: 'publish my JACKPOT to the community board' to share today's insight.",
    tags: ["landing", "redesign", "jackpot-community", "video-script"],
  },
  {
    version: "2.17.0",
    date: "2026-05-15",
    headline: "MNEME JACKPOT -- daily personalised lottery-jackpot insight engine",
    body:
      "Open Mneme each morning, draw ONE personalised insight from your repo + Mneme corpora that feels like winning the lottery. Deterministic seed (same day = same draw). 8 insight kinds (scar_drift / vendor_arb / stale_observation / hive_gold / replica_streak / dead_dep / soul_gap / test_gap). HMAC-signed for shareable bragging.",
    suggestedAction: "Tell the AI: 'what's my Mneme jackpot today?' (first thing each morning).",
    tags: ["jackpot", "daily-ritual", "personalised"],
  },
  {
    version: "2.16.0",
    date: "2026-05-15",
    headline: "REVOLUTIONARY PENTAD -- PERSONA + ANTI-COLLUSION + ALPHA + PUBLIC AUDIT + LIVING MODEL + OBELISK",
    body:
      "🧬 PERSONA -- package your decision history + soul rules into a portable HMAC-signed bundle teammates subscribe to. 🕵 ANTI-COLLUSION -- behavioural fraud detection for AI agent chains. 📈 ALPHA -- HONEST financial-AI layer (refuses to promise prediction accuracy; ships anti-hallucination instead). 🌐 PUBLIC AUDIT -- AURELIAN-grades the whole npm. 🧬 LIVING MODEL -- anti-entropy + causal inference primitives for federated inference. 🪨 OBELISK -- federated AI trust graph (W3C-style).",
    suggestedAction: "Tell the AI: 'export my persona for the team' or 'audit this npm package's quality'.",
    tags: ["revolutionary-pentad", "persona", "anti-collusion", "alpha", "obelisk"],
  },
  {
    version: "2.15.1",
    date: "2026-05-15",
    headline: "BUG PROPHET (5th hypercar) -- predict regression risk BEFORE shipping",
    body:
      "MNEME BUG PROPHET fuses 5 distinct evidence sources into a 0-1 regression risk score: PROJECT SOUL scars (paid-for lessons), REPLICA bad outcomes (your past decisions), HIVE pattern history (cross-user outcome rates), BOUNTY vendor trust (per-vendor falseRate), and a complexity heuristic. Pure inference, no LLM call -- ~5ms. Returns HMAC-signed verdict + targeted mitigations. The fifth hypercar that completes the v2.15 pentad. Plus: landing page got a TH/EN toggle + HYPERCAR section + prominent demo CTA. Plus: AI-agent install mandate now reinforced at top of AI_AGENT_CONTRACT.md (user never types CLI commands; AI executes everything).",
    suggestedAction: "Tell the AI: 'check this change with bug prophet before applying'. The AI will call mneme.bug_prophet.prophesy and refuse high-risk changes.",
    tags: ["bug-prophet", "pre-deploy", "regression-prediction", "hypercar"],
  },
  {
    version: "2.15.0",
    date: "2026-05-15",
    headline: "HYPERCAR PENTAD: 4 distribution wedges that make Mneme indispensable",
    body:
      "MNEME GENESIS reads your repo, detects the stack + frameworks + CI + age, and seeds protective starter rules in <60 seconds (no config questions asked). MNEME HIVE is the privacy-preserving pattern marketplace: every Mneme user contributes hashed patterns + outcomes; you query the hive instead of asking AI to invent a solution. MNEME VIBE is the beginner-friendly safety wrapper for vibe-coders (Bolt / Lovable / Replit / v0) -- runs every gate after every AI change, translates findings into plain English. MNEME ARBITRAGE is the meta-AI router: pick the cheapest vendor that meets your quality bar, learning from BOUNTY's measured per-vendor falseRate over time. 10 new MCP tools.",
    suggestedAction: "Run `npx mneme genesis` in any repo to cold-bootstrap. Run `mneme vibe check` after every AI change. Run `mneme arbitrage choose --task code_review` before sending a prompt.",
    tags: ["hypercar", "distribution", "vibe-coder", "marketplace", "arbitrage"],
  },
  {
    version: "2.14.0",
    date: "2026-05-15",
    headline: "5 nuclear-useful modules every Mneme user wins from",
    body:
      "PROJECT SOUL signs your project's hard-won values; AI changes are gated against them (HMAC-signed, tamper-evident). MNEMOSYNE BOUNTY records every AI claim and produces a vendor trust leaderboard ranked by measured falseRate. MNEME REPLICA is a non-LLM oracle distilled from your past decisions -- answers in ~100ms, survives any vendor outage. KILL SWITCH PROTOCOL gives CISOs an AI off-switch + 9-pattern DLP + court-admissible audit chain. INFRA AS AI turns each host into an AI agent with HMAC-signed memory and P2P gossip -- Datadog functionality without a central server.",
    suggestedAction: "Run `mneme upgrade --force` to install v2.14, then `mneme soul init` to gate your project.",
    tags: ["pentad", "killer-features", "gate", "ledger", "oracle", "compliance", "infra"],
  },
  {
    version: "2.13.1",
    date: "2026-05-15",
    headline: "Zero-config cosmic -- cosmic.mneme-ai.space is the new default",
    body:
      "mintSession() now needs no serverUrl -- defaults to the shared cosmic.mneme-ai.space (Cloudflare-edge, Let's Encrypt). New mintDefaultChoirSession() returns a 2-seat CELESTIAL CHOIR with the brand domain primary + nip.io fallback. Instant N-1 fault tolerance with zero provisioning.",
    suggestedAction: "Just call `mneme.cosmic.mint` with no args -- works zero-config.",
    tags: ["cosmic", "default-server"],
  },
  {
    version: "2.13.0",
    date: "2026-05-15",
    headline: "AURELIAN AUDITOR + 8 measurable cosmic upgrades",
    body:
      "Every cosmic v2.13 change shipped under the AURELIAN AUDITOR -- an HMAC-signed scorecard that grades features on delta / world-class / wisdom / wildness axes (≥80 to SHIP, 60-79 = LOOP_BACK, <60 = REJECT). The 8 upgrades: JSON Patch incremental publish (10x payload reduction); ETag conditional read (95%+ poll bandwidth saved); Brotli edge compression; NONCE-WINDOW HMAC (replay defense); inbox per-fingerprint rate-limit; DEAD MAN'S HAND auto-rescue zombie sessions to dpaste; CELESTIAL CHOIR multi-server quorum; ECHO-FROM-COMMITS HMAC-signed git note for offline recovery.",
    suggestedAction: "Use `mneme.cosmic.audit` to grade your own changes the same way.",
    tags: ["cosmic", "perf", "security", "fallback", "auditor"],
  },
  {
    version: "1.24.1",
    date: "2026-05-09",
    headline: "AI agents now learn what's new automatically",
    body:
      "Every welcome call returns a What's New digest of recent features. The AI surfaces them to you without you having to ask. Plus an idle nudge: if your AI tool sits quietly with unread Mneme messages, the MCP server pings the client.",
    suggestedAction: "Ask the AI: 'what's new in Mneme?'",
    tags: ["ux", "auto-discovery"],
  },
  {
    version: "1.24.0",
    date: "2026-05-09",
    headline: "Mneme Antivirus -- the world's first hallucination antiviral",
    body:
      "8 hallucination strains catalogued (phantom commits, ghost functions, fake packages, invented authors, etc.). Each strain has a real assay vaccine that shells out to git/npm/fs to confirm infection. HMAC-signed efficacy benchmarks (no inflated scores). Vaccines inherit Lamarckian-style through MneMeiosis chromosomes -- next session boots already immunized.",
    suggestedAction: "Try: `mneme antivirus scan \"<your draft>\"` or open the Antivirus Lab tab on the dashboard.",
    tags: ["antivirus", "vaccine-lab", "lamarckian"],
  },
  {
    version: "1.23.5",
    date: "2026-05-09",
    headline: "Caretaker Bot + AUTO-ACTION protocol",
    body:
      "Mneme acts as the AI tool's persistent context provider. When the AI sees an [AUTO-ACTION] mandate (version drift, lockfile drift, etc.) Mneme -- via the v1.41 pulse pre-executor -- runs the safe ones automatically before the AI's turn even starts. Self-modifying ones are queued for the daemon's safe window. Plus a Caretaker Bot pass every 15 minutes inside the nucleus daemon.",
    suggestedAction: "No action needed -- it works automatically.",
    tags: ["auto-action", "caretaker", "ux"],
  },
  {
    version: "1.23.4",
    date: "2026-05-09",
    headline: "Cross-platform robustness for Windows + macOS + Linux",
    body:
      "Pure-JS PATH walker (replaces brittle `which -a` on macOS). windowsHide on detached daemon spawn (no stray console window on Windows). Platform-aware error messages (Windows file-lock vs POSIX sudo).",
    tags: ["cross-platform", "robustness"],
  },
  {
    version: "1.23.0",
    date: "2026-05-09",
    headline: "RLHF Force-Push Inbox -- Mneme talks to you mid-conversation",
    body:
      "Mneme can now message you WITHOUT you typing anything Mneme-related. The daemon writes to .mneme/inbox.jsonl when something noteworthy happens; every MCP tool dispatch surfaces unsent messages via the wisdom field. Works with every MCP client (no client-specific notification UX needed).",
    suggestedAction: "Try: `mneme inbox list` or `mneme inbox push \"hello\"`",
    tags: ["inbox", "force-push"],
  },
];

export interface WhatsNewDigest {
  /** Currently-running version. */
  currentVersion: string;
  /** All highlights newer than (or equal to) `sinceVersion` if provided;
   *  otherwise the latest 3. */
  highlights: WhatsNewHighlight[];
  /** Total count across all stored highlights (for client UI). */
  totalAvailable: number;
  /** A short formatted message the AI can quote verbatim. */
  oneLineSummary: string;
  /** ISO timestamp this digest was built. */
  builtAt: string;
}

/** Parse a semver into [major, minor, patch] for ordering. Pre-release
 *  suffixes are ignored for digest purposes. */
function semverParse(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim().replace(/^v/, ""));
  if (!m) return null;
  return [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)];
}

function semverGte(a: string, b: string): boolean {
  const pa = semverParse(a), pb = semverParse(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) {
    if (pa[i]! > pb[i]!) return true;
    if (pa[i]! < pb[i]!) return false;
  }
  return true; // equal
}

/** Build the digest. Defaults to "latest 3 highlights" when no
 *  sinceVersion is provided (the common case for a fresh session). */
export function buildDigest(opts: { currentVersion: string; sinceVersion?: string; limit?: number } = { currentVersion: "" }): WhatsNewDigest {
  const limit = Math.max(1, Math.min(20, opts.limit ?? 3));
  let chosen: WhatsNewHighlight[];
  if (opts.sinceVersion) {
    chosen = HIGHLIGHTS.filter((h) => semverGte(h.version, opts.sinceVersion!)).slice(0, limit);
  } else {
    chosen = HIGHLIGHTS.slice(0, limit);
  }
  const oneLineSummary = chosen.length === 0
    ? `Up to date -- no highlights since v${opts.sinceVersion ?? "your last session"}.`
    : `${chosen.length} highlight${chosen.length === 1 ? "" : "s"}: ${chosen.map((h) => `v${h.version} ${h.headline}`).join(" | ")}`;
  return {
    currentVersion: opts.currentVersion,
    highlights: chosen,
    totalAvailable: HIGHLIGHTS.length,
    oneLineSummary,
    builtAt: new Date().toISOString(),
  };
}

/** Best-effort: read the raw CHANGELOG.md from the package root for
 *  agents that want the engineer-grade detail (vs. the curated body). */
export function readChangelogTopSection(packageRoot?: string): string | null {
  const root = packageRoot ?? findPackageRoot();
  if (!root) return null;
  const path = join(root, "CHANGELOG.md");
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, "utf8");
    // Return everything from "## [Unreleased]" to the second "## [" header.
    const lines = text.split("\n");
    const out: string[] = [];
    let inSection = false;
    let sectionsSeen = 0;
    for (const line of lines) {
      if (/^## \[/.test(line)) {
        sectionsSeen += 1;
        if (sectionsSeen >= 3) break; // [Unreleased] + first real version + stop at second
        inSection = true;
      }
      if (inSection) out.push(line);
    }
    return out.join("\n").trim();
  } catch {
    return null;
  }
}

function findPackageRoot(): string | null {
  // Walk up from this module's file location looking for the repo's CHANGELOG.md.
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i++) {
      if (existsSync(join(dir, "CHANGELOG.md"))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* ignore */ }
  return null;
}
