---
name: execute-spec
description: Implement an approved spec from .ai/specs/<slug>/<slug>.md. Use when the user references a spec ("execute the X spec", "let's build what's in spec Y", "implement .ai/specs/foo/foo.md"). Reads the spec, plans the changes, writes tests, implements code, runs dev-workflow, then runs parallel code-review + security-review subagents as a required gate before shipping.
---

# execute-spec

## When to invoke

Trigger when the user names a spec file or asks to "execute / implement /
build / ship" something that has a corresponding spec under
`.ai/specs/<slug>/<slug>.md`. The spec should be in `Status: approved` (or
moved there during this skill).

Do NOT trigger:

- If the spec doesn't exist yet — route to `create-spec` first (or
  `create-feature` if even the what/why isn't captured)
- For tasks that don't have a spec and don't need one (typo fixes, trivial
  cleanup)

## Required pre-conditions

- Spec file exists at `.ai/specs/<slug>/<slug>.md` (or a numbered sub-spec
  under `.ai/specs/<slug>/`)
- Spec status is `approved` (or user confirms verbally that it's ready)
- Spec's "Open questions" section is resolved or empty

## Spec discovery

Specs live at `.ai/specs/<slug>/<slug>.md`. When the user names a feature
without a path, look it up at that canonical location. If the user provides
a partial path, accept either:

- `.ai/specs/<slug>/<slug>.md` — the canonical entry
- `.ai/specs/<slug>/NN-name.md` — a numbered sub-spec inside a feature folder

Glob with `.ai/specs/**/*.md` when searching by name.

## Procedure

### Phase 1 — Read and plan

1. **Read the full spec.** Reference exactly the file, not from memory.
2. **Read the upstream feature doc** at
   `.ai/features/<slug>/<slug>.md` for motivation context.
3. **Read DESIGN.md and decision-log.md** to ground the implementation in
   resolved decisions.
4. **Update the spec's Status to `in-progress`** before starting code
   changes.
5. **Plan the change with TodoWrite.** One todo per acceptance criterion,
   plus todos for: "run dev-workflow", "parallel review gate",
   "remediate review findings", and "update status to shipped."

### Phase 2 — Implement

6. **Write tests first** for each acceptance criterion. Tests fail (red).
7. **Implement** to make tests pass (green).
8. **Run `npm run dev-workflow`** before considering the implementation
   complete. If it fails, fix the underlying issue — do not skip checks.
   Reaching a green `dev-workflow` is a precondition for the review gate;
   it is NOT sufficient on its own.

### Phase 3 — Parallel review gate (REQUIRED)

**Do not skip this phase. A spec cannot be marked `shipped` until both
reviews return `pass` or `pass-with-notes`.**

9. **Spawn both reviews as parallel subagents** in a SINGLE message with
   two `Agent` tool calls. Both must launch in the same message — running
   them sequentially defeats the purpose:
   - **Agent A — Project code review**
     - `subagent_type`: `claude` (or `general-purpose`)
     - `description`: "Code review for spec <slug>"
     - `prompt` must instruct the subagent to invoke the project-scoped
       `code-review` skill at `.claude/skills/code-review/SKILL.md`, pass
       it `source = .ai/specs/<slug>/<slug>.md`, and produce a review at
       `.ai/reviews/<slug>.code-review.md`. The full spec path and the
       diff base branch (typically `origin/main`) must be in the prompt
       so the subagent has the context it needs without further
       coordination.

   - **Agent B — Security review**
     - `subagent_type`: `claude` (or `general-purpose`)
     - `description`: "Security review for spec <slug>"
     - `prompt` must instruct the subagent to invoke the global
       `/security-review` skill against the changes on the current
       branch, and write its output to
       `.ai/reviews/<slug>.security-review.md` (overwriting any prior
       file). If the global skill writes output to a different default
       path, the subagent is responsible for moving / mirroring it to
       the convention path so the orchestrator can find it.

   Each subagent runs in isolation with no shared state. Don't try to
   coordinate them through anything other than the output review files.

10. **Wait for both subagents to return**, then **read both review files**:
    - `.ai/reviews/<slug>.code-review.md`
    - `.ai/reviews/<slug>.security-review.md`

11. **Merge the findings.** Build a single remediation plan:
    - Combine the issue lists from both reviews.
    - Deduplicate where they overlap (same file:line + same root cause →
      collapse into one entry, citing both source IDs e.g. `C-1`
      (code-review) + `S-CRIT-2` (security-review)).
    - Order by severity: Critical → Major → Minor → Suggestion → Potential.
    - The **merged required-actions list** = union of Required Actions from
      both reviews. This is the contract for Phase 4.
    - Surface the merged plan to the user (or log it) before remediating —
      large or surprising findings warrant a pause for human judgment.

### Phase 4 — Remediate

12. **Address every Required Action in the merged plan.** For each issue:
    - Make the code change suggested by the review (or a justifiable
      alternative if the suggestion is wrong; document the alternative in
      `.ai/decision-log.md`).
    - Add a test that would catch the issue if it regressed.
    - Re-run `npm run dev-workflow` after the batch of fixes.

13. **Re-run the parallel review gate** (Phase 3) after remediation.
    Reviews must produce **new** files reflecting the current state — they
    overwrite the previous versions. Loop Phase 3 → Phase 4 until **both**
    reviews return `pass` or `pass-with-notes`.

    A spec that needs more than 2–3 remediation loops is a signal that
    the spec itself is wrong — stop and revise the spec rather than
    continuing to patch.

### Phase 5 — Ship

14. **Update the spec's Status to `shipped`** only after both reviews
    return `pass` or `pass-with-notes`. If the upstream feature doc
    exists, update its `status` to `shipped` too.

15. **Append a row to `.ai/decision-log.md`** for any non-trivial
    implementation decisions that diverged from the spec, resolved an
    open question, or rejected a reviewer's suggestion.

## File locations

- New library code → `src/<area>/<file>.ts`
- New tests → `src/<area>/__tests__/<file>.test.ts`
- New scripts → `scripts/bin/<name>.ts` (thin wrapper) + `scripts/src/<area>/...`
  (shared logic)
- Review outputs → `.ai/reviews/<slug>.code-review.md` and
  `.ai/reviews/<slug>.security-review.md`

## Quality bar

- Every acceptance criterion has a passing test.
- ESLint, Prettier, typecheck, dupcheck, all `dev-workflow` checks pass.
- No new untested error paths.
- Both review subagents return `pass` or `pass-with-notes`.
- If you discover the spec is wrong mid-implementation, **stop and update
  the spec** before continuing. Don't silently diverge.

## Anti-patterns

- ❌ Implementing without reading the spec first ("I know what this is").
- ❌ Skipping tests because "it's simple."
- ❌ Marking dev-workflow as complete when one of its steps was skipped
  without justification.
- ❌ Adding scope creep outside the spec's acceptance criteria. New work =
  new spec.
- ❌ Running code-review and security-review sequentially. They MUST be
  spawned in a single message with two parallel Agent tool calls. Running
  them serially loses the independence that makes them complementary.
- ❌ Marking the spec `shipped` based on a single review's pass. Both
  reviews must pass.
- ❌ Marking the spec `shipped` with unresolved Required Actions, even
  if the user verbally accepts them. Required Actions become Recommended
  Actions only via re-review.
- ❌ Looping Phase 3 → Phase 4 more than ~3 times. If reviews keep finding
  major issues after remediation, the spec is wrong — escalate to the
  user and revise the spec.
