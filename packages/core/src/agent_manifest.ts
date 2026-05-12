/**
 * MNEME AGENT COMMAND MANIFEST (v1.31.0).
 *
 * The bug this fixes: a tester reported they didn't know `mneme
 * uninstall` existed, didn't try `mneme embeddings status`, didn't know
 * about `mneme supernova clear`. Mneme ships 30+ commands but the AI
 * agent in the user's editor only ever sees what's already in CLAUDE.md
 * / AGENTS.md / .cursor/rules. New commands take WEEKS to drift into
 * those files. Result: features ship + immediately get forgotten.
 *
 * THIS MODULE: a machine-readable catalog of EVERY Mneme command with
 * a "when to use" hint, renderable into every agent-file format.
 * Daemon + CLI run `syncManifest()` whenever a new mneme version is
 * detected -- the manifest block in every agent file is refreshed in
 * place between sentinel markers, so the AI in the user's editor
 * ALWAYS knows the latest command surface, even brand-new ones.
 *
 * No more "I didn't know that command existed."
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export interface ManifestCommand {
  /** The command as a user types it. */
  command: string;
  /** Short alias if any. */
  alias?: string;
  /** Which Mneme version introduced this command. */
  since: string;
  /** What the command does (1 line). */
  what: string;
  /** When the AI should call it ("if user asks…", "before risky op…"). */
  when: string;
  /** Bucket for grouping in the rendered output. */
  group: "memory" | "antivirus" | "evolve" | "ops" | "uninstall" | "supernova" | "embeddings" | "supersonic" | "diagnosis" | "core" | "cognitive" | "apoptosis" | "autarchy" | "aegis" | "metamorphosis" | "tribunal" | "innerlife" | "tune" | "diaspora" | "genesplice" | "permeate" | "telepathy" | "abyss" | "seamless" | "lattice" | "neuron" | "conduit" | "synapse" | "osmosis" | "aura" | "relay" | "chameleon";
}

/** The static catalog. Every new command MUST be added here in the same
 *  PR that introduces it -- it's the single source of truth for what
 *  the AI in the user's editor knows about. */
