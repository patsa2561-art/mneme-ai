/**
 * graphWisdom — derives plain-English, repo-specific explanations for the
 * structure of the nervous-system graph. Uses real per-author windows,
 * real file overlap, real commit counts. No generic prose.
 *
 * Pure function. No I/O. Same data → same wisdom.
 */

import type { NervousSystemData, PassportData } from "../types";

export type IsolatedReason =
  | "bot"
  | "tool-account"
  | "drive-by"
  | "solo-day"
  | "time-island"
  | "file-island";

export interface IsolatedNode {
  name: string;
  email: string;
  reason: IsolatedReason;
  /** Short tag rendered in the reason chip. */
  reasonLabel: string;
  /** Plain-English explanation grounded in this author's real numbers. */
  explain: string;
  /** Concrete evidence rendered as small mono-text bullet points. */
  evidence: string[];
  commitCount: number;
  activeDays: number;
  fromDate: string;
  toDate: string;
}

export interface GraphComponent {
  size: number;
  members: Array<{ name: string; email: string }>;
  /** Bridge node — highest-degree within the component, if removing it would obviously split things. */
  bridge: { name: string; email: string } | null;
  /** Top topic shared in the component, if telepathy carries one. */
  dominantTopic: string | null;
  /** Total events across all edges in this component. */
  edgeEvents: number;
}

export interface GraphWisdom {
  totalNodes: number;
  totalEdges: number;
  components: GraphComponent[];
  isolated: IsolatedNode[];
  /** "What this picture is telling you in one sentence." */
  headline: string;
  /** Earliest commit date observed across all author windows (YYYY-MM-DD). null = no data. */
  repoFirstCommit: string | null;
  /** Latest commit date observed across all author windows (YYYY-MM-DD). null = no data. */
  repoLastCommit: string | null;
  /** Span between first and last commit, in days. */
  repoSpanDays: number;
}

const BOT_PATTERNS = [
  /\bbot\b/i,
  /\[bot\]/i,
  /renovate/i,
  /dependabot/i,
  /github-actions/i,
  /noreply@github\.com$/i,
];

const TOOL_ACCOUNT_PATTERNS = [/TOKEN$/i, /^CI[_-]/i, /[_-]TOKEN$/i, /^automation/i];

function fmtDate(iso: string): string {
  // Expect "YYYY-MM-DD…" — keep only the date portion.
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m ? m[1]! : iso.slice(0, 10);
}

