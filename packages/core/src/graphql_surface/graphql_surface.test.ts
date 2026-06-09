import { describe, it, expect } from "vitest";
import { graphqlSurface, graphqlDiff, graphqlBreaking, graphqlGauntlet } from "./index.js";

const before = [{ path: "schema.graphql", content: "type Query {\n  users: [User!]!\n  me: User\n  legacy: String\n}\ntype Mutation {\n  createUser(name: String): User\n}" }];
const after = [{ path: "schema.graphql", content: "type Query {\n  users: [User!]!\n  me: Account\n  health: Boolean\n}\ntype Mutation {\n  createUser(name: String): User\n}" }];

describe("graphql_surface", () => {
  it("gauntlet is 100", () => expect(graphqlGauntlet().score).toBe(100));

  it("extracts the operation surface from SDL", () => {
    const s = graphqlSurface(before);
    expect(s.map((o) => o.key)).toEqual(expect.arrayContaining(["Query.users", "Query.me", "Query.legacy", "Mutation.createUser"]));
  });

  it("diffs added/removed/retyped", () => {
    const d = graphqlDiff(before, after);
    expect(d.removed.map((o) => o.key)).toContain("Query.legacy");
    expect(d.added.map((o) => o.key)).toContain("Query.health");
    expect(d.retyped.find((r) => r.key === "Query.me")).toMatchObject({ from: "User", to: "Account" });
  });

  it("removed + retyped are BREAKING; added is safe", () => {
    const bc = graphqlBreaking(before, after);
    expect(bc.breaking.some((b) => b.key === "Query.legacy")).toBe(true);
    expect(bc.breaking.some((b) => b.key === "Query.me")).toBe(true);
    expect(bc.breaking.some((b) => b.key === "Query.health")).toBe(false);
    expect(bc.addedCount).toBe(1);
  });

  it("handles extend type + inline gql", () => {
    const s = graphqlSurface([{ path: "a.ts", content: "const t = gql`extend type Mutation { pay(id: ID): Boolean }`;" }]);
    expect(s.map((o) => o.key)).toContain("Mutation.pay");
  });

  it("extracts code-first ops (TypeGraphQL @Query/@Mutation, strawberry)", () => {
    const s = graphqlSurface([
      { path: "r.ts", content: "class R { @Query(() => [User]) users(){} @Mutation(() => User) createUser(){} }" },
      { path: "s.py", content: "@strawberry.mutation\ndef pay(self) -> bool:\n  return True" },
    ]);
    expect(s.map((o) => o.key)).toEqual(expect.arrayContaining(["Query.users", "Mutation.createUser", "Mutation.pay"]));
  });

  it("never throws on garbage", () => {
    expect(() => graphqlSurface(null as never)).not.toThrow();
    expect(() => graphqlBreaking(null as never, null as never)).not.toThrow();
  });
});