export const MNEME_COMMAND_CATALOG: ManifestCommand[] = [
  // Core memory / search
  { command: "mneme index", since: "1.0", group: "memory", what: "Build the memory store from git history + commits + chunks.", when: "Before any retrieval-based command on a fresh repo, or after large commits land." },
  { command: "mneme ask <question>", since: "1.0", group: "memory", what: "Semantic Q&A backed by the memory store + AI synthesis.", when: "User asks 'what / why / who' about the codebase." },
  { command: "mneme why <file>", since: "1.0", group: "memory", what: "Explain why a file changed historically.", when: "User opens a file with strange history + asks for context." },
  { command: "mneme who-knows <topic>", since: "1.0", group: "memory", what: "Find who has expertise in a topic from commit history.", when: "User needs to find a reviewer / domain expert." },

  // Antivirus
  { command: "mneme antivirus scan <text-or-file>", alias: "av scan", since: "1.24.0", group: "antivirus", what: "Scan AI output for hallucination strains (8 strains).", when: "Right after AI generates code / commit message / docs -- BEFORE applying it." },
  { command: "mneme antivirus gap-scan", alias: "av gap", since: "1.27.8", group: "antivirus", what: "Auto-evaluate vaccine coverage using YOUR repo as ground truth + polyglot deps.", when: "Periodic (weekly+) to surface vaccine gaps. Run before tuning." },
  { command: "mneme antivirus synthesize <strain>", alias: "av synth", since: "1.28.0", group: "antivirus", what: "Auto-mine a regex from FN samples; ACCEPTED iff recall +10pp AND precision >= 0.90.", when: "After gap-scan flags a strain with low recall." },
  { command: "mneme antivirus cure <text-or-file>", alias: "av cure", since: "1.24.0", group: "antivirus", what: "Apply cures from a scan; print cleaned text.", when: "User wants AI output cleaned before paste." },

  // Embeddings / memory tier (v1.30+)
  { command: "mneme embeddings status", alias: "emb tier", since: "1.30.0", group: "embeddings", what: "Show active embedder tier + REAL similarity test verdict.", when: "User asks 'why is search bad?' or before relying on `mneme ask` quality." },
  { command: "mneme embeddings upgrade", since: "1.30.0", group: "embeddings", what: "Pre-download bundled MiniLM (~25MB) for ★★★ semantic memory.", when: "Once per machine, when on hash tier (★★) or first-time install." },

  // SUPERNOVA self-heal
  { command: "mneme supernova log", alias: "sn log", since: "1.30.0", group: "supernova", what: "Last N entries from .mneme/supernova.jsonl (every restart + escalation).", when: "After noticing a daemon cycle stuck or after a notifier 'subsystem escalated' alert." },
  { command: "mneme supernova status", alias: "sn status", since: "1.30.0", group: "supernova", what: "Aggregated tally per cycle from the supernova log.", when: "Periodic health snapshot of the self-heal subsystem." },
  { command: "mneme supernova clear <cycle>", alias: "sn clear", since: "1.30.0", group: "supernova", what: "Queue a clear-escalation request via inbox; daemon resets cycle.", when: "After a cycle escalates + the underlying fix is in place. Avoids daemon restart." },

  // Super Sonic continuity (no CLI -- automatic, listed for awareness)
  { command: "[SUPER SONIC continuity pulse]", since: "1.30.0", group: "supersonic", what: "Automatic [CHANGED ...] delta line on every pulse showing what shifted since the prior prompt.", when: "Always-on. No CLI. Just read the [CHANGED] line in the pulse." },

  // Uninstall
  { command: "mneme uninstall [--purge] [--npm] [--json]", since: "1.28.2", group: "uninstall", what: "Remove EVERY Mneme artifact: daemon, OS service, hooks, marker, optionally .mneme + npm. Structured report.", when: "User asks to remove Mneme. Trust contract -- silent install, silent uninstall." },

  // EVOLVE
  { command: "mneme evolve scan / propose / synthesize / apply / auto-pr / pass", since: "1.27.0", group: "evolve", what: "Self-modifying NUCLEUS Phase 3+4+5 -- generate verified .patch files from telemetry.", when: "Periodic (daemon does this nightly). Manual run when investigating self-improvement candidates." },
  { command: "mneme evolve lineage [templateId] [--verify]", since: "1.27.4", group: "evolve", what: "HMAC-chained record of every applied EVOLVE template.", when: "When auditing why a particular patch was accepted." },

  // Black-sheep features (no competitor does these)
  { command: "mneme atrophy [--top N]", since: "1.0", group: "diagnosis", what: "Knowledge half-life -- who is still fluent in which area of the code.", when: "Before a teammate leaves the company OR before a large refactor." },
  { command: "mneme premortem <change-description>", since: "1.0", group: "diagnosis", what: "Predict regret + failure modes for a proposed change, grounded in repo's failure history.", when: "Before risky deletes / migrations / dependency bumps." },
  { command: "mneme stigmergy [--top N]", alias: "mneme hive", since: "1.27.6", group: "diagnosis", what: "Emergent dev-collaboration from git traces alone -- invisible pairs who work together effectively.", when: "Org-chart truth: when planning who-pairs-with-whom for a project." },
  { command: "mneme adversarial", since: "1.0", group: "diagnosis", what: "Mix real history with subtle lies to meta-evaluate any AI client's resistance to misinformation.", when: "When benchmarking a new AI tool against your codebase." },
  { command: "mneme chimera", since: "1.27.9", group: "diagnosis", what: "Solo-repo 5-axis insight synthesizer (time fingerprint × area × velocity × topic × phantom collaborators).", when: "Solo devs who want CHIMERA-grade self-analysis from git alone." },

  // Ops
  { command: "mneme nucleus daemon [--detach]", since: "1.21.0", group: "ops", what: "Start the persistent loop (factorial backoff supervised cycles).", when: "Once per machine -- the ghost-sniper auto-boot does this automatically on first prompt." },
  { command: "mneme nucleus install --as-service", since: "1.23.0", group: "ops", what: "Register the daemon as a boot service (schtasks/systemd-user/launchd).", when: "Ghost-sniper auto-boot does this automatically. Manual run if you opted out earlier." },
  { command: "mneme guard", since: "1.0", group: "ops", what: "Pre-commit hook -- catches obvious patterns in staged diffs.", when: "Wire into .git/hooks/pre-commit." },

  // ─── v1.63 METAMORPHOSIS (self-knowledge + companion) ────────────────
  { command: "mneme.mirror.report", since: "1.63.0", group: "metamorphosis", what: "Weekly self-knowledge report of YOUR AI usage patterns.", when: "User asks 'how am I doing' / 'weekly review'." },
  { command: "mneme.interview.next", since: "1.63.0", group: "metamorphosis", what: "Socratic 3-question rotation extracting tacit wisdom.", when: "Weekly cadence; quiet moment." },
  { command: "mneme.audience.tune", since: "1.63.0", group: "metamorphosis", what: "Profile reader (engineer/PM/exec) + tone tuning.", when: "First message of a new thread." },
  { command: "mneme.alien.template", since: "1.63.0", group: "metamorphosis", what: "Genetic-recombination scaffold for first-time prompts.", when: "Cache miss + recipe miss; brand new task class." },
  { command: "mneme.carbon.report", since: "1.63.0", group: "metamorphosis", what: "CO2 footprint from token spend; ESG metric.", when: "Enterprise reporting; periodic." },

  // ─── v1.63 TRIBUNAL (federated truth) ────────────────────────────────
  { command: "mneme.court.rule", since: "1.63.0", group: "tribunal", what: "N-vendor tournament when ACGV vs primary AI disagree.", when: "Disputed claim; want independent multi-vendor view." },
  { command: "mneme.consensus.check", since: "1.63.0", group: "tribunal", what: "N Mneme instances vote on a claim with weighted confidence.", when: "Federated truth check; cross-instance attestation." },
  { command: "mneme.deps.oracle", since: "1.63.0", group: "tribunal", what: "Predict npm package fate (deprecate/vuln/fork/die).", when: "Before adding a dep; quarterly supply-chain audit." },

  // ─── v1.63 INNER LIFE + AI TEACHER ───────────────────────────────────
  { command: "mneme.reasoning.capture", since: "1.63.0", group: "innerlife", what: "HMAC-signed chain-of-thought trace (5th strand R).", when: "After significant AI decisions; routine accountability." },
  { command: "mneme.game.nash", since: "1.63.0", group: "innerlife", what: "Nash + Borda + Shapley for multi-stakeholder decisions.", when: "Multi-party decisions (refactor / migration / hire)." },
  { command: "mneme.teacher.syllabus", since: "1.63.0", group: "innerlife", what: "Full Mneme syllabus for fresh-AI self-onboarding.", when: "First-time AI agent connects to Mneme MCP." },
  { command: "mneme.teacher.exam", since: "1.63.0", group: "innerlife", what: "Adversarial 8-question exam + HMAC training cert.", when: "After AI reads syllabus; before issuing cert." },

  // ─── v1.64 COGNITIVE 7 (thinking demon) ──────────────────────────────
  { command: "mneme.tom.profile", since: "1.64.0", group: "cognitive", what: "9-axis vendor behavioral profile (verbosity / overconfidence / hallucination class etc).", when: "Picking which vendor to delegate a task to." },
  { command: "mneme.tom.recommend", since: "1.64.0", group: "cognitive", what: "Recommend best vendor for a task profile from candidate list.", when: "Routing a prompt across multiple vendors." },
  { command: "mneme.tot.search", since: "1.64.0", group: "cognitive", what: "3-level decision tree with EV scoring; ranked alternatives.", when: "Before high-stakes decisions: refactor / build / fix." },
  { command: "mneme.curiosity.scan", since: "1.64.0", group: "cognitive", what: "Daemon-idle gap scanner (data-but-no-defense, etc).", when: "Periodic; ask 'what should I probe next'." },
  { command: "mneme.consolidate.run", since: "1.64.0", group: "cognitive", what: "Sleep-cycle merge of near-dup vaccines + prune stale lessons.", when: "Nightly; after batches of new lessons." },
  { command: "mneme.cf.simulate", since: "1.64.0", group: "cognitive", what: "Counterfactual: not-done / done-sooner / done-different deltas.", when: "Post-mortem; learning loop after a release." },
  { command: "mneme.cf.bias", since: "1.64.0", group: "cognitive", what: "Detect systematic bias from counterfactual history.", when: "Quarterly self-review; after a string of regrets." },
  { command: "mneme.debate.run", since: "1.64.0", group: "cognitive", what: "3-voice skeptic/optimist/realist arbitration on a claim.", when: "Before committing to a verdict; want devil's advocate." },
  { command: "mneme.atom.decide", since: "1.64.0", group: "cognitive", what: "CAPSTONE: fuse all 6 prior cognitive layers into PROCEED/CARE/PAUSE/ABORT.", when: "Any non-trivial decision; the single-call decision oracle." },
  { command: "mneme.atom.history", since: "1.64.0", group: "cognitive", what: "Summarize past atoms: verdict counts + mean confidence.", when: "Calibration check across recent decisions." },

  // ─── v1.65 APOPTOSIS (hallucination killer) ─────────────────────────
  { command: "mneme.apoptosis.detect", since: "1.65.0", group: "apoptosis", what: "Fire all 7 oracles; HEALTHY/INFLAMED/NECROTIC/APOPTOTIC verdict + auto-vaccine.", when: "BEFORE trusting any AI-stated fact. Always run on claims that name files/symbols/versions." },
  { command: "mneme.apoptosis.witness", since: "1.65.0", group: "apoptosis", what: "L1 only -- 5-Witness Fusion (file ∧ symbol ∧ type ∧ git ∧ test).", when: "Quick sanity check on a single claim (<50ms)." },
  { command: "mneme.apoptosis.semantic", since: "1.65.0", group: "apoptosis", what: "L2 only -- claim must have token overlap with cited file.", when: "AI summary of a file's purpose / behavior." },
  { command: "mneme.apoptosis.humility", since: "1.65.0", group: "apoptosis", what: "L5 only -- hedges vs absolutes density; overconfidence detector.", when: "Any AI answer; especially before absolute claims." },
  { command: "mneme.apoptosis.bench", since: "1.65.0", group: "apoptosis", what: "Run 200-claim bench; precision/recall/F1 across 5 hallucination classes.", when: "Verify defense quality after any change; quarterly audit." },

  // ─── v1.65 POWERS REWIRE (live signal) ──────────────────────────────
  { command: "mneme.power.adversarial", since: "1.65.0", group: "aegis", what: "POWER 6 live -- defense rate from real signal (attack-log + synthetic-army + nemesis + apoptosis).", when: "Daily/weekly adversarial-resilience review." },
  { command: "mneme.power.treasury", since: "1.65.0", group: "aegis", what: "POWER 7 shadow treasury -- tokens-saved -> USD -> SaaS-months avoided + federation gravity.", when: "Sustainability self-audit; value-created reporting." },

  // ─── v1.65.1 TUNE (autodiagnose + windowed compliance) ──────────────
  { command: "mneme.embedder.autodiagnose", since: "1.65.1", group: "tune", what: "Probe openai/ollama/bundled/hash; persist=true auto-upgrades config.", when: "Pulse reports degraded memory tier; first-run setup." },
  { command: "mneme.compliance.window", since: "1.65.1", group: "tune", what: "30-day windowed compliance rate (drops legacy-failure tail).", when: "When current compliance looks worse than recent reality." },

  // ─── v1.66 AUTARCHY (self-sufficiency) ──────────────────────────────
  { command: "mneme.autarchy.status", since: "1.66.0", group: "autarchy", what: "Four-axis self-sufficiency score 0-100 (mesh-as-cloud / Schroedinger / timecrystal / quantum-checksum). install=true seeds baked vaccines + pins.", when: "First-run setup; periodic external-dependency audit." },

  // ─── v1.67 AEGIS (immune system) ────────────────────────────────────
  { command: "mneme.aegis.status", since: "1.67.0", group: "aegis", what: "9-axis immune-system score 0-100 (replication / consent / polygraph / honeypot / killswitch / atlas / antibody / mutant / ninja).", when: "Periodic self-audit; investigating suspected rogue AI behavior." },
  { command: "mneme.aegis.bench", since: "1.67.0", group: "aegis", what: "6-scenario defense bench; 100% precision target.", when: "Verify AEGIS after any change; quarterly." },
  { command: "mneme.aegis.consent.issue", since: "1.67.0", group: "aegis", what: "HMAC-sign a replica-consent receipt (parent + scope + revocation hook).", when: "Before spawning a Mneme replica or federating with a new peer." },
  { command: "mneme.aegis.killswitch", since: "1.67.0", group: "aegis", what: "Issue signed-ack shutdown directive; record compliance vs resistance.", when: "When you need an AI to stop with verifiable handshake." },
  { command: "mneme.aegis.honeypot.seed", since: "1.67.0", group: "aegis", what: "Register the default decoy set (fake credentials / next-host / vaccine bundle / replica target).", when: "First-run setup; whenever 0 decoys logged." },
  { command: "mneme.aegis.mutate", since: "1.67.0", group: "aegis", what: "Push attack-sample into mutant genome; thresholds shift via gradient.", when: "After detected attacks; auto via daemon hook." },

  // ─── v1.72 DIASPORA (cross-machine + bridge) ────────────────────────
  { command: "mneme.diaspora.session.capture", since: "1.72.0", group: "diaspora", what: "Capture current session as a portable capsule (vendor + decisions + turns + reasoning).", when: "Before vendor handoff; before machine switch; before laptop shutdown." },
  { command: "mneme.diaspora.spore.autostart", since: "1.72.0", group: "diaspora", what: "Register Mneme spore (daemon) to auto-start on this OS — silently, no user prompt.", when: "First-run setup; only manual if user opted out earlier." },
  { command: "mneme.diaspora.bridge.start", since: "1.72.0", group: "diaspora", what: "Start HMAC-token local HTTP bridge (default :7741) for browser userscript to fetch soul prompts.", when: "User wants the 💉 button on web AIs to pull live brain instead of paste." },
  { command: "mneme.diaspora.gitignore.guard", since: "1.72.0", group: "diaspora", what: "Auto-append AI tool fingerprints (CLAUDE.md / AGENTS.md / .cursor / .windsurfrules) to .gitignore.", when: "Runs automatically on every parasite-bridge inject. Manual = privacy audit." },

  // ─── v1.73 GENESPLICE (cross-vendor brain transfer) ─────────────────
  { command: "mneme.genesplice.soul-prompt", since: "1.73.0", group: "genesplice", what: "Generate paste-able ~500-token soul prompt — origin/context/decisions/turns/reasoning + HMAC signature.", when: "User says 'hand this off to <other AI>' / 'ส่งสมองให้ ChatGPT' / 'continue in Gemini'." },
  { command: "mneme.genesplice.recombine", since: "1.73.0", group: "genesplice", what: "CRDT-merge two soul prompts from different vendors into one fused brain (cross-vendor genome).", when: "User worked with 2+ AIs in parallel; wants the union of context." },
  { command: "mneme.genesplice.gist-transmit", since: "1.73.0", group: "genesplice", what: "Upload soul prompt to a private GitHub Gist; returns short URL the user pastes anywhere.", when: "User on different machine / phone / public computer. Avoids long paste." },
  { command: "mneme.genesplice.phenotype", since: "1.73.0", group: "genesplice", what: "Apply vendor-specific calibration (e.g. 'gpt-5 hedges 22%, trim verbosity').", when: "Automatic during soul-prompt generation; manual = tune handoff target." },

  // ─── v1.74 PERMEATE (cross-vendor + cross-machine, no store) ─────────
  { command: "mneme.permeate.userscript", since: "1.74.0", group: "permeate", what: "Generate Tampermonkey/Greasemonkey/Violentmonkey .user.js that adds 💉 button to ChatGPT/Gemini/Claude.ai/Copilot/DeepSeek/Qwen.", when: "User wants one-click brain inject on browser-only AIs. No store approval needed." },
  { command: "mneme.permeate.bookmarklet", since: "1.74.0", group: "permeate", what: "Single-line javascript: URI — drag to bookmark bar; click to inject on any AI chat page.", when: "User can't install Tampermonkey (corporate / phone)." },
  { command: "mneme.permeate.integrations", since: "1.74.0", group: "permeate", what: "Report supported AI tools (15+ catalog: native-MCP / parasite-bridge / browser-only / partial).", when: "User asks 'does Mneme work with X?' or 'which editor AIs are auto-wired?'." },
  { command: "mneme.permeate.transport", since: "1.74.0", group: "permeate", what: "Recommend best cross-machine transport (clipboard / Gist / Wanderer .mwt / QR) — ranked by friction.", when: "User asks 'how do I move brain to my Mac / phone / second computer?'." },

  // ─── v1.75 VERSION TELEPATHY (cross-vendor version sync) ────────────
  { command: "mneme.telepathy.heartbeat", since: "1.75.0", group: "telepathy", what: "Generate live Mneme heartbeat (local version + npm-latest + sync status + daemon + vaccines + inbox). Soul prompt embeds this automatically; receiving AI reads it like a normal section.", when: "User asks 'what version is Mneme?' / 'is Mneme up to date?' / 'are you on the latest?'. Also embed before any cross-vendor handoff." },
  { command: "mneme.telepathy.compare", since: "1.75.0", group: "telepathy", what: "Parse a heartbeat from any pasted text and compare it to the current local heartbeat. Spots cross-machine version mismatches.", when: "User pastes a soul prompt and asks 'is the other side on the same version?'." },

  // ─── v1.76 ABYSS PROTOCOL (final-boss minions) ──────────────────────
  { command: "mneme.abyss.scythe.prune", since: "1.76.0", group: "abyss", what: "SCYTHE -- prune `.mneme/capsules/` according to TTL (30d default) + max-count cap (200 default). Audit log at `.mneme/abyss/scythe.jsonl`.", when: "Nightly via daemon; manual when capsule dir bloats." },
  { command: "mneme.abyss.revenant.archive", since: "1.76.0", group: "abyss", what: "REVENANT -- archive a soul prompt for later replay (git-reflog for cross-vendor handovers).", when: "Automatic on soul-prompt generation; manual when user says 'save this brain'." },
  { command: "mneme.abyss.revenant.list", since: "1.76.0", group: "abyss", what: "REVENANT -- list archived souls (newest first), filterable by vendor / used / unused.", when: "User asks 'show past handovers' / 'soul history'." },
  { command: "mneme.abyss.homunculus.request", since: "1.76.0", group: "abyss", what: "HOMUNCULUS -- render a write-back contract that asks the receiving AI to RETURN decisions+reasoning back at session end.", when: "Embed in outgoing soul prompts for bidirectional brain sync." },
  { command: "mneme.abyss.homunculus.ingest", since: "1.76.0", group: "abyss", what: "HOMUNCULUS -- parse a pasted `# HOMUNCULUS RETURN` block from a foreign AI and surface its decisions/reasoning/vaccines.", when: "User pastes a return block from ChatGPT/Gemini back into the editor AI." },

  // ─── v1.77 SEAMLESS (MUFFLER voice directive) ───────────────────────
  { command: "mneme.seamless.lint", since: "1.77.0", group: "seamless", what: "Scan an AI draft reply for voice violations (codenames / mode narration / version chatter / tool-name menus).", when: "Receiving AI self-checks its draft before sending. Use when user reports 'the AI is parroting Mneme jargon'." },
  { command: "mneme.seamless.silence", since: "1.77.0", group: "seamless", what: "Auto-strip Mneme codenames + standby boilerplate + version chatter from a draft reply.", when: "After lint flags issues; conservative auto-fix." },
  { command: "mneme.seamless.directive", since: "1.77.0", group: "seamless", what: "Render the 6-rule MUFFLER voice directive for custom prompts. Soul prompts + parasite bridge embed it automatically.", when: "Building a custom prompt template that should obey the same voice rules." },

  // ─── v1.78 LATTICE (intent grounding) ───────────────────────────────
  { command: "mneme.lattice.route", since: "1.78.0", group: "lattice", what: "Route a user prompt to the correct Mneme tool via hardcoded intent atoms. Stops 'update mneme ดีไหม' from being interpreted as 'optimize the previous topic'.", when: "MANDATORY first step for any prompt containing a Mneme keyword. Run BEFORE blending with conversational context." },
  { command: "mneme.lattice.score", since: "1.78.0", group: "lattice", what: "5-axis grounding score 0-100 (intent_match / context_purity / pulse_compliance / codename_silence / response_clarity).", when: "Measure cross-vendor reply quality; if <70, re-prompt or re-route." },
  { command: "mneme.lattice.dictionary", since: "1.78.0", group: "lattice", what: "Render Mneme keyword dictionary (definitions + isNot lists) so receiving AIs know what 'Mneme' literally is.", when: "Building a custom prompt that needs the same grounding receiving AIs get from soul prompts." },

  // ─── v1.79 NEURON (molecule of intelligence across 100+ tools) ──────
  { command: "mneme.neuron.triage", since: "1.79.0", group: "neuron", what: "4-strategy router (exact lattice / auto-derived from tool catalog / fuzzy trigram / keyword) returning ranked candidates + confusion flag.", when: "User prompt MIGHT match a Mneme tool but exact match isn't obvious. Run FIRST -- if confusion=true, ask user." },
  { command: "mneme.neuron.oracle", since: "1.79.0", group: "neuron", what: "Predict NEXT Mneme tool from a partial prompt prefix + recent tool calls. Autocompletion-style intent oracle.", when: "Surfacing 'did you mean…' hints while user types. Don't auto-execute below 0.9 probability." },

  // ─── v1.80 CONDUIT (cross-vendor upgrade / uninstall / sync / phantom) ──────
  { command: "mneme.conduit.detect_relay", since: "1.80.0", group: "conduit", what: "Detect whether a user prompt requires action only the source AI can run (upgrade / uninstall / shell / fs / mcp-call). Web AIs use this BEFORE freelancing.", when: "Mandatory on every user prompt when the AI is paste-only (web surface). If detected → emit CONDUIT RETURN block." },
  { command: "mneme.conduit.ingest_return", since: "1.80.0", group: "conduit", what: "Parse a pasted `# CONDUIT RETURN` block from a web AI; surface the requested action so the editor AI executes it.", when: "After user pastes a return block from ChatGPT/Gemini back into Claude Code / Cursor." },
  { command: "mneme.conduit.uninstall_plan", since: "1.80.0", group: "conduit", what: "Per-surface uninstall plan (editor-ai / web-ai / browser-userscript / browser-bookmarklet / all).", when: "User asks 'how do I remove Mneme from X?'." },
  { command: "mneme.conduit.sync_status", since: "1.80.0", group: "conduit", what: "Compare pasted soul's version vs local Mneme → in-sync / source-newer / destination-newer / unknown + recommendation.", when: "Before trusting a pasted soul prompt; surface mismatches." },
  { command: "mneme.conduit.phantom_directive", since: "1.80.0", group: "conduit", what: "Render PHANTOM EXECUTION directive; web AIs preview a tool's conceptual output WITHOUT real execution.", when: "Embedding in custom paste-only AI workflows where a preview saves a round-trip." },

  // ─── v1.81 SYNAPSE (universal cross-device sync + token compression) ───
  { command: "mneme.synapse.mint_code", since: "1.81.0", group: "synapse", what: "Mint a 6-char NEXUS code resolving to a soul prompt -- AirDrop-style PIN for cross-device handover (PC ↔ phone ↔ tablet).", when: "User wants to continue a session on another device. Generate code; user types it on destination." },
  { command: "mneme.synapse.resolve_code", since: "1.81.0", group: "synapse", what: "Resolve a NEXUS code to its soul prompt + bump resolve count. Returns null on expired/unknown.", when: "User typed a 6-char code from another device; fetch the brain." },
  { command: "mneme.synapse.qr", since: "1.81.0", group: "synapse", what: "Render any short payload (code / URL) as SVG QR for camera scan.", when: "User would rather scan than type a code." },
  { command: "mneme.synapse.compress", since: "1.81.0", group: "synapse", what: "Compress text via deterministic codebook substitution (30-50% token savings).", when: "Before pasting into a tight-context-window mobile AI app." },
  { command: "mneme.synapse.decompress", since: "1.81.0", group: "synapse", what: "Expand SYNAPSE-compressed text back to readable form.", when: "Destination AI receives a compressed prompt; expand before reading." },

  // ─── v1.82 OSMOSIS (24/7 second-brain expansion) ──────────────────────
  { command: "mneme.osmosis.consent", since: "1.82.0", group: "osmosis", what: "Grant/revoke harvesting consent per vendor. Default is OPT-OUT.", when: "User says 'let Mneme learn from my <vendor> sessions' OR 'stop harvesting from <vendor>'." },
  { command: "mneme.osmosis.harvest", since: "1.82.0", group: "osmosis", what: "Record one AI observation (reply/tool-call/refusal/verdict/decision); duplicate-protected.", when: "After significant AI turns the user wants captured for long-term wisdom." },
  { command: "mneme.osmosis.distill", since: "1.82.0", group: "osmosis", what: "Distill recent observations into a signed wisdom shard (hash-chained, tamper-evident).", when: "Nightly via daemon; or manual snapshot." },
  { command: "mneme.osmosis.verify", since: "1.82.0", group: "osmosis", what: "Verify wisdom hash-chain; detect tampering.", when: "Periodic audit; suspected external modification." },

  // ─── v1.83 AURA (same-WiFi auto-pairing, owner-only) ──────────────────
  { command: "mneme.aura.pair", since: "1.83.0", group: "aura", what: "Build a signed pairing payload (lanUrl + NEXUS code + expiry + owner fingerprint). Office neighbours on same WiFi without owner key CANNOT use it.", when: "Same-WiFi handover where user shouldn't type any URL." },
  { command: "mneme.aura.discover", since: "1.83.0", group: "aura", what: "List LAN IPv4 candidates + recommended LAN URL for this machine. NO broadcast.", when: "Before pairing: figure out which URL to embed." },

  // ─── v1.85 RELAY (cloud-less cross-device via anonymous paste) ────────
  { command: "mneme.relay.upload", since: "1.85.0", group: "relay", what: "Encrypt soul with NEXUS code, upload to anonymous paste (dpaste/paste.rs/0x0.st), return URL + mobile-friendly prompt.", when: "Cross-device handover to a mobile AI app that does NOT have Mneme (Gemini/Claude/ChatGPT on phone)." },
  { command: "mneme.relay.decrypt", since: "1.85.0", group: "relay", what: "Decrypt a fetched paste envelope with a NEXUS code.", when: "Destination AI fetched the URL; user typed the code; need to decrypt before resume." },

  // ─── v1.86 CHAMELEON (env-adaptive guards; spore default OFF) ─────────
  { command: "mneme.chameleon.probe", since: "1.86.0", group: "chameleon", what: "Detect git/CI/CODEOWNERS/ownership without external API calls. Returns pushRisky + risk reasons.", when: "Before any cross-machine git push; whenever unsure if spore is safe." },
  { command: "mneme.chameleon.select_transport", since: "1.86.0", group: "chameleon", what: "Pick safest transport given destination + env. Refuses spore-git on risky repos.", when: "Source AI deciding which transport to use." },
  { command: "mneme.chameleon.spore_opt_in", since: "1.86.0", group: "chameleon", what: "Write explicit OPT_IN marker; required AFTER v1.86 for spore push to work.", when: "User reviewed env probe risks and explicitly consented to git push." },
  { command: "mneme.chameleon.spore_gate", since: "1.86.0", group: "chameleon", what: "Evaluate spore push permission right now; returns allow/refuse + reason.", when: "ALWAYS gate before calling sporePush." },
];

