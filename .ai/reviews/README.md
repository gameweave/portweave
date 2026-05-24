# `.ai/reviews/`

Generated review outputs from the parallel review gate in
[`execute-spec`](../../.claude/skills/execute-spec/SKILL.md). One review file
per spec per review type. The naming convention is rigid because the
`execute-spec` orchestrator finds and merges these files automatically.

## File naming

For a spec at `.ai/specs/<slug>/<slug>.md` (e.g.,
`.ai/specs/worktree-context/worktree-context.md`), the review gate produces:

| File                                    | Source                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| `.ai/reviews/<slug>.code-review.md`     | Project-scoped [`code-review`](../../.claude/skills/code-review/SKILL.md) skill subagent. |
| `.ai/reviews/<slug>.security-review.md` | Global `/security-review` skill subagent.                                                 |

The `.code-review.md` and `.security-review.md` suffixes are mandatory —
`execute-spec` looks for both before deciding whether a spec can ship.

## Lifecycle

- Reviews **overwrite** their previous selves. There's no
  `<slug>.code-review-v2.md`. The latest run reflects current state.
- Reviews are kept in version control. They document why a particular
  remediation pass happened and what was found.
- Reviews are deleted only when the spec itself is abandoned or
  consolidated — and the deletion goes in `.ai/decision-log.md`.

## Review file format

The project-scoped code-review format lives at
[`.claude/skills/code-review/references/code-review-format.md`](../../.claude/skills/code-review/references/code-review-format.md).

The security-review format is determined by the global `/security-review`
skill (defined in the user's `~/.claude/skills/`, not this repo). The
`execute-spec` orchestrator handles both formats when merging findings.

## How `execute-spec` uses these files

After the parallel review subagents return, `execute-spec` reads both files
and:

1. Combines the issue lists, ordered by severity.
2. Deduplicates entries that flag the same root cause from different
   angles.
3. Treats the union of both reviews' Required Actions as the **single
   remediation contract**. Every Required Action must be addressed before
   the spec can be marked `shipped`.
4. After remediation, re-runs both reviews. The cycle continues until
   both reviews return `pass` or `pass-with-notes`.

See [`execute-spec/SKILL.md`](../../.claude/skills/execute-spec/SKILL.md)
Phase 3 and Phase 4 for the full contract.
