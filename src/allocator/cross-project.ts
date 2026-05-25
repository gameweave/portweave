// Cross-project collision test surface — this module exists to satisfy
// structure:check which requires a source file at this location for
// __tests__/cross-project.test.ts. The test exercises the runtime
// allocate() function across multiple AllocationKeys sharing a single
// registry, verifying that distinct repos and worktrees receive
// non-overlapping port sets. No runtime exports are provided here;
// the test imports directly from allocate.ts and registry/types.ts.