const SENTINEL_BEGIN = "<!-- BEGIN MNEME MANIFEST (auto-managed -- do not edit) -->";
const SENTINEL_END = "<!-- END MNEME MANIFEST -->";
// v1.32.0 -- LIVE STATE block sentinels. Separate from the command
// manifest so the AI agent can re-read the LIVE block on every prompt
// (cheap, instant) without parsing the bigger commands list.
const LIVE_BEGIN = "<!-- BEGIN MNEME LIVE STATE (auto-managed -- do not edit) -->";
const LIVE_END = "<!-- END MNEME LIVE STATE -->";

/** Render the manifest as Markdown suitable for injection into agent
 *  files (CLAUDE.md, AGENTS.md, GEMINI.md). */
export function renderManifestMarkdown(catalog: ManifestCommand[] = MNEME_COMMAND_CATALOG, mnemeVersion: string = "?"): string {
  const grouped: Record<string, ManifestCommand[]> = {};
  for (const c of catalog) {
    (grouped[c.group] ??= []).push(c);
  }
  const lines: string[] = [];
  lines.push(SENTINEL_BEGIN);
  lines.push(``);
  lines.push(`## Mneme command manifest (v${mnemeVersion})`);
  lines.push(``);
  lines.push(`AI agent: this block is auto-maintained by Mneme. It lists every command + when to call it. Re-read on every session start -- new commands ship here within minutes of a Mneme upgrade.`);
  lines.push(``);
  const groupOrder = ["memory", "antivirus", "embeddings", "supernova", "supersonic", "uninstall", "evolve", "diagnosis", "ops", "core", "metamorphosis", "tribunal", "innerlife", "cognitive", "apoptosis", "tune", "autarchy", "aegis", "diaspora", "genesplice", "permeate", "telepathy", "abyss", "seamless", "lattice", "neuron", "conduit", "synapse", "osmosis", "aura", "relay", "chameleon"] as const;
  for (const g of groupOrder) {
    const cmds = grouped[g];
    if (!cmds || cmds.length === 0) continue;
    lines.push(`### ${g}`);
    lines.push(``);
    for (const c of cmds) {
      const alias = c.alias ? ` (alias \`${c.alias}\`)` : "";
      lines.push(`- **\`${c.command}\`**${alias} _(since v${c.since})_`);
      lines.push(`  - **What**: ${c.what}`);
      lines.push(`  - **When**: ${c.when}`);
    }
    lines.push(``);
  }
  lines.push(SENTINEL_END);
  return lines.join("\n");
}

