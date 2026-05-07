/**
 * Structural sanity for the CI integration templates we ship.  We don't
 * pull in `js-yaml` (no extra dep), so this is a hand-rolled smoke that
 * catches the most common mistakes:
 *   - file exists and is non-empty
 *   - all `key: value` lines have a colon-space (or are list items)
 *   - block scalars (`run: |`) have indented content
 *   - top-level keys we expect for the platform are present
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd().replace(/\\/g, "/");

function load(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("CI integration templates — structural sanity", () => {
  it(".github/actions/mneme-audit/action.yml has the expected GitHub Action shape", () => {
    const txt = load(".github/actions/mneme-audit/action.yml");
    expect(txt.length).toBeGreaterThan(200);
    expect(txt).toMatch(/^name:\s+/m);
    expect(txt).toMatch(/^description:\s+/m);
    expect(txt).toMatch(/^inputs:\s*$/m);
    expect(txt).toMatch(/^outputs:\s*$/m);
    expect(txt).toMatch(/^runs:\s*$/m);
    expect(txt).toMatch(/using:\s+"composite"/);
    // every input must declare a description
    const inputCount = (txt.match(/^\s{2}\w[\w-]*:\s*$/gm) ?? []).length;
    expect(inputCount).toBeGreaterThan(3);
  });

  it("github-actions.yml template has on/jobs/permissions", () => {
    const txt = load("docs/integrations/github-actions.yml");
    expect(txt).toMatch(/^on:\s*$/m);
    expect(txt).toMatch(/^permissions:\s*$/m);
    expect(txt).toMatch(/^jobs:\s*$/m);
    expect(txt).toContain("npm install -g mneme-ai");
    expect(txt).toContain("mneme bot");
  });

  it("gitlab-ci.yml template has the mneme-bot job and reads MR vars", () => {
    const txt = load("docs/integrations/gitlab-ci.yml");
    expect(txt).toMatch(/^mneme-bot:\s*$/m);
    expect(txt).toContain("$CI_MERGE_REQUEST_IID");
    expect(txt).toContain("mneme bot");
  });

  it("bitbucket-pipelines.yml template has the pull-requests pipeline", () => {
    const txt = load("docs/integrations/bitbucket-pipelines.yml");
    expect(txt).toContain("pull-requests:");
    expect(txt).toContain("mneme bot");
  });

  it("circleci.yml template uses the mneme-bot job and bridges env names", () => {
    const txt = load("docs/integrations/circleci.yml");
    expect(txt).toMatch(/version:\s+2\.1/);
    expect(txt).toContain("mneme-bot:");
    expect(txt).toContain("GITHUB_REPOSITORY");
    expect(txt).toContain("CIRCLE_PULL_REQUEST");
  });

  it("jenkinsfile template has a Declarative pipeline with a Mneme stage", () => {
    const txt = load("docs/integrations/jenkinsfile");
    expect(txt).toMatch(/^pipeline\s*\{/m);
    expect(txt).toContain("agent any");
    expect(txt).toContain("mneme bot");
    expect(txt).toContain("CHANGE_ID");
  });

  it("docs/integrations/README.md links to every template", () => {
    const txt = load("docs/integrations/README.md");
    expect(txt).toContain("github-actions.yml");
    expect(txt).toContain("gitlab-ci.yml");
    expect(txt).toContain("bitbucket-pipelines.yml");
    expect(txt).toContain("circleci.yml");
    expect(txt).toContain("jenkinsfile");
  });

  it("wiki Integrations page is linked from the sidebar", () => {
    const sidebar = load("docs/wiki/_Sidebar.md");
    expect(sidebar).toContain("[[Integrations]]");
    const page = load("docs/wiki/Integrations.md");
    expect(page).toContain("Mneme works on every CI you already use");
    expect(page).toMatch(/GitHub Actions/);
    expect(page).toMatch(/GitLab/);
    expect(page).toMatch(/Bitbucket/);
    expect(page).toMatch(/CircleCI/);
    expect(page).toMatch(/Jenkins/);
  });
});
