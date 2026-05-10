/**
 * DataModeBadge -- the ONE source of truth for "what am I looking at"
 * across every lab view.
 *
 * The v1.27.0 painpoint: a user uploads their real repo (header says
 * "● LIVE · GitLab API"), opens Retrieval Lab, and sees "DEMO --
 * synthetic seed data". They reasonably ask: "is this MY data or not?"
 *
 * Root cause: TWO different "demo" concepts were collapsed into one
 * label.
 *   1. DEMO REPO  -- the git repo loaded is synthetic (not the user's)
 *   2. DEMO FEATURE -- the user's repo IS loaded, but THIS lab feature
 *      hasn't been run yet (no trials, no scans, no chromosomes)
 *
 * v1.27.1 splits them. This badge renders one of three states:
 *
 *   ◉ DEMO REPO -- not your repo                  (synthetic git data)
 *   ⏳ YOUR REPO -- feature not yet run            (live git, no lab data)
 *   ● YOUR REPO -- live data                       (live git + lab data)
 *
 * Each lab view receives the same three flags and renders the same
 * badge -- no more confusion across views.
 */

interface Props {
  /** True when raw._demo_synthetic -- the loaded git is the bundled demo. */
  syntheticRepo: boolean;
  /** True when raw._liveMode -- user pasted a URL or loaded a real export. */
  liveMode: boolean;
  /** Where live data was fetched from (e.g. "GitHub" or "GitLab"). */
  liveSource?: string;
  /** True when THIS lab has real measured data (trials > 0, scans > 0, etc). */
  featureHasData: boolean;
  /** Human label for the feature ("retrieval trials", "antivirus scans", "ecosystem detection"). */
  featureLabel: string;
}

export function DataModeBadge({ syntheticRepo, liveMode, liveSource, featureHasData, featureLabel }: Props) {
  // State 1: synthetic repo -- nothing here is the user's data
  if (syntheticRepo) {
    return (
      <span
        className="data-mode-badge state-demo-repo"
        title="The git repo loaded right now is the bundled demo, NOT your repo. Click 'Load my repo' in the header to swap in your own."
      >
        ◉ DEMO REPO — not your repo
      </span>
    );
  }
  // State 2: live repo, but THIS feature hasn't been run yet
  if (liveMode && !featureHasData) {
    return (
      <span
        className="data-mode-badge state-feature-unused"
        title={`Your repo is loaded (from ${liveSource ?? "git"}). The numbers below are illustrative only -- ${featureLabel} hasn't run yet on this repo. Run the relevant CLI command to populate real data.`}
      >
        ⏳ YOUR REPO — {featureLabel} not yet run · numbers below are examples
      </span>
    );
  }
  // State 3: live repo + this feature has real data
  if (liveMode && featureHasData) {
    return (
      <span
        className="data-mode-badge state-live-with-data"
        title={`Live data from ${liveSource ?? "git"} + real ${featureLabel} on this repo.`}
      >
        ● YOUR REPO — live {featureLabel} data
      </span>
    );
  }
  // State 4 (fallback): user dropped a JSON file from local CLI export
  return (
    <span
      className="data-mode-badge state-loaded"
      title="Loaded from your local Mneme CLI export."
    >
      ● Loaded from local export
    </span>
  );
}