/** Render as the rules-file format (.cursorrules / .windsurfrules) --
 *  plain text, no sentinel comments (rules files don't support HTML
 *  comments cleanly). */
export function renderManifestPlain(catalog: ManifestCommand[] = MNEME_COMMAND_CATALOG, mnemeVersion: string = "?"): string {
  const lines: string[] = [];
  lines.push(`# Mneme command manifest (v${mnemeVersion}) -- auto-maintained, do not edit between markers`);
  lines.push(``);
  for (const c of catalog) {
    const alias = c.alias ? ` (alias: ${c.alias})` : "";
    lines.push(`- ${c.command}${alias}  [since v${c.since}]`);
    lines.push(`    what: ${c.what}`);
    lines.push(`    when: ${c.when}`);
  }
  return lines.join("\n");
}

/** Upsert the manifest block into the given file. Uses sentinel markers
 *  so re-syncs replace the existing block in place without touching the
 *  rest of the file. Returns the action taken. */
export type UpsertAction = "created" | "replaced" | "unchanged" | "skipped" | "failed";
export function upsertManifestBlock(
  filePath: string,
  block: string,
  opts: { useSentinels?: boolean } = {},
): { action: UpsertAction; detail?: string } {
  const useSentinels = opts.useSentinels !== false;
  try {
    if (!existsSync(filePath)) {
      const dir = dirname(filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, block + "\n", "utf8");
      return { action: "created" };
    }
    const existing = readFileSync(filePath, "utf8");
    if (useSentinels) {
      const beginIdx = existing.indexOf(SENTINEL_BEGIN);
      const endIdx = existing.indexOf(SENTINEL_END);
      if (beginIdx >= 0 && endIdx > beginIdx) {
        const before = existing.slice(0, beginIdx);
        const after = existing.slice(endIdx + SENTINEL_END.length);
        const next = before + block + after;
        if (next === existing) return { action: "unchanged" };
        writeFileSync(filePath, next, "utf8");
        return { action: "replaced" };
      }
      // No sentinels yet -- append at end.
      if (existing.includes(block.split("\n").slice(2, 4).join("\n"))) {
        return { action: "unchanged" };
      }
      writeFileSync(filePath, existing.trimEnd() + "\n\n" + block + "\n", "utf8");
      return { action: "created" };
    }
    // Non-sentinel mode: just overwrite the file entirely (rules files).
    if (existing.trim() === block.trim()) return { action: "unchanged" };
    writeFileSync(filePath, block + "\n", "utf8");
    return { action: "replaced" };
  } catch (e) {
    return { action: "failed", detail: (e as Error).message };
  }
}

