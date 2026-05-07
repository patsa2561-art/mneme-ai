/**
 * `mneme org [subcommand]` — cross-repo nervous system.
 *
 * Subcommands:
 *   init <name>            — create a registry under ~/.mneme/orgs/<name>.json
 *   add <name> <path>      — register a repo path with the org
 *   remove <name> <path>   — unregister a repo path
 *   list                   — list every registered org
 *   status [name]          — show index status of every repo in the org
 *   (default)              — run cross-repo nervous-system on the first/only org
 *
 * --json shape (stable):
 *   For list/status: { orgs: OrgRegistry[] } / { name, repos: [...] }
 *   For default:     OrgNervousSystem from @mneme-ai/core/org
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import kleur from "kleur";
import { store as storeNs, org as orgNs } from "@mneme-ai/core";
import { dbPath } from "../paths.js";
import { ui, pill } from "../ui.js";
import { iris, type PyramidSection } from "../iris/index.js";

const {
  addRepo,
  createOrg,
  deleteOrg,
  listOrgs,
  readRegistry,
  removeRepo,
  runOrgNervousSystem,
} = orgNs;

export type OrgSubcommand =
  | { kind: "init"; name: string }
  | { kind: "add"; name: string; path: string }
  | { kind: "remove"; name: string; path: string }
  | { kind: "list" }
  | { kind: "status"; name?: string }
  | { kind: "delete"; name: string }
  | { kind: "run"; name?: string };

export interface OrgOptions {
  cwd: string;
  sub: OrgSubcommand;
  json?: boolean;
}

export async function orgCommand(opts: OrgOptions): Promise<number> {
  switch (opts.sub.kind) {
    case "init":
      return runInit(opts.sub.name, opts.json);
    case "add":
      return runAdd(opts.sub.name, opts.sub.path, opts.json);
    case "remove":
      return runRemove(opts.sub.name, opts.sub.path, opts.json);
    case "list":
      return runList(opts.json);
    case "status":
      return runStatus(opts.sub.name, opts.json);
    case "delete":
      return runDelete(opts.sub.name, opts.json);
    case "run":
      return runDefault(opts.sub.name, opts.json);
  }
}

// ─── init / add / remove / delete ─────────────────────────────────────

function runInit(name: string, json?: boolean): number {
  let reg;
  try {
    reg = createOrg(name);
  } catch (err) {
    ui.error(`Could not create org: ${(err as Error).message}`);
    return 1;
  }
  if (json) {
    process.stdout.write(JSON.stringify(reg, null, 2) + "\n");
    return 0;
  }
  ui.banner();
  process.stdout.write(
    iris.render({
      headline: `🏢 Org "${reg.name}" registered`,
      sections: [
        {
          tier: "lede",
          lines: [
            `  ${kleur.gray("created:")} ${kleur.bold(reg.createdAt)}`,
            `  ${kleur.gray("repos:")}   ${kleur.bold(String(reg.repos.length))} (none yet)`,
          ],
        },
        {
          tier: "sources",
          title: "→ Try next",
          lines: [
            `    ${kleur.cyan("$")} ${kleur.bold(`mneme org add ${reg.name} /path/to/repo`)} ${kleur.gray("(register a repo)")}`,
            `    ${kleur.cyan("$")} ${kleur.bold("mneme org list")} ${kleur.gray("(show all registered orgs)")}`,
            "",
            `    ${kleur.gray("📘 How to read:")} an org is a logical grouping of repos.`,
            `    ${kleur.gray("Run `mneme index` inside each registered repo BEFORE running `mneme org`.")}`,
          ],
        },
      ],
    }) + "\n",
  );
  return 0;
}

function runAdd(name: string, path: string, json?: boolean): number {
  let reg;
  try {
    reg = addRepo(name, path);
  } catch (err) {
    ui.error(`Could not add repo: ${(err as Error).message}`);
    return 1;
  }
  if (json) {
    process.stdout.write(JSON.stringify(reg, null, 2) + "\n");
    return 0;
  }
  ui.success(
    `added ${kleur.bold(path)} to org ${kleur.bold(name)} (${reg.repos.length} repo${reg.repos.length === 1 ? "" : "s"} now registered)`,
  );
  return 0;
}

function runRemove(name: string, path: string, json?: boolean): number {
  const reg = removeRepo(name, path);
  if (!reg) {
    ui.error(`Org "${name}" not found.`);
    return 1;
  }
  if (json) {
    process.stdout.write(JSON.stringify(reg, null, 2) + "\n");
    return 0;
  }
  ui.success(
    `removed ${kleur.bold(path)} from org ${kleur.bold(name)} (${reg.repos.length} repo${reg.repos.length === 1 ? "" : "s"} remain)`,
  );
  return 0;
}

function runDelete(name: string, json?: boolean): number {
  const ok = deleteOrg(name);
  if (json) {
    process.stdout.write(JSON.stringify({ deleted: ok, name }, null, 2) + "\n");
    return ok ? 0 : 1;
  }
  if (!ok) {
    ui.error(`Org "${name}" not found.`);
    return 1;
  }
  ui.success(`deleted org ${kleur.bold(name)}`);
  return 0;
}

// ─── list / status ─────────────────────────────────────────────────────

function runList(json?: boolean): number {
  const orgs = listOrgs();
  if (json) {
    process.stdout.write(JSON.stringify({ orgs }, null, 2) + "\n");
    return 0;
  }
  ui.banner();
  if (orgs.length === 0) {
    process.stdout.write(
      iris.render({
        headline: `🏢 No orgs registered yet`,
        sections: [
          {
            tier: "lede",
            lines: [
              `  ${pill("HEADS UP", "warn")} ${kleur.gray(
                "an org is a logical grouping of repos. Cross-repo telepathy + atrophy needs ≥ 2 indexed repos in one org.",
              )}`,
            ],
          },
          {
            tier: "sources",
            title: "→ Try next",
            lines: [
              `    ${kleur.cyan("$")} ${kleur.bold("mneme org init my-team")} ${kleur.gray("(create your first org)")}`,
              `    ${kleur.cyan("$")} ${kleur.bold("mneme org add my-team /work/repo-a")} ${kleur.gray("(then add repos one at a time)")}`,
            ],
          },
        ],
      }) + "\n",
    );
    return 0;
  }
  const lines: string[] = [];
  for (const o of orgs) {
    lines.push(
      `    ${kleur.cyan("●")} ${kleur.bold(o.name)} ${kleur.gray(`(${o.repos.length} repo${o.repos.length === 1 ? "" : "s"})`)}`,
    );
    for (const r of o.repos) {
      lines.push(`        ${kleur.gray(r.path)}`);
    }
  }
  process.stdout.write(
    iris.render({
      headline: `🏢 ${orgs.length} org${orgs.length === 1 ? "" : "s"} registered`,
      sections: [
        { tier: "key-facts", title: "◆ Registered orgs", lines },
        {
          tier: "sources",
          title: "→ Try next",
          lines: [
            `    ${kleur.cyan("$")} ${kleur.bold(`mneme org status ${orgs[0]!.name}`)} ${kleur.gray("(check which repos are indexed)")}`,
            `    ${kleur.cyan("$")} ${kleur.bold(`mneme org`)} ${kleur.gray("(run cross-repo analysis)")}`,
          ],
        },
      ],
    }) + "\n",
  );
  return 0;
}

function runStatus(name: string | undefined, json?: boolean): number {
  const reg = pickOrg(name);
  if (!reg) {
    ui.error(name ? `Org "${name}" not found.` : "No orgs registered yet. Run `mneme org init <name>` first.");
    return 1;
  }
  const status = reg.repos.map((r) => {
    const indexed = existsSync(dbPath(r.path));
    return { path: r.path, indexed };
  });
  if (json) {
    process.stdout.write(
      JSON.stringify({ name: reg.name, repos: status }, null, 2) + "\n",
    );
    return 0;
  }
  ui.banner();
  const lines = status.map((s) => {
    const tag = s.indexed ? kleur.green("INDEXED ") : kleur.red("MISSING ");
    return `    ${tag} ${kleur.bold(s.path)}`;
  });
  const missing = status.filter((s) => !s.indexed).length;
  process.stdout.write(
    iris.render({
      headline: `🏢 Org "${reg.name}" — ${status.length - missing}/${status.length} repos indexed`,
      sections: [
        { tier: "key-facts", title: "◆ Per-repo status", lines },
        {
          tier: "sources",
          title: "→ Try next",
          lines:
            missing > 0
              ? [
                  `    ${kleur.cyan("$")} ${kleur.bold("cd <missing-path> && mneme index")} ${kleur.gray("(run inside each missing repo)")}`,
                ]
              : [
                  `    ${kleur.cyan("$")} ${kleur.bold(`mneme org`)} ${kleur.gray("(run cross-repo analysis)")}`,
                ],
        },
      ],
    }) + "\n",
  );
  return 0;
}

// ─── default = run cross-repo nervous system ───────────────────────────

function runDefault(name: string | undefined, json?: boolean): number {
  const reg = pickOrg(name);
  if (!reg) {
    ui.error(
      name
        ? `Org "${name}" not found. Run \`mneme org list\` to see registered orgs.`
        : "No orgs registered yet. Run `mneme org init <name>` first.",
    );
    return 1;
  }

  // Open every repo's store; collect missing ones.
  const handles: orgNs.RepoHandle[] = [];
  const reposMissing: string[] = [];
  try {
    for (const r of reg.repos) {
      const path = dbPath(r.path);
      if (!existsSync(path)) {
        reposMissing.push(r.path);
        continue;
      }
      try {
        handles.push({ path: r.path, store: new storeNs.MnemeStore(path) });
      } catch {
        reposMissing.push(r.path);
      }
    }

    const ns = runOrgNervousSystem(
      { name: reg.name, reposRequested: reg.repos.length, reposMissing },
      handles,
      { topN: 10 },
    );

    if (json) {
      process.stdout.write(JSON.stringify(ns, null, 2) + "\n");
      return 0;
    }

    return renderTerminal(ns);
  } finally {
    for (const h of handles) h.store.close();
  }
}

function renderTerminal(ns: orgNs.OrgNervousSystem): number {
  ui.banner();

  if (ns.org.reposIndexed === 0) {
    process.stdout.write(
      iris.render({
        headline: `🏢 Org "${ns.org.name}" — no indexed repos`,
        sections: [
          {
            tier: "lede",
            lines: [
              `  ${pill("HEADS UP", "warn")} ${kleur.gray("Run `mneme index` inside each registered repo first.")}`,
            ],
          },
          {
            tier: "sources",
            title: "→ Try next",
            lines: [
              `    ${kleur.cyan("$")} ${kleur.bold(`mneme org status ${ns.org.name}`)} ${kleur.gray("(see which repos are missing)")}`,
            ],
          },
        ],
      }) + "\n",
    );
    return 0;
  }

  const headline = `🏢 Org "${ns.org.name}" — ${ns.org.reposIndexed}/${ns.org.reposRequested} repos · ${ns.totals.commits} commits · ${ns.totals.authors} authors`;

  const ledeLines: string[] = [
    `  ${kleur.gray("repos indexed:")}    ${kleur.bold(`${ns.org.reposIndexed} / ${ns.org.reposRequested}`)}`,
    `  ${kleur.gray("authors merged:")}   ${kleur.bold(String(ns.totals.authors))} ${kleur.gray("(by email — distinct accounts won't merge)")}`,
    `  ${kleur.gray("files tracked:")}    ${kleur.bold(String(ns.totals.files))}`,
    `  ${kleur.gray("cross-repo pairs:")} ${kleur.bold(String(ns.crossRepoPairs.length))} ${kleur.gray("(active in ≥ 2 repos)")}`,
  ];

  const pairLines: string[] = [];
  for (const p of ns.crossRepoPairs.slice(0, 6)) {
    pairLines.push(
      `    ${kleur.bold(p.authorA.name || p.authorA.email)} ${kleur.gray("⟷")} ${kleur.bold(p.authorB.name || p.authorB.email)}  ${kleur.gray(`active in ${p.reposCovered} repos · combined score ${p.combinedScore.toFixed(2)}`)}`,
    );
    pairLines.push(
      `        ${kleur.gray(`best in ${p.bestRepo.repoPath} (score ${p.bestRepo.score.toFixed(2)}, ${p.bestRepo.events} events)`)}`,
    );
  }

  const atrophyLines: string[] = [];
  for (const f of ns.crossRepoAtrophy.slice(0, 6)) {
    const tag = renderTier(f.tier);
    atrophyLines.push(
      `    ${tag}  ${kleur.bold(f.filePath)}  ${kleur.gray(`${Math.round(f.freshestKnowledge * 100)}% fresh · ${f.totalTouches} touches · in ${f.repoPath}`)}`,
    );
  }

  const sections: PyramidSection[] = [
    { tier: "lede", title: "✦ Cross-repo summary", lines: ledeLines },
  ];
  if (pairLines.length > 0) {
    sections.push({
      tier: "key-facts",
      title: `◆ Cross-repo telepathic pairs (top ${Math.min(6, ns.crossRepoPairs.length)})`,
      lines: pairLines,
    });
  }
  if (atrophyLines.length > 0) {
    sections.push({
      tier: "body",
      title: `⚠ Atrophy heatmap across the org (top ${Math.min(6, ns.crossRepoAtrophy.length)})`,
      lines: atrophyLines,
    });
  }
  sections.push({
    tier: "sources",
    title: "→ Try next",
    lines: [
      `    ${kleur.cyan("$")} ${kleur.bold("mneme org status")} ${kleur.gray("(see if any repos still need indexing)")}`,
      `    ${kleur.cyan("$")} ${kleur.bold("mneme nervous-system")} ${kleur.gray("(deep dive on a single repo)")}`,
      "",
      `    ${kleur.gray("📘 How to read:")} cross-repo pairs only show up when the same two emails`,
      `    ${kleur.gray("appear as latent collaborators in ≥2 repos. The atrophy list ranks every")}`,
      `    ${kleur.gray("at-risk file across the whole org by tier and total touches.")}`,
    ],
  });
  if (ns.limits.length > 0) {
    sections.push({
      tier: "details",
      title: "∎ Honest limits",
      lines: ns.limits.map((l) => `    ${kleur.gray("• " + l)}`),
    });
  }

  process.stdout.write(iris.render({ headline, sections }) + "\n");
  return 0;
}

// ─── helpers ───────────────────────────────────────────────────────────

function pickOrg(name: string | undefined): orgNs.OrgRegistry | null {
  if (name) return readRegistry(name);
  const all = listOrgs();
  return all[0] ?? null;
}

function renderTier(tier: "safe" | "warn" | "at-risk"): string {
  switch (tier) {
    case "safe":
      return kleur.green().bold("SAFE   ");
    case "warn":
      return kleur.yellow().bold("WARN   ");
    case "at-risk":
      return kleur.red().bold("AT-RISK");
  }
}