function dayDiff(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

function windowsOverlap(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  return Date.parse(aFrom) <= Date.parse(bTo) && Date.parse(bFrom) <= Date.parse(aTo);
}

function classifyIsolated(
  passport: PassportData,
  others: PassportData[],
  myFiles: Set<string>,
  othersFiles: Set<string>,
): { reason: IsolatedReason; reasonLabel: string; explain: string; evidence: string[] } {
  const name = passport.identity.name;
  const email = passport.identity.email;
  const haystack = `${name} ${email}`;
  const commits = passport.identity.commitCount;
  const days = passport.identity.activeDays;
  const fromD = fmtDate(passport.identity.fromDate);
  const toD = fmtDate(passport.identity.toDate);

  // Tool / bot detection first — most specific.
  if (TOOL_ACCOUNT_PATTERNS.some((p) => p.test(name))) {
    return {
      reason: "tool-account",
      reasonLabel: "TOOL ACCOUNT",
      explain: `${name} is a service-account / token, not a person. Git attributed ${commits} commit${commits === 1 ? "" : "s"} to it because the repo is configured that way, but there is no human behind the keyboard — so it correctly has zero collaboration edges.`,
      evidence: [
        `${commits} commit${commits === 1 ? "" : "s"} attributed`,
        `name pattern matches automation account`,
        `should never connect — this is by design`,
      ],
    };
  }
  if (BOT_PATTERNS.some((p) => p.test(haystack))) {
    return {
      reason: "bot",
      reasonLabel: "BOT",
      explain: `${name} is a bot (CI / dependency / auto-PR). It pushes on its own cadence — not on the same calendar day as humans — so the same-day-coactivity proxy never finds an overlap. Edges to bots are deliberately not formed.`,
      evidence: [
        `${commits} automated commit${commits === 1 ? "" : "s"} (${fromD} → ${toD})`,
        `active ${days} day${days === 1 ? "" : "s"}, none coincided with a human's day`,
        `expected behaviour, not a data problem`,
      ],
    };
  }

  // Drive-by — exactly one commit, no chance to coincide on a second day.
  if (commits === 1) {
    const file = [...myFiles][0];
    return {
      reason: "drive-by",
      reasonLabel: "DRIVE-BY",
      explain: `${name} made exactly one commit (${fromD}) and never returned. The same-day proxy needs at least two same-day overlaps with someone else to create an edge — a single commit can't satisfy that. Probably a one-off contributor, doc fix, or external PR.`,
      evidence: [
        `1 commit on ${fromD}`,
        file ? `touched ${file}` : `no file detail in window`,
        `no second commit ⇒ no chance to coincide twice`,
      ],
    };
  }

  // Solo-day — multiple commits but compressed into a single calendar day no one else worked.
  if (days === 1) {
    return {
      reason: "solo-day",
      reasonLabel: "SOLO DAY",
      explain: `${name} pushed ${commits} commits but all on a single day (${fromD}) when no other tracked author committed. They were here, just on a day everyone else was elsewhere — vacation, weekend, focused sprint. Live mode's same-day proxy has nothing to anchor an edge to.`,
      evidence: [
        `${commits} commits, all on ${fromD}`,
        `no other author committed that day`,
        `full Mneme would still find file-overlap evidence`,
      ],
    };
  }

  // Time-island — their entire window doesn't overlap any other author's window.
  const overlappingPeers = others.filter((p) =>
    windowsOverlap(passport.identity.fromDate, passport.identity.toDate, p.identity.fromDate, p.identity.toDate),
  );
  if (overlappingPeers.length === 0) {
    const span = dayDiff(passport.identity.fromDate, passport.identity.toDate);
    return {
      reason: "time-island",
      reasonLabel: "TIME ISLAND",
      explain: `${name} was active ${fromD} → ${toD}${span > 0 ? ` (~${span} days)` : ""}, but every other author's window is outside that range. Different tenure, different era — they simply weren't in the repo at the same time as anyone else, so a same-day edge can never form.`,
      evidence: [
        `${commits} commits across ${days} day${days === 1 ? "" : "s"}`,
        `window: ${fromD} → ${toD}`,
        `0 of ${others.length} other authors' windows overlap`,
      ],
    };
  }

  // File-island — their window overlaps others, but none of their files do.
  let sharedFile: string | null = null;
  for (const f of myFiles) {
    if (othersFiles.has(f)) {
      sharedFile = f;
      break;
    }
  }
  if (!sharedFile) {
    const sample = [...myFiles].slice(0, 2).join(", ");
    return {
      reason: "file-island",
      reasonLabel: "FILE ISLAND",
      explain: `${name} works in a corner of the repo no one else touches — ${sample || "files outside everyone else's footprint"}. They were active in the same window as ${overlappingPeers.length} other author${overlappingPeers.length === 1 ? "" : "s"}, but on different days *and* different files. Could be ownership of an isolated module — worth checking the bus factor.`,
      evidence: [
        `${commits} commits across ${days} day${days === 1 ? "" : "s"}`,
        sample ? `top files: ${sample}` : `no shared file with any other author`,
        `${overlappingPeers.length} peers share their time window, none share their files`,
      ],
    };
  }

  // Fallback solo-day — overlaps in time and files, but no same-day commit luck.
  return {
    reason: "solo-day",
    reasonLabel: "SOLO DAY",
    explain: `${name} (${commits} commits, ${days} active days) shares files with ${overlappingPeers.length} other author${overlappingPeers.length === 1 ? "" : "s"} but never committed on the same day as them. Live mode only forms an edge from same-day commits — full Mneme would catch the file overlap and connect them.`,
    evidence: [
      `${commits} commits across ${days} day${days === 1 ? "" : "s"}`,
      `shares file ${sharedFile} with at least one peer`,
      `no same-day commit ⇒ live-mode edge missing`,
    ],
  };
}

/** Build connected components via union-find on the telepathy edges. */
function buildComponents(emails: string[], edges: Array<{ a: string; b: string }>): string[][] {
  const parent = new Map<string, string>();
  for (const e of emails) parent.set(e, e);
  const find = (x: string): string => {
    let cur = x;
    while (parent.get(cur) !== cur) cur = parent.get(cur)!;
    parent.set(x, cur);
    return cur;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const e of edges) {
    if (parent.has(e.a) && parent.has(e.b)) union(e.a, e.b);
  }
  const groups = new Map<string, string[]>();
  for (const e of emails) {
    const root = find(e);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(e);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length);
}

export function computeGraphWisdom(data: NervousSystemData): GraphWisdom {
  const passports = data.passports ?? [];
  const pairs = data.telepathy?.pairs ?? [];
  if (passports.length === 0) {
    return {
      totalNodes: 0,
      totalEdges: 0,
      components: [],
      isolated: [],
      headline: "No authors in the current time window.",
      repoFirstCommit: null,
      repoLastCommit: null,
      repoSpanDays: 0,
    };
  }

  // Real repo bounds: min(fromDate) → max(toDate) across every author.
  // These come from actual commit timestamps (per-author min/max), so they
  // reflect the genuine first push and the most-recent push in the repo.
  let minMs = Infinity;
  let maxMs = -Infinity;
  for (const p of passports) {
    const a = Date.parse(p.identity.fromDate);
    const b = Date.parse(p.identity.toDate);
    if (Number.isFinite(a) && a < minMs) minMs = a;
    if (Number.isFinite(b) && b > maxMs) maxMs = b;
  }
  const repoFirstCommit = Number.isFinite(minMs) ? fmtDate(new Date(minMs).toISOString()) : null;
  const repoLastCommit = Number.isFinite(maxMs) ? fmtDate(new Date(maxMs).toISOString()) : null;
  const repoSpanDays =
    Number.isFinite(minMs) && Number.isFinite(maxMs)
      ? Math.max(0, Math.round((maxMs - minMs) / 86400000))
      : 0;

  const emails = passports.map((p) => p.identity.email.toLowerCase());
  const edges = pairs.map((p) => ({
    a: p.authorA.email.toLowerCase(),
    b: p.authorB.email.toLowerCase(),
    events: p.events,
    topic: p.topTopic.topic,
  }));

  const degree = new Map<string, number>();
  for (const e of emails) degree.set(e, 0);
  for (const e of edges) {
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
  }

  const filesByAuthor = new Map<string, Set<string>>();
  for (const p of passports) {
    const set = new Set<string>();
    for (const f of p.expertise.topFiles) set.add(f.filePath);
    filesByAuthor.set(p.identity.email.toLowerCase(), set);
  }
  const allOtherFiles = (excludeEmail: string): Set<string> => {
    const out = new Set<string>();
    for (const [k, v] of filesByAuthor) {
      if (k === excludeEmail) continue;
      for (const f of v) out.add(f);
    }
    return out;
  };

  const isolated: IsolatedNode[] = [];
  for (const p of passports) {
    const e = p.identity.email.toLowerCase();
    if ((degree.get(e) ?? 0) > 0) continue;
    const myFiles = filesByAuthor.get(e) ?? new Set<string>();
    const others = passports.filter((q) => q.identity.email.toLowerCase() !== e);
    const othersFiles = allOtherFiles(e);
    const c = classifyIsolated(p, others, myFiles, othersFiles);
    isolated.push({
      name: p.identity.name,
      email: p.identity.email,
      reason: c.reason,
      reasonLabel: c.reasonLabel,
      explain: c.explain,
      evidence: c.evidence,
      commitCount: p.identity.commitCount,
      activeDays: p.identity.activeDays,
      fromDate: fmtDate(p.identity.fromDate),
      toDate: fmtDate(p.identity.toDate),
    });
  }
  // Loudest first: bots/tools last (least interesting), file/time islands first.
  const order: IsolatedReason[] = ["file-island", "time-island", "solo-day", "drive-by", "bot", "tool-account"];
  isolated.sort((a, b) => order.indexOf(a.reason) - order.indexOf(b.reason));

  const connectedEmails = emails.filter((e) => (degree.get(e) ?? 0) > 0);
  const componentGroups = buildComponents(
    connectedEmails,
    edges.map((e) => ({ a: e.a, b: e.b })),
  );

  const nameOf = (email: string): string =>
    passports.find((p) => p.identity.email.toLowerCase() === email)?.identity.name ?? email;

  const components: GraphComponent[] = componentGroups.map((group) => {
    const members = group.map((e) => ({ name: nameOf(e), email: e }));
    const sortedByDegree = [...group].sort(
      (a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0),
    );
    const bridgeEmail = sortedByDegree[0];
    const bridge =
      bridgeEmail && group.length >= 3
        ? { name: nameOf(bridgeEmail), email: bridgeEmail }
        : null;

    const groupSet = new Set(group);
    const topicCounts = new Map<string, number>();
    let edgeEvents = 0;
    for (const e of edges) {
      if (groupSet.has(e.a) && groupSet.has(e.b)) {
        topicCounts.set(e.topic, (topicCounts.get(e.topic) ?? 0) + e.events);
        edgeEvents += e.events;
      }
    }
    const dominant = [...topicCounts.entries()].sort((x, y) => y[1] - x[1])[0];

    return {
      size: group.length,
      members,
      bridge,
      dominantTopic: dominant ? dominant[0] : null,
      edgeEvents,
    };
  });

  const totalNodes = passports.length;
  const totalEdges = pairs.length;
  let headline: string;
  if (totalEdges === 0) {
    headline = `${totalNodes} author${totalNodes === 1 ? "" : "s"} in this window — zero collaboration edges. Either people work in different rhythms, or live mode's same-day proxy is too coarse for this repo.`;
  } else if (components.length === 1 && isolated.length === 0) {
    headline = `One single team. Every author co-occurred with someone — collaboration network is fully connected.`;
  } else if (components.length === 1) {
    headline = `Main team of ${components[0]!.size}, with ${isolated.length} unconnected node${isolated.length === 1 ? "" : "s"} on the side. Each isolation is explained below — most are bots, drive-by contributors, or time-island authors.`;
  } else {
    headline = `${components.length} disconnected islands of collaboration${isolated.length > 0 ? `, plus ${isolated.length} fully-isolated node${isolated.length === 1 ? "" : "s"}` : ""}. The reason for each isolation is shown below — silos are worth investigating, time-islands usually aren't.`;
  }

  return {
    totalNodes,
    totalEdges,
    components,
    isolated,
    headline,
    repoFirstCommit,
    repoLastCommit,
    repoSpanDays,
  };
}