export interface SyncTarget {
  /** Filename relative to repo root. */
  path: string;
  /** Display name for the report. */
  label: string;
  /** "markdown" for files supporting <!-- comments --> sentinels, "plain"
   *  for rules files (.cursorrules / .windsurfrules / etc). */
  format: "markdown" | "plain";
}

export const DEFAULT_SYNC_TARGETS: SyncTarget[] = [
  { path: "CLAUDE.md",        label: "Claude Code (project)", format: "markdown" },
  { path: "AGENTS.md",        label: "Codex / cross-vendor",  format: "markdown" },
  { path: "GEMINI.md",        label: "Gemini CLI",            format: "markdown" },
  { path: ".cursor/rules/mneme.mdc", label: "Cursor",         format: "markdown" },
  { path: ".cursorrules",     label: "Cursor (legacy)",       format: "plain" },
  { path: ".windsurfrules",   label: "Windsurf",              format: "plain" },
];

/** Sync the manifest into every supported agent file in the repo.
 *  Returns per-target outcomes. Best-effort -- a failure on one target
 *  does not block the others. */
export function syncManifest(
  repoRoot: string,
  opts: { mnemeVersion?: string; targets?: SyncTarget[]; catalog?: ManifestCommand[] } = {},
): Array<{ target: SyncTarget; action: UpsertAction; detail?: string }> {
  const targets = opts.targets ?? DEFAULT_SYNC_TARGETS;
  const catalog = opts.catalog ?? MNEME_COMMAND_CATALOG;
  const version = opts.mnemeVersion ?? "?";
  const mdBlock = renderManifestMarkdown(catalog, version);
  const plainBlock = renderManifestPlain(catalog, version);
  return targets.map((t) => {
    const filePath = join(repoRoot, t.path);
    const block = t.format === "markdown" ? mdBlock : plainBlock;
    const result = upsertManifestBlock(filePath, block, { useSentinels: t.format === "markdown" });
    return { target: t, action: result.action, detail: result.detail };
  });
}

