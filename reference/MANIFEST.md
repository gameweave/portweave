# Reference Manifest

**Source:** [boardflip / gameweave-org/gameweave](https://github.com/gameweave/gameweave)
**Commit SHA:** `f407ca1d26d8ac5396a091ef2c1854a066dae160`
**Captured:** 2026-05-22
**Captured by:** Initial Portweave scaffolding

## Files

Each file maps to a row in the v0 parity table at [.ai/DESIGN.md §7.2](../.ai/DESIGN.md). Descriptions are intentionally short — read the source files for full context.

| Path                                              | Parity row | Why it matters                                                                                                                                                                         |
| ------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/worktree-ports.ts`           | 1          | Offset formula reference (`base + offset*100`). Portweave replaces this with machine-wide pool block allocation, but the structure of "8 services, each with a base port" is the same. |
| `scripts/src/utils/worktree-context-git.ts`       | 3          | Git worktree detection via `rev-parse` and `worktree list`. Portable verbatim with light renaming.                                                                                     |
| `scripts/src/utils/worktree-context-namespace.ts` | 4, 8       | Namespace derivation (main vs. feature-slug-hash) and explicit env-var override. Source for `PORTWEAVE_OFFSET` / `PORTWEAVE_NAMESPACE` design.                                         |
| `scripts/src/utils/worktree-context-registry.ts`  | 2, 7       | File-locked JSON registry, retry, stale-lock cleanup, pruning. The most directly portable piece.                                                                                       |
| `scripts/src/utils/apply-worktree-env.ts`         | 5, 6, 9    | Env-var injection + URL template construction (`WEBSOCKET_ENDPOINT`, `VITE_API_URL`, `E2E_API_ORIGIN`) + dotenv seeding.                                                               |
| `scripts/src/utils/e2e-port-env.ts`               | 11         | Playwright env helper. Pattern for a generic "configure env for spawned test runner" utility.                                                                                          |
| `scripts/bin/dev.ts`                              | 12         | Wrapper CLI entry point. Reference for the shape of `portweave run -- <cmd>`.                                                                                                          |
| `ecosystem.config.cjs`                            | 10         | PM2 multi-port service config. Shows the dual-port Kinesis pattern (4567 + 4568) that motivates Portweave's service-group feature.                                                     |

## Refreshing this snapshot

```bash
# from a portweave checkout
BOARDFLIP=~/Documents/workspace/boardflip
cp "$BOARDFLIP/packages/shared/src/worktree-ports.ts" reference/boardflip/packages/shared/src/
cp "$BOARDFLIP/scripts/src/utils/worktree-context-"*.ts reference/boardflip/scripts/src/utils/
cp "$BOARDFLIP/scripts/src/utils/apply-worktree-env.ts" reference/boardflip/scripts/src/utils/
cp "$BOARDFLIP/scripts/src/utils/e2e-port-env.ts" reference/boardflip/scripts/src/utils/
cp "$BOARDFLIP/scripts/bin/dev.ts" reference/boardflip/scripts/bin/
cp "$BOARDFLIP/ecosystem.config.cjs" reference/boardflip/
git -C "$BOARDFLIP" rev-parse HEAD  # update commit SHA in this file
```
