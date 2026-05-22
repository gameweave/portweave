---
name: execute-spec
description: Implement an approved spec from .ai/specs/. Use when the user references a spec file ("execute the X spec", "let's build what's in spec Y", "implement .ai/specs/foo.md"). Reads the spec, plans the changes, writes tests, implements code, runs dev-workflow.
---

# execute-spec

## When to invoke

Trigger when the user names a spec file or asks to "execute / implement / build / ship" something that has a corresponding spec under `.ai/specs/`. The spec should be in `Status: approved` (or moved there during this skill).

Do NOT trigger:

- If the spec doesn't exist yet — route to `create-spec` first
- For tasks that don't have a spec and don't need one (typo fixes, trivial cleanup)

## Required pre-conditions

- Spec file exists at `.ai/specs/<name>.md`
- Spec status is `approved` (or user confirms verbally that it's ready)
- Spec's "Open questions" section is resolved or empty

## Procedure

1. **Read the full spec.** Reference exactly the file, not from memory.
2. **Read DESIGN.md and decision-log.md** to ground the implementation in resolved decisions.
3. **Update the spec's Status to `in-progress`** before starting code changes.
4. **Plan the change with TodoWrite.** One todo per acceptance criterion, plus one for "run dev-workflow."
5. **Write tests first** for each acceptance criterion. Tests fail (red).
6. **Implement** to make tests pass (green).
7. **Run `npm run dev-workflow`** before considering the task complete. If it fails, fix the underlying issue — do not skip checks.
8. **Update the spec's Status to `shipped`** once dev-workflow passes and the user confirms.
9. **Append a row to `.ai/decision-log.md`** for any non-trivial implementation decisions that diverged from the spec or resolved an open question.

## File locations

- New library code → `src/<area>/<file>.ts`
- New tests → `src/<area>/__tests__/<file>.test.ts`
- New scripts → `scripts/bin/<name>.ts` (thin wrapper) + `scripts/src/<area>/...` (shared logic)

## Quality bar

- Every acceptance criterion has a passing test.
- ESLint, Prettier, typecheck, dupcheck all pass.
- No new untested error paths.
- If you discover the spec is wrong mid-implementation, **stop and update the spec** before continuing. Don't silently diverge.

## Anti-patterns

- ❌ Implementing without reading the spec first ("I know what this is").
- ❌ Skipping tests because "it's simple."
- ❌ Marking dev-workflow as complete when one of its steps was skipped without justification.
- ❌ Adding scope creep outside the spec's acceptance criteria. New work = new spec.