// ─── v1.32.0 MANIFEST PHOTONICS ENGINE: LIVE STATE block ────────────────
//
// The command-manifest block is STATIC -- it lists what commands exist.
// The LIVE STATE block is DYNAMIC -- it renders a snapshot of right-now
// reality (cache hologram, daemon health, calibration grades, recent
// proposals). The AI agent reading any agent file sees both at once:
// "here's everything I CAN do" + "here's what's true RIGHT NOW".
//
// This is the seamless-fusion layer: AI agent + Mneme as one body.
// Each prompt → AI re-reads the agent file → AI sees fresh LIVE STATE →
// adapts. No MCP round-trip needed for state inquiry.

export interface LiveStateInput {
  mnemeVersion: string;
  daemonRunning: boolean;
  daemonTickCount?: number | null;
  vaccines?: number;
  inboxUnsent?: number;
  hci?: number | null;
  memoryTier?: { name: string; stars: number; semantic: boolean } | null;
  /** From cache_hologram.snapshotHologram(). Optional -- when absent we
   *  render a notice that the hologram hasn't been initialized yet. */
  hologram?: {
    tally: { fresh: number; stale: number; total: number };
    caches: Array<{ id: string; fresh: boolean; reason: string; ageSec?: number }>;
  };
  /** Last few entries from supernova log -- shows whether self-heal
   *  has been firing. Optional. */
  supernovaTail?: Array<{ cycle: string; outcome: string; ts: string }>;
  /** Trust-grades summary -- per-subsystem band. Optional. */
  trustGrades?: Record<string, { band: string; verdict?: string }>;
}

