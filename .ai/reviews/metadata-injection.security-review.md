# Security Review — metadata-injection

**Scope:** Uncommitted working-tree changes on `main` (base commit `7580bde`).
**Date:** 2026-05-28
**Reviewer:** Automated security-review skill (Claude Code)

## Change summary

Adds an env-layer metadata facility to Portweave:

- New `src/env/metadata.ts` — `buildMetadata(allocation)` exposing `namespace`,
  `worktreeRoot`, `gitCommonDir`; constants `PORTWEAVE_NAMESPACE_VAR`,
  `PW_METADATA_PREFIX` (`pw:`), `PW_METADATA_FIELDS`.
- Always-injected `PORTWEAVE_NAMESPACE` env var (`src/env/build.ts`), re-asserted
  authoritatively past `.env` overrides (`src/env/resolve.ts`) and past parent
  process env (`src/cli/run.ts`).
- `${pw:<field>}` template sigil in `discoveryEnv` values (`src/env/templates.ts`),
  validated at config-load time (`src/config/schema.ts`).
- Reserved `PORTWEAVE_` prefix for user `envVar` / `discoveryEnv` keys
  (`src/config/schema.ts`).
- Docs/schema/example updates (`README.md`, `schema/v1.json`,
  `examples/gameweave.config.json`).

## Methodology

Phase 1 traced data flow from inputs (config file, `.env`, parent env, git/worktree
context) through `resolveAllocationKey` → `allocate` → `buildEnvMap` →
`evaluateTemplate` → `applyDotenvOverrides` → child-process env merge in `run.ts`.
Phase 2 compared the new code against existing validation/precedence patterns.
Phase 3 assessed each focus area against concrete-exploitability and the
false-positive exclusion list. Candidate findings were each tested for a concrete
attack path; none survived the ≥8/10 confidence bar.

## Findings

No HIGH or MEDIUM severity vulnerabilities found.

### Candidates evaluated and dismissed

The following focus areas were examined and found NOT to be vulnerabilities:

1. **Template injection via `${pw:*}` sigil** — `evaluateTemplate` performs a
   single-pass `String.prototype.replaceAll` with a function replacement
   (`src/env/templates.ts:11`). Resolved metadata values are inserted verbatim and
   are NOT re-scanned for further `${...}` placeholders, so there is no recursive /
   second-order interpolation. The values are plain env-var strings — there is no
   eval/shell/SQL/markup sink. Unknown `pw:` fields throw `ENV_BUILD_INVALID` and are
   also rejected at config-load. Not exploitable.

2. **Env-var value spoofing via config or `.env`** — `applyDotenvOverrides`
   (`src/env/dotenv-merge.ts:88`) iterates only over keys already present in the
   computed map, so a `.env` file cannot introduce new env keys through this path;
   it can only override values for keys Portweave already emits (pre-existing,
   intended behavior). The `PORTWEAVE_` prefix reservation prevents user config keys
   from shadowing injected output vars. No new smuggling surface.

3. **Authoritative `PORTWEAVE_NAMESPACE` precedence override** — Re-asserting the
   namespace past `.env` (`src/env/resolve.ts:46`) and parent env
   (`src/cli/run.ts:162`) is a correctness/hardening measure: it guarantees the
   reported value matches the registry-keying namespace. The value is purely
   informational coordination data (e.g. PM2 process naming); it gates no
   privilege, authn, or trust decision, so there is no confused-deputy. The
   documented `PORTWEAVE_NAMESPACE`-as-input override still applies only at
   key-derivation time (`src/worktree/namespace.ts`), where env vars are trusted
   inputs by the project threat model.

4. **Information disclosure of absolute paths** — `worktreeRoot` / `gitCommonDir`
   are absolute local dev paths surfaced via opt-in `${pw:*}` placeholders and into
   `.portweave/current.env` (gitignored). They are already known to the invoking
   user and inherited by the child process. Not secrets/PII under this threat model;
   excluded as a non-security-critical disclosure.

5. **ReDoS / unbounded input in the placeholder regex** — `/\$\{([^}]+)\}/g`
   (`src/env/templates.ts:3`, `src/config/schema.ts:8`) uses a single negated
   character class with one quantifier; matching is linear with no catastrophic
   backtracking. DoS/resource-exhaustion is also a hard exclusion.

6. **`PORTWEAVE_` prefix reservation** — Closes a collision gap (a user
   `PORTWEAVE_*` key shadowing injected output) and opens no new gap. Enforced
   symmetrically for `envVar` and `discoveryEnv` keys
   (`src/config/schema.ts:111,136`). Defense-in-depth, not a vulnerability.

## Verdict

**Overall severity: NONE / PASS.**

The change is well-contained. Inputs flow from trusted local sources (config file,
`.env`, parent env, git/worktree context), interpolation is single-pass into plain
env strings with no executable sink, and the new precedence logic is a hardening
improvement rather than a trust boundary regression.

## Required Actions

None. No blocking or recommended security changes.
