---
name: feedback-no-full-seed-without-permission
description: "Never run bootstrap-seed or personal-bootstrap (pnpm prisma db seed / seed:generic / seed:personal) without the owner's explicit OK; existing DBs are restored from backup, changes go via targeted seed files."
metadata:
  type: feedback
  modified: 2026-10-07T14:43:47.025Z
---

> **May be outdated:** AGENTS.md section 5 has since changed: `pnpm prisma db seed` is now only `sync-permissions --apply`.

Never run `bootstrap-seed` (`pnpm seed:generic`) or `personal-bootstrap` (`pnpm prisma db seed`, `pnpm seed:personal`) without asking the owner first and getting a clear yes — on live, demo/abeersuite_dev, or any restored copy.

**Why:** owner decided 2026-10-07 that existing databases are never re-seeded; a broken/drifted DB is fixed by restoring an existing backup. Owner chose a memory rule only — no code guard was added.

**How to apply:**
- DB repair/reset → propose a backup restore, not a full seed.
- Shipping a permission / master data / config change to an existing DB → a small idempotent targeted seed file (e.g. `seed:sync-permissions --no-revoke` [feedback_sync_permissions_no_revoke](feedback_sync_permissions_no_revoke.md), or a new `prisma/seeds/<topic>.ts` like `ensure-leave-types.ts`), still updating catalog + personal snapshot in the same commit.
- AGENTS.md §3/§5 still say "full seed to ship a permission" — this rule overrides that; ask before any full seed.
