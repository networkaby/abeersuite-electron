---
name: project_auth_d_ts_never_applies
description: "src/auth.d.ts never takes effect — next-auth v5 only re-exports Session/User/JWT from @auth/core, which is not a direct dependency; that is why session.user reads carry casts"
metadata:
  type: project
  modified: 2026-09-30T00:05:44.620Z
---

Found 2026-09-30 while trying to delete the `as unknown as` / `{ kind?: string }` casts on `session.user`. I added `revoked?` and `seats?` to `src/auth.d.ts`, and tsc answered with "Property 'role' / 'kind' / 'customerId' does not exist on type 'AdapterUser & User'" at every uncast read. Nothing in the file merges, JWT included.

**Why:** `next-auth` 5.0.0-beta.30 does `export type { Session, User, … } from "@auth/core/types"`. Augmenting `declare module "next-auth"` cannot merge into a re-exported interface. `@auth/core` sits only under pnpm's `.pnpm` store, so `declare module "@auth/core/types"` cannot resolve from `src/` either. The casts are the working type today, not sloppiness.

**How to apply:** don't "clean up" the session casts by editing `auth.d.ts` — it will not compile. The real fix is a dependency change: add `@auth/core` as a direct dependency (or hoist it) at next-auth's exact version, move the augmentation to `@auth/core/types`, then drop the casts. That is the owner's call and is recorded in PROJECT_BRAIN (2026-09-30 entry on the invProductDb shim).
