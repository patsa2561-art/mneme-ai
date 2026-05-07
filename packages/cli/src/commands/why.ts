import { git, retrieve, store, wisdom } from "@mneme-ai/core";
import { resolveEmbedder } from "@mneme-ai/embeddings";
import { dbPath } from "../paths.js";
import { readConfig } from "../config.js";
import { ui, meter, osc8 } from "../ui.js";
import {
  iris,
  recordCommandRun,
  renderCommit,
  renderFile,
  type PyramidSection,
} from "../iris/index.js";
import kleur from "kleur";

/**
 * `mneme why <file>[:<line>[-<line>]]`
 *
 * Combines blame + RAG to answer: "why does this code exist?"
 *
 * Rendering goes through Iris (inverted-pyramid). Data extraction (git blame +
 * semantic retrieval) is unchanged — only the layout/presentation moved.
 */
export interface WhyOptions {
  cwd: string;
  target: string;
  topK?: number;
  /** Show details tier in full instead of collapsed. */
  verbose?: boolean;
}

export async function whyCommand(opts: WhyOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }

  const { file, startLine, endLine } = parseTarget(opts.target);
  const meta = await git.getRepoMeta(opts.cwd);
  const cfg = readConfig(meta.rootPath);

  const lineRange = startLine
    ? `${startLine}${endLine && endLine !== startLine ? `-${endLine}` : ""}`
    : "";

  const blamed = await git.blame(meta.rootPath, file, startLine, endLine);
  if (!blamed.length) {
    ui.banner();
    process.stdout.write(
      iris.render({
        headline: `📰 WHY ${file}${lineRange ? `:${lineRange}` : ""} — file not blamable`,
        sections: [
          {
            tier: "lede",
            lines: [
              `${kleur.gray("○")} ${kleur.bold("No blame data available.")}`,
              `   ${kleur.gray(`File "${file}" may be untracked or the path is wrong.`)}`,
              `   ${kleur.gray("Try a tracked file: `git ls-files | head` to find one.")}`,
            ],
          },
        ],
        verbose: opts.verbose,
      }) + "\n",
    );
    return 1;
  }

  // ─── Tally blame by commit (preserves existing logic) ────────────────
  const tally = new Map<string, { count: number; sample: string }>();
  for (const b of blamed) {
    const cur = tally.get(b.commitHash);
    if (cur) cur.count++;
    else tally.set(b.commitHash, { count: 1, sample: b.content });
  }
  const ranked = Array.from(tally.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);

  const totalBlamed = blamed.length;
  const topCommitShare = ranked[0] ? ranked[0][1].count / totalBlamed : 0;

  // ─── Resolve commit details from store (or git fallback) ─────────────
  const s = new store.MnemeStore(dbPath(meta.rootPath));
  try {
    for (const [hash] of ranked) wisdom.recordImplicitRevisit(s, hash);
  } catch {
    // wisdom recording is never load-bearing
  }

  let needsReindex = false;
  type ResolvedCommit = {
    hash: string;
    shortHash: string;
    authorName: string;
    authorDate: string;
    subject: string;
    inIndex: boolean;
    count: number;
  };
  const resolvedCommits: ResolvedCommit[] = [];

  for (const [hash, { count }] of ranked) {
    let c = s.getCommit(hash);
    let inIndex = !!c;
    if (!c) {
      needsReindex = true;
      try {
        const raw = await git.execGitOk(
          ["show", "--no-patch", "--format=%H%n%h%n%an%n%aI%n%s", hash],
          { cwd: opts.cwd },
        );
        const [fullHash, shortHash, authorName, authorDate, ...subjectParts] = raw
          .trim()
          .split("\n");
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
        // git lookup also failed — synthesize a placeholder so we still render.
        c = {
          hash,
          shortHash: hash.slice(0, 7),
          authorName: "unknown",
          authorEmail: "",
          authorDate: "",
          committerDate: "",
          subject: "(this commit isn't in Mneme's memory yet — run `mneme index`)",
          body: "",
          files: [],
          parents: [],
        };
      }
    }
    resolvedCommits.push({
      hash: c.hash,
      shortHash: c.shortHash,
      authorName: c.authorName,
      authorDate: c.authorDate,
      subject: c.subject,
      inIndex,
      count,
    });
  }

  // ─── Headline (extractive — fast, no LLM) ─────────────────────────────
  const totalCommits = tally.size;
  const dateRange = (() => {
    const dates = resolvedCommits
      .map((r) => r.authorDate.slice(0, 10))
      .filter((d) => d.length > 0)
      .sort();
    if (dates.length === 0) return "";
    const first = dates[0]!;
    const last = dates[dates.length - 1]!;
    return first === last ? first : `${first} → ${last}`;
  })();
  const topAuthor = resolvedCommits[0]?.authorName ?? "—";
  const headlineParts = [
    `📰 WHY ${file}${lineRange ? `:${lineRange}` : ""}`,
    `${totalCommits} commit${totalCommits === 1 ? "" : "s"}${dateRange ? ` across ${dateRange}` : ""}`,
    `most by ${topAuthor}`,
  ];
  const headline = headlineParts.join(" — ");

  // ─── Lede: 2-line summary ─────────────────────────────────────────────
  const ledeLines: string[] = [];
  ledeLines.push(
    `${kleur.cyan("ℹ")}  ${kleur.bold(renderFile(file, { lineRange: lineRange || undefined }))} — ${totalBlamed} line${totalBlamed === 1 ? "" : "s"} blamed across ${totalCommits} commit${totalCommits === 1 ? "" : "s"}.`,
  );
  if (resolvedCommits.length === 1) {
    ledeLines.push(
      `   ${kleur.gray("Authored entirely in")} ${kleur.bold("one commit")} ${kleur.gray("— likely an atomic feature.")}`,
    );
  } else if (topCommitShare >= 0.7) {
    ledeLines.push(
      `   ${kleur.gray(`${Math.round(topCommitShare * 100)}% of these lines come from a single commit; the rest are minor edits.`)}`,
    );
  } else if (resolvedCommits.length >= 4) {
    ledeLines.push(
      `   ${kleur.gray("This region has churned across")} ${kleur.bold(String(totalCommits))} ${kleur.gray("commits — read all of them to understand intent.")}`,
    );
  } else {
    const cumPct = Math.round(
      (ranked.reduce((a, [, b]) => a + b.count, 0) / totalBlamed) * 100,
    );
    ledeLines.push(
      `   ${kleur.gray(`Top ${ranked.length} commits cover ${cumPct}% of lines.`)}`,
    );
  }

  // ─── Key facts: blame-based originating commits ───────────────────────
  const keyFactLines: string[] = [];
  for (const r of resolvedCommits) {
    const url = commitUrl(r.hash, meta);
    const meterRatio = r.count / Math.max(1, resolvedCommits[0]!.count);
    const linkHash = osc8(url, kleur.bold(r.shortHash));
    const dot = r.inIndex ? kleur.green("●") : kleur.yellow("●");
    keyFactLines.push(
      `${dot} ${linkHash}  ${meter(meterRatio, { width: 8, level: "ok" })}  ${kleur.gray(`${r.count} line${r.count === 1 ? "" : "s"} · ${r.authorDate.slice(0, 10)} · ${r.authorName}`)}`,
    );
    keyFactLines.push(`  ${kleur.white(r.subject)}`);
  }
  if (needsReindex) {
    keyFactLines.push(
      `${kleur.yellow("!")} ${kleur.gray("Some commits aren't indexed yet — run `mneme index` to unlock semantic retrieval.")}`,
    );
  }

  // ─── Details: semantically-related commits (collapsed by default) ─────
  const detailLines: string[] = [];
  if (s.countChunks() > 0) {
    try {
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
        for (const r of filtered.slice(0, 5)) {
          const c = r.commit;
          const url = commitUrl(c.hash, meta);
          detailLines.push(
            renderCommit(
              {
                hash: c.hash,
                shortHash: c.shortHash,
                subject: c.subject,
                authorName: c.authorName,
                authorDate: c.authorDate,
              },
              { compact: true, url },
            ) + ` ${kleur.gray(`(score ${r.score.toFixed(2)})`)}`,
          );
        }
      }
    } catch {
      // semantic search is best-effort — never fail the command.
    }
  }

  // ─── Sources (try-next) ───────────────────────────────────────────────
  const topHash = resolvedCommits[0]?.hash;
  const sourceLines: string[] = [];
  if (topHash) {
    sourceLines.push(
      `${kleur.cyan("$")} ${kleur.bold(`mneme ask "why does ${file.split("/").pop()} exist?"`)}`,
    );
    sourceLines.push(
      `   ${kleur.gray("Synthesized answer with citations across the whole repo.")}`,
    );
    sourceLines.push(
      `${kleur.cyan("$")} ${kleur.bold(`mneme blast ${topHash.slice(0, 8)}`)}`,
    );
    sourceLines.push(
      `   ${kleur.gray("What else might break if this commit is reverted?")}`,
    );
    sourceLines.push(
      `${kleur.cyan("$")} ${kleur.bold(`mneme forensics anomaly --threshold 1.5`)}`,
    );
    sourceLines.push(
      `   ${kleur.gray("Hunt for unusual commits across the whole history.")}`,
    );
  }

  ui.banner();
  const sections: PyramidSection[] = [
    { tier: "lede", lines: ledeLines },
    {
      tier: "key-facts",
      title: "◆ Originating commits (by lines authored)",
      lines: keyFactLines,
    },
  ];
  if (detailLines.length > 0) {
    sections.push({
      tier: "details",
      title: "◇ Semantically related",
      lines: detailLines,
    });
  }
  if (sourceLines.length > 0) {
    sections.push({
      tier: "sources",
      title: "→ Try next",
      lines: sourceLines,
    });
  }

  process.stdout.write(
    iris.render({
      headline,
      sections,
      verbose: opts.verbose,
    }) + "\n",
  );

  s.close();
  try {
    recordCommandRun(meta.rootPath, "why");
  } catch {
    // best-effort — never fail the command on telemetry write.
  }
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

function commitUrl(
  hash: string,
  meta: { host?: string; owner?: string; repo?: string },
): string | undefined {
  if (!meta?.owner || !meta?.repo) return undefined;
  if (meta.host === "github") return `https://github.com/${meta.owner}/${meta.repo}/commit/${hash}`;
  if (meta.host === "gitlab")
    return `https://gitlab.com/${meta.owner}/${meta.repo}/-/commit/${hash}`;
  if (meta.host === "bitbucket")
    return `https://bitbucket.org/${meta.owner}/${meta.repo}/commits/${hash}`;
  return undefined;
}
