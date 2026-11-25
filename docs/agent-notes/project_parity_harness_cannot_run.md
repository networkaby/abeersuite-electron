---
name: project_parity_harness_cannot_run
description: "No tsx script touching balance.ts can run without a `server-only` shim — including verify-bill-links; NODE_PATH is the clean fix"
metadata: 
  type: project
  modified: 2026-09-13T20:30:34.883Z
---

`server-only` is **neither installed nor declared** in `package.json`, and is not
in the pnpm store either — Next aliases it at build time, so it never exists on
disk. Any module chain reaching it is unusable from a plain `tsx` script:
`voucherMappers` / `aggregateLedger` / `sync/push.ts` → `balance.ts` →
`releaseGuard` → `replicaReadiness` → `server-only`.

**Correction (2026-09-14):** this is NOT limited to `parity-harness.ts`.
`src/scripts/verify-bill-links.ts` — the pattern this memory used to recommend as
"working" — fails on the same import with a bare `pnpm verify:bill-links`. Assume
every `src/scripts/verify-*.ts` needs the shim, and don't claim one ran until it
actually printed its checks.

**Workaround, the clean one:** put the stub outside the repo and point Node at it
— nothing to remember to delete, and it survives `pnpm install`:

```bash
SHIM="<scratchpad>/shim"; mkdir -p "$SHIM/server-only"
printf 'module.exports = {};\n' > "$SHIM/server-only/index.js"
printf '{"name":"server-only","version":"0.0.0","main":"index.js"}\n' > "$SHIM/server-only/package.json"
NODE_PATH="$SHIM" npx tsx src/scripts/verify-whatever.ts
```

The real package is empty on the server too, so this is faithful. Hand-making
`node_modules/server-only/` also works but is wiped by the next install. Adding it
as a devDependency would fix it for good — ask the owner before doing that.

**How to apply:** write a focused script importing only what it needs, wrapping
its writes in a `prisma.$transaction` that ends in a deliberate throw —
`src/scripts/verify-line-resurrection.ts` (`pnpm verify:line-resurrection`, 13
checks, 2026-09-14) and `verify-bill-links.ts` are the shape. Two gotchas: end
with `process.exitCode` + `await prisma.$disconnect()`, never `process.exit()`
(libuv aborts on Windows *after* a clean run, so it reads as a failure that never
happened); and a rollback does not rewind a SEQUENCE, so each run burns a few ids.
See [project_fresh_worktree_precommit_setup](project_fresh_worktree_precommit_setup.md) and [project_db_probing_via_dev_server](project_db_probing_via_dev_server.md).
