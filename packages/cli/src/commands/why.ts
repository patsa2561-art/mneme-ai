import { git, retrieve, store, wisdom } from "@mneme-ai/core";
import { resolveEmbedder } from "@mneme-ai/embeddings";
import { dbPath } from "../paths.js";
import { readConfig } from "../config.js";
import {
  ui,
  header,
  section,
  citation,
  emptyState,
  nextSteps,
  meter,
  osc8,
} from "../ui.js";
import kleur from "kleur";

/**
 * `mneme why <file>[:<line>[-<line>]]`
 *
 * Combines blame + RAG to answer: "why does this code exist?"
 */
export interface WhyOptions {
  cwd: string;
  target: string;
  topK?: number;
}

export async function whyCommand(opts: WhyOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }

  const { file, startLine, endLine } = parseTarget(opts.target);
  const meta = await git.getRepoMeta(opts.cwd);
  const cfg = readConfig(meta.rootPath);

  const lineRange = startLine ? `:${startLine}${endLine && endLine !== startLine ? `-${endLine}` : ""}` : "";
  ui.banner();
  process.stdout.write(header("◆", `Why does this exist?`,
    `${kleur.bold(file)}${lineRange}`,
    "Find out who wrote each line + why — combines git blame with semantic search across PRs and commit messages.") + "\n\n");

  // ─── Plain-English reading guide ────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.bold("Originating commits")} ${kleur.gray("= the people who LITERALLY wrote these lines, taken from")} ${kleur.cyan("git blame")}${kleur.gray(".")}\n`);
  process.stdout.write(`    ${kleur.bold("Semantically related")} ${kleur.gray("= other commits across the WHOLE repo that talk about the same things")}\n`);
  process.stdout.write(`        ${kleur.gray("(found by Mneme's vector search — useful for backstory, design docs, related fixes).")}\n`);
  process.stdout.write(`    ${kleur.green("● green dot")}  ${kleur.gray("= commit is in Mneme's index, full message available.")}\n`);
  process.stdout.write(`    ${kleur.yellow("● yellow dot")} ${kleur.gray("= commit not yet indexed; we showed you what")} ${kleur.cyan("git")} ${kleur.gray("knows. Run")} ${kleur.bold("mneme index")} ${kleur.gray("to fill in.")}\n\n`);

  const blamed = await git.blame(meta.rootPath, file, startLine, endLine);
  if (!blamed.length) {
    process.stdout.write(emptyState(
      "No blame data available.",
      [
        `File "${file}" may be untracked or the path is wrong.`,
        `Try a tracked file: \`git ls-files | head\` to find one.`,
      ],
    ));
    return 1;
  }

  const tally = new Map<string, { count: number; sample: string }>();
  for (const b of blamed) {
    const cur = tally.get(b.commitHash);
    if (cur) cur.count++;
    else tally.set(b.commitHash, { count: 1, sample: b.content });
  }
  const ranked = Array.from(tally.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);

  // ─── Smart insight: lines per commit distribution ────────────────
  const totalBlamed = blamed.length;
  const topCommitShare = ranked[0] ? (ranked[0][1].count / totalBlamed) : 0;
  const insight = (() => {
    if (ranked.length === 1) {
      return `This region was authored entirely in ${kleur.bold("one commit")} — likely an atomic feature.`;
    }
    if (topCommitShare >= 0.7) {
      return `${Math.round(topCommitShare * 100)}% of these lines come from a single commit — the rest are minor edits.`;
    }
    if (ranked.length >= 4) {
      return `This region has churned across ${kleur.bold(String(tally.size))} commits — read all of them to understand intent.`;
    }
    return `${tally.size} commits shaped this region — top ${ranked.length} cover ${Math.round((ranked.reduce((a, [, b]) => a + b.count, 0) / totalBlamed) * 100)}% of lines.`;
  })();
  process.stdout.write(`  ${kleur.cyan("ℹ")}  ${insight}\n\n`);

  process.stdout.write(section("◆ Originating commits", `(by lines authored)`) + "\n\n");
  const s = new store.MnemeStore(dbPath(meta.rootPath));

  // Wisdom Mutant — implicit positive signal: looking up `why` on a commit
  // that recently appeared in an `ask` result means the user found it useful.
  try {
    for (const [hash] of ranked) wisdom.recordImplicitRevisit(s, hash);
  } catch {
    // ignore — wisdom recording is never load-bearing
  }

  let needsReindex = false;
  for (const [hash, { count }] of ranked) {
    let c = s.getCommit(hash);
    let inIndex = !!c;
    // Fallback: if commit isn't in the index yet, ask git directly so the
    // user always sees subject + author + date instead of a bare "(not indexed)".
    if (!c) {
      needsReindex = true;
      try {
        const raw = await git.execGitOk(
          ["show", "--no-patch", "--format=%H%n%h%n%an%n%aI%n%s", hash],
          { cwd: opts.cwd },
        );
        const [fullHash, shortHash, authorName, authorDate, ...subjectParts] = raw.trim().split("\n");
        c = {
          hash: fullHash || hash,
          shortHash: shortHash || hash.slice(0, 7),
          authorName: authorName || "unknown",
          authorEmail: "",
          authorDate: authorDate || "",
          committerDate: authorDate || "",
          subject: subjectParts.join("\n") || "(no subject)",
          body: "",
          files: [],
          parents: [],
        };
      } catch {
        // git lookup failed too — render the bare fallback we had before.
        process.stdout.write(`    ${kleur.yellow("○")} ${kleur.bold(hash.slice(0, 8))}  ${kleur.gray("(this commit isn't in Mneme's memory yet — run ")}${kleur.bold("mneme index")}${kleur.gray(" to see its details)")}\n`);
        continue;
      }
    }
    const url = commitUrl(c.hash, meta);
    const linkHash = osc8(url, kleur.bold(c.shortHash));
    const dot = inIndex ? kleur.green("●") : kleur.yellow("●");
    const meterRatio = count / Math.max(1, ranked[0]![1].count);
    process.stdout.write(
      `    ${dot} ${linkHash}  ${meter(meterRatio, { width: 8, level: "ok" })}  ${kleur.gray(`${count} lines · ${c.authorDate.slice(0, 10)} · ${c.authorName}`)}\n`,
    );
    process.stdout.write(`      ${kleur.white(c.subject)}\n`);
  }
  if (needsReindex) {
    process.stdout.write(
      `\n  ${kleur.yellow("!")} ${kleur.gray("Some commits aren't indexed yet — run `mneme index` to unlock semantic retrieval below.")}\n`,
    );
  }
  process.stdout.write("\n");

  if (s.countChunks() > 0) {
    const embedder = await resolveEmbedder({
      provider: cfg.embeddings.provider,
      model: cfg.embeddings.model,
      baseUrl: cfg.embeddings.baseUrl,
    });
    const seedQuery = ranked
      .map(([h]) => s.getCommit(h)?.subject)
      .filter(Boolean)
      .join("\n");
    if (seedQuery.trim()) {
      const related = await retrieve.search(seedQuery, {
        store: s,
        embedder,
        repo: meta,
        topK: opts.topK ?? 5,
      });
      const filtered = related.filter((r) => !tally.has(r.commit.hash));
      if (filtered.length) {
        process.stdout.write(section("◇ Semantically related",
          `(commits that talk about the same things, not in this region)`) + "\n\n");
        for (const r of filtered.slice(0, 5)) {
          const c = r.commit;
          const url = commitUrl(c.hash, meta);
          process.stdout.write(citation({
            shortHash: c.shortHash,
            date: c.authorDate.slice(0, 10),
            author: c.authorName,
            subject: c.subject,
            url,
            trailing: `score ${r.score.toFixed(2)}`,
          }) + "\n");
        }
        process.stdout.write("\n");
      }
    }
  }

  // ─── Smart next steps ────────────────────────────────────────────
  const topHash = ranked[0]?.[0];
  const acts: Array<{ cmd: string; why: string }> = [];
  if (topHash) {
    acts.push({
      cmd: `mneme ask "why does ${file.split("/").pop()} exist?"`,
      why: `Get a synthesized answer with citations across the whole repo.`,
    });
    acts.push({
      cmd: `mneme blast ${topHash.slice(0, 8)}`,
      why: `What else might break if this commit is reverted?`,
    });
  }
  if (acts.length > 0) process.stdout.write(nextSteps(acts) + "\n\n");

  s.close();
  return 0;
}

function parseTarget(s: string): { file: string; startLine?: number; endLine?: number } {
  const m = s.match(/^(.+?)(?::(\d+)(?:-(\d+))?)?$/);
  if (!m) return { file: s };
  return {
    file: m[1]!,
    startLine: m[2] ? Number(m[2]) : undefined,
    endLine: m[3] ? Number(m[3]) : m[2] ? Number(m[2]) : undefined,
  };
}

function commitUrl(hash: string, meta: { host?: string; owner?: string; repo?: string }): string | undefined {
  if (!meta?.owner || !meta?.repo) return undefined;
  if (meta.host === "github") return `https://github.com/${meta.owner}/${meta.repo}/commit/${hash}`;
  if (meta.host === "gitlab") return `https://gitlab.com/${meta.owner}/${meta.repo}/-/commit/${hash}`;
  if (meta.host === "bitbucket") return `https://bitbucket.org/${meta.owner}/${meta.repo}/commits/${hash}`;
  return undefined;
}
