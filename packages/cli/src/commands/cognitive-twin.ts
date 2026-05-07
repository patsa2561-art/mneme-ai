/**
 * `mneme cognitive-twin <email>` — author-voice fingerprint + rewriter.
 *
 * No LLM. Stylometric features extracted deterministically from git log.
 * Optional --rewrite "<subject>" mode rewrites a generic commit subject in
 * the author's voice (apply their dominant conv-commit prefix, match their
 * lowercase preference, match their ending-punctuation habit).
 *
 * Strict ethics framing: every speculative output is ✱ shadow-opinion —
 * heuristic, NOT the author's real position. Designed for self-reflection
 * + onboarding ("here's how Alice writes — try matching her voice"), never
 * for performance review.
 */

import kleur from "kleur";
import { git, twin as twinCore } from "@mneme-ai/core";
import { ui, header, section, kv, divider, nextSteps } from "../ui.js";

export interface CognitiveTwinOptions {
  cwd: string;
  email: string;
  /** Cap commits used for the profile. */
  maxCommits?: number;
  /** Rewrite a generic commit subject in this author's voice. */
  rewrite?: string;
  json?: boolean;
}

export async function cognitiveTwinCommand(opts: CognitiveTwinOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }

  if (!opts.json) ui.banner();

  let voice;
  try {
    voice = await twinCore.profileAuthor({
      cwd: opts.cwd,
      email: opts.email,
      maxCommits: opts.maxCommits,
    });
  } catch (err) {
    ui.error(`Twin profile failed: ${(err as Error).message}`);
    return 1;
  }

  if (!voice) {
    ui.error(`No commits found for ${opts.email}.`);
    ui.dim("Tip: emails are case-sensitive in git. Try `git log --all --format='%ae' | sort -u` to find the exact spelling.");
    return 1;
  }

  if (opts.json) {
    const payload: Record<string, unknown> = { voice };
    if (opts.rewrite) {
      payload.rewrite = twinCore.rewriteInVoice(voice, opts.rewrite);
    }
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return 0;
  }

  process.stdout.write(
    header(
      "🪞",
      `Cognitive Twin — ${voice.name}`,
      `stylometric profile (heuristic, no LLM) · ${voice.sampleSize} commits · fingerprint ${voice.fingerprint}`,
      "match the author's voice when reviewing or writing in their style",
    ) + "\n",
  );

  // Length stats
  process.stdout.write(
    "\n" +
      section("Subject length") +
      "\n" +
      kv("avg / p25 / p75", `${voice.subjectLengthAvg} chars  ·  ${voice.subjectLengthP25} - ${voice.subjectLengthP75} (mid-50%)`) +
      "\n",
  );

  // Conv-commit + prefixes
  process.stdout.write(
    "\n" + section("Conventional-commit usage") + "\n" + kv("conv-commit %", `${voice.convCommitPct}%`) + "\n",
  );
  if (voice.topPrefixes.length > 0) {
    process.stdout.write("  " + kleur.gray("top prefixes:") + "\n");
    for (const p of voice.topPrefixes) {
      process.stdout.write(`    ${kleur.bold(p.prefix.padEnd(8))}  ${kleur.gray(`${p.count}× (${p.pct}%)`)}\n`);
    }
  }

  // Openers
  if (voice.topOpeners.length > 0) {
    process.stdout.write("\n" + section("Opening words (after any prefix)") + "\n");
    process.stdout.write(
      "  " +
        voice.topOpeners
          .map((o) => `${kleur.bold(o.word)} ${kleur.gray(`(${o.count})`)}`)
          .join("  ·  ") +
        "\n",
    );
  }

  // Phrases
  if (voice.topPhrases.length > 0) {
    process.stdout.write("\n" + section("Recurring phrases") + "\n");
    for (const p of voice.topPhrases.slice(0, 8)) {
      process.stdout.write(`  ${kleur.cyan(`"${p.phrase}"`)}  ${kleur.gray(`× ${p.count}`)}\n`);
    }
  }

  // Style markers
  process.stdout.write(
    "\n" +
      section("Style markers") +
      "\n" +
      kv("em-dash subjects", `${voice.punctuation.emDashPct}%`) +
      "\n" +
      kv("ends with period", `${voice.punctuation.endsWithPeriodPct}%`) +
      "\n" +
      kv("paren scope (foo:)", `${voice.punctuation.parenScopePct}%`) +
      "\n" +
      kv("lowercase content", `${voice.lowercasePct}%`) +
      "\n" +
      kv("body uses bullets", `${voice.bulletBodyPct}%`) +
      "\n" +
      kv("avg body lines", String(voice.bodyLineAvg)) +
      "\n",
  );

  if (voice.firstSeen && voice.lastSeen) {
    process.stdout.write(
      "\n" +
        section("Active span") +
        "\n" +
        kv("first commit", voice.firstSeen) +
        "\n" +
        kv("last commit", voice.lastSeen) +
        "\n",
    );
  }

  // Rewrite mode
  if (opts.rewrite) {
    const r = twinCore.rewriteInVoice(voice, opts.rewrite);
    process.stdout.write(
      "\n" +
        section("Rewrite in voice") +
        " " +
        kleur.gray(`(✱ shadow-opinion · confidence ${(r.confidence * 100).toFixed(0)}%)`) +
        "\n",
    );
    process.stdout.write(`  ${kleur.gray("input:   ")} ${kleur.white(opts.rewrite)}\n`);
    process.stdout.write(`  ${kleur.gray("rewritten:")} ${kleur.cyan(r.rewritten)}\n`);
    if (r.rules.length > 0) {
      process.stdout.write(`  ${kleur.gray("rules:    ")} ${kleur.gray(r.rules.join(", "))}\n`);
    }
    process.stdout.write("\n");
  }

  process.stdout.write("\n" + divider("📘 How to read") + "\n");
  process.stdout.write(
    "  " +
      kleur.gray(
        "Stylometric profile, computed from git log only. ✱ shadow-opinion: rewrites are heuristic\n" +
          "  templates assembled from the author's habits, NOT their real opinions. Use for onboarding\n" +
          "  ('match your team's voice'), continuity ('what would Alice prefer?'), or self-reflection.\n" +
          "  Do NOT impersonate. Do NOT use for performance review.",
      ) +
      "\n\n",
  );

  process.stdout.write(
    nextSteps([
      { cmd: `mneme cognitive-twin ${opts.email} --rewrite "<subject>"`, why: "rewrite a generic commit subject in this voice" },
      { cmd: `mneme dna ${opts.email}`, why: "the broader DNA dossier (hours, file affinity, vocabulary)" },
      { cmd: `mneme passport ${opts.email}`, why: "full engineer passport — DNA + influence + atrophy" },
    ]) + "\n",
  );

  return 0;
}
