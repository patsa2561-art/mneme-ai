/**
 * Shared "is this a noise file?" test for hotspot lists.
 *
 * Several Mneme commands aggregate file touches across commits and surface the
 * top-N hot files (drawdown, insider-trading, moneyball, story, paradox, …).
 * Without filtering, lock files, generated bundles, dist/ output, and
 * CHANGELOG.md dominate every list — they are touched constantly but tell
 * the user nothing actionable. This helper centralises the filter so the
 * behaviour stays consistent across commands.
 */

const NOISE_PATTERNS = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.lock$/,
  /CHANGELOG\.md$/i,
  /\.min\.(js|css)$/,
  /\.map$/,
  /^dist\//,
  /^build\//,
  /^node_modules\//,
];

/** True if the file path is generated/lockfile noise unhelpful in hotspot lists. */
export function isNoiseFile(path: string): boolean {
  return NOISE_PATTERNS.some((re) => re.test(path));
}

/**
 * Aggregate file-touch counts across a list of commits, returning the top-N
 * files (most-touched first) with noise filtered. Used by every command that
 * surfaces "hot files" / "top files" / "files affected".
 */
export function topHotFiles(
  commits: Array<{ files?: string[] }>,
  topN = 5,
): Array<{ path: string; count: number }> {
  const counts = new Map<string, number>();
  for (const c of commits) {
    for (const f of c.files ?? []) {
      if (isNoiseFile(f)) continue;
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}
