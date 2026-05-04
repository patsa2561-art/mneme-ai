import { describe, it, expect } from "vitest";
import { parseRemote } from "./repo.js";

describe("parseRemote", () => {
  it("parses HTTPS GitHub URL", () => {
    expect(parseRemote("https://github.com/foo/bar.git")).toEqual({
      host: "github",
      owner: "foo",
      repo: "bar",
    });
  });

  it("parses SSH GitHub URL", () => {
    expect(parseRemote("git@github.com:foo/bar.git")).toEqual({
      host: "github",
      owner: "foo",
      repo: "bar",
    });
  });

  it("parses GitLab URL", () => {
    expect(parseRemote("https://gitlab.com/group/project.git").host).toBe("gitlab");
  });

  it("parses Bitbucket URL", () => {
    expect(parseRemote("git@bitbucket.org:team/repo.git").host).toBe("bitbucket");
  });

  it("returns 'other' for unknown hosts", () => {
    expect(parseRemote("https://gitea.local/foo/bar.git")).toEqual({ host: "other" });
  });

  it("returns empty for undefined", () => {
    expect(parseRemote(undefined)).toEqual({});
  });

  it("strips .git suffix", () => {
    expect(parseRemote("https://github.com/foo/bar.git").repo).toBe("bar");
    expect(parseRemote("https://github.com/foo/bar").repo).toBe("bar");
  });
});
