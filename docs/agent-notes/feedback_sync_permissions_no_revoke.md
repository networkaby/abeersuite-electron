---
name: feedback_sync_permissions_no_revoke
description: "Prefer `pnpm seed:sync-permissions … --no-revoke` while the owner is at the screen; the default revokes their browser session mid-test."
metadata: 
  type: feedback
  modified: 2026-09-20T06:19:01.040Z
---

`seed:sync-permissions --apply` revokes every session of the roles it grants to, so the owner gets thrown to the sign-in page in the middle of a browser test (happened 2026-09-20, flagged by the payroll session).

**How to apply:** pass `--no-revoke` when granting during an active session; the grant lands and takes effect at the next natural sign-in. Use the default only when the change must bite immediately (a removal). Remember the owner still has to re-sign in before a NEW sidebar link shows.