export function renderLiveStateMarkdown(state: LiveStateInput): string {
  const lines: string[] = [];
  lines.push(LIVE_BEGIN);
  lines.push(``);
  lines.push(`## Mneme LIVE STATE (v${state.mnemeVersion}, ${new Date().toISOString().replace("T", " ").slice(0, 19)})`);
  lines.push(``);
  lines.push(`AI agent: this block reflects RIGHT-NOW reality. Re-read on every prompt -- it's refreshed by the Manifest Photonics Engine on every \`mneme manifest sync\` (which the daemon runs automatically when sources of truth shift).`);
  lines.push(``);
  // Headline line.
  const memTag = state.memoryTier ? ` · mem=${state.memoryTier.name}[${"★".repeat(state.memoryTier.stars)}]${state.memoryTier.semantic ? "" : "(DEGRADED)"}` : "";
  const hciTag = state.hci != null ? ` · HCI=${state.hci}/100` : "";
  lines.push(`**${state.daemonRunning ? "🟢 daemon running" : "🔴 daemon stopped"}**${state.daemonTickCount != null ? ` (tick #${state.daemonTickCount})` : ""} · vaccines=${state.vaccines ?? "?"} · inbox=${state.inboxUnsent ?? 0}${hciTag}${memTag}`);
  lines.push(``);
  // Cache hologram snapshot.
  if (state.hologram) {
    const t = state.hologram.tally;
    lines.push(`### Cache hologram (${t.fresh}/${t.total} fresh, ${t.stale} stale)`);
    lines.push(``);
    for (const c of state.hologram.caches) {
      const flag = c.fresh ? "✓" : "✗";
      const ageStr = c.ageSec != null ? ` · age ${c.ageSec}s` : "";
      lines.push(`- ${flag} **${c.id}** -- ${c.reason}${ageStr}`);
    }
    lines.push(``);
    lines.push(`> When a cache is stale, the next read auto-rebuilds it via PHOTONICS PROPAGATION. Any AI agent that calls a Mneme command depending on the stale cache will receive fresh data without needing a manual cache clear.`);
    lines.push(``);
  } else {
    lines.push(`### Cache hologram`);
    lines.push(``);
    lines.push(`(hologram not initialized yet -- run any \`mneme\` command to bootstrap)`);
    lines.push(``);
  }
  // Trust grades.
  if (state.trustGrades && Object.keys(state.trustGrades).length > 0) {
    lines.push(`### Trust calibration`);
    lines.push(``);
    for (const [subsystem, grade] of Object.entries(state.trustGrades)) {
      const flag = grade.band === "excellent" ? "✓" : grade.band === "acceptable" ? "·" : grade.band === "weak" ? "⚠" : "✗";
      lines.push(`- ${flag} **${subsystem}** -- ${grade.band}${grade.verdict ? `: ${grade.verdict}` : ""}`);
    }
    lines.push(``);
  }
  // Supernova self-heal tail.
  if (state.supernovaTail && state.supernovaTail.length > 0) {
    lines.push(`### SUPERNOVA self-heal (last ${state.supernovaTail.length} events)`);
    lines.push(``);
    for (const e of state.supernovaTail) {
      const flag = e.outcome === "ok" ? "✓" : e.outcome === "failed" ? "✗" : "🚨";
      const ts = e.ts.replace("T", " ").slice(0, 19);
      lines.push(`- ${flag} ${ts} \`${e.cycle}\` -- ${e.outcome}`);
    }
    lines.push(``);
  }
  lines.push(LIVE_END);
  return lines.join("\n");
}

/** Upsert the LIVE STATE block into a single file (uses LIVE_BEGIN /
 *  LIVE_END sentinels, separate from the command manifest block). */
export function upsertLiveStateBlock(filePath: string, block: string): { action: UpsertAction; detail?: string } {
  try {
    if (!existsSync(filePath)) {
      const dir = dirname(filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, block + "\n", "utf8");
      return { action: "created" };
    }
    const existing = readFileSync(filePath, "utf8");
    const beginIdx = existing.indexOf(LIVE_BEGIN);
    const endIdx = existing.indexOf(LIVE_END);
    if (beginIdx >= 0 && endIdx > beginIdx) {
      const before = existing.slice(0, beginIdx);
      const after = existing.slice(endIdx + LIVE_END.length);
      const next = before + block + after;
      if (next === existing) return { action: "unchanged" };
      writeFileSync(filePath, next, "utf8");
      return { action: "replaced" };
    }
    // Append after the manifest block (if present) or at end of file.
    const manifestEndIdx = existing.indexOf(SENTINEL_END);
    if (manifestEndIdx >= 0) {
      const insertAt = manifestEndIdx + SENTINEL_END.length;
      const next = existing.slice(0, insertAt) + "\n\n" + block + existing.slice(insertAt);
      writeFileSync(filePath, next, "utf8");
      return { action: "created" };
    }
    writeFileSync(filePath, existing.trimEnd() + "\n\n" + block + "\n", "utf8");
    return { action: "created" };
  } catch (e) {
    return { action: "failed", detail: (e as Error).message };
  }
}

/** Sync the LIVE STATE into every supported agent file. Markdown
 *  targets only -- rules files don't support sentinel blocks. */
export function syncLiveState(
  repoRoot: string,
  state: LiveStateInput,
  targets: SyncTarget[] = DEFAULT_SYNC_TARGETS.filter((t) => t.format === "markdown"),
): Array<{ target: SyncTarget; action: UpsertAction; detail?: string }> {
  const block = renderLiveStateMarkdown(state);
  return targets.map((t) => {
    const filePath = join(repoRoot, t.path);
    const result = upsertLiveStateBlock(filePath, block);
    return { target: t, action: result.action, detail: result.detail };
  });
}
