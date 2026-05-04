import { execGit } from "./exec.js";

export interface BlameLine {
  commitHash: string;
  authorName: string;
  authorTime: number;
  lineNumber: number;
  content: string;
}

export async function blame(
  cwd: string,
  filePath: string,
  startLine?: number,
  endLine?: number,
): Promise<BlameLine[]> {
  const args = ["blame", "--porcelain"];
  if (startLine && endLine) args.push("-L", `${startLine},${endLine}`);
  args.push(filePath);

  const r = await execGit(args, { cwd });
  if (r.code !== 0) return [];
  return parseBlamePorcelain(r.stdout);
}

function parseBlamePorcelain(raw: string): BlameLine[] {
  const lines = raw.split("\n");
  const commitMeta = new Map<string, { author?: string; authorTime?: number }>();
  const result: BlameLine[] = [];
  let i = 0;
  while (i < lines.length) {
    const header = lines[i];
    if (!header) {
      i++;
      continue;
    }
    const m = header.match(/^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/);
    if (!m) {
      i++;
      continue;
    }
    const hash = m[1]!;
    const lineNum = Number(m[2]);
    let meta = commitMeta.get(hash);
    if (!meta) {
      meta = {};
      commitMeta.set(hash, meta);
    }
    i++;
    while (i < lines.length && !lines[i]!.startsWith("\t")) {
      const ln = lines[i]!;
      if (ln.startsWith("author ")) meta.author = ln.slice(7);
      else if (ln.startsWith("author-time ")) meta.authorTime = Number(ln.slice(12));
      i++;
    }
    const content = lines[i]?.slice(1) ?? "";
    result.push({
      commitHash: hash,
      authorName: meta.author ?? "",
      authorTime: meta.authorTime ?? 0,
      lineNumber: lineNum,
      content,
    });
    i++;
  }
  return result;
}
