// (retired) cross-repo API contract — superseded by ../cross_service (extractProduced / extractConsumed
// / crossServiceGraph / serviceImpact) + ../api_surface (breakingChanges), which already do producer↔
// consumer matching + dangling-call detection across many repos (CLI `mneme services --dirs a,b,c`).
// Kept as an empty module to avoid a destructive delete in the sandbox; not exported anywhere.
export {};
