/**
 * gitFetch — URL classification + structural sanity of the synth output.
 *
 * Network-touching paths (the actual fetchAndSynthesize) are not tested
 * here because they hit the real GitHub/GitLab API. We test the URL
 * parser exhaustively and rely on integration testing for the fetch path.
 */

import { describe, expect, it } from "vitest";
import { classifyUrl } from "./gitFetch.js";

describe("classifyUrl", () => {
  it("recognises a vanilla github.com repo URL", () => {
    expect(classifyUrl("https://github.com/foo/bar")).toEqual({
      kind: "github",
      owner: "foo",
      repo: "bar",
    });
  });

  it("strips a trailing slash (the address-bar copy paste case)", () => {
    expect(classifyUrl("https://github.com/foo/bar/")).toEqual({
      kind: "github",
      owner: "foo",
      repo: "bar",
    });
  });

  it("strips multiple trailing slashes", () => {
    expect(classifyUrl("https://github.com/foo/bar///")).toEqual({
      kind: "github",
      owner: "foo",
      repo: "bar",
    });
  });

  it("strips a .git suffix", () => {
    expect(classifyUrl("https://github.com/foo/bar.git")).toEqual({
      kind: "github",
      owner: "foo",
      repo: "bar",
    });
  });

  it("ignores paths beyond owner/repo (e.g. /tree/main/src)", () => {
    expect(classifyUrl("https://github.com/foo/bar/tree/main/src")).toEqual({
      kind: "github",
      owner: "foo",
      repo: "bar",
    });
  });

  it("recognises www.github.com", () => {
    expect(classifyUrl("https://www.github.com/foo/bar")).toEqual({
      kind: "github",
      owner: "foo",
      repo: "bar",
    });
  });

  it("recognises a vanilla gitlab.com nested project URL", () => {
    expect(classifyUrl("https://gitlab.com/group/project")).toEqual({
      kind: "gitlab",
      project: "group/project",
    });
  });

  it("recognises a deeper-nested gitlab subgroup URL", () => {
    expect(
      classifyUrl("https://gitlab.com/point-jungle/codeforge/frontend"),
    ).toEqual({
      kind: "gitlab",
      project: "point-jungle/codeforge/frontend",
    });
  });

  it("strips trailing slash on gitlab", () => {
    expect(classifyUrl("https://gitlab.com/group/project/")).toEqual({
      kind: "gitlab",
      project: "group/project",
    });
  });

  it("strips .git suffix on gitlab", () => {
    expect(classifyUrl("https://gitlab.com/group/project.git")).toEqual({
      kind: "gitlab",
      project: "group/project",
    });
  });

  it("rejects gitlab top-level path (no slash inside) as not a project", () => {
    expect(classifyUrl("https://gitlab.com/justgroup")).toEqual({
      kind: "unknown",
    });
  });

  it("recognises a raw .json URL", () => {
    expect(classifyUrl("https://example.com/data.json")).toEqual({
      kind: "json",
      url: "https://example.com/data.json",
    });
  });

  it("recognises a .json URL with a query string", () => {
    expect(classifyUrl("https://example.com/data.json?cb=1")).toEqual({
      kind: "json",
      url: "https://example.com/data.json?cb=1",
    });
  });

  it("returns unknown for non-URL strings", () => {
    expect(classifyUrl("foo bar baz")).toEqual({ kind: "unknown" });
  });

  it("returns unknown for an empty string", () => {
    expect(classifyUrl("")).toEqual({ kind: "unknown" });
  });

  it("returns unknown for a URL with no recognised host or extension", () => {
    expect(classifyUrl("https://example.com/some/path")).toEqual({
      kind: "unknown",
    });
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(classifyUrl("   https://github.com/foo/bar   ")).toEqual({
      kind: "github",
      owner: "foo",
      repo: "bar",
    });
  });
});
