---
name: feedback_permanent_fix_not_patch
description: "Owner wants the root-cause fix, not a workaround — schema changes included"
metadata: 
  type: feedback
  modified: 2026-09-08T03:02:20.869Z
---

Asked 2026-09-08 whether to add a DB unique index or keep the release schema-free,
the owner answered: **"do the best and permanent not a patch."** In the same breath,
on where a dual-role party's netting should appear: **"already everything on place
just link."**

**Why:** the two together are a single instruction — go deep on the *mechanism*,
stay shallow on the *surface*. They want the underlying rule fixed properly (a real
schema change is fine, a constraint that makes a bug impossible is preferred over a
guard that merely catches it), while existing screens and reports are left as they
are rather than restructured.

**How to apply:** when offering a choice between a quick guard and a proper fix,
expect them to pick the proper one — so lead with it instead of recommending the
cheap option. Do not hedge a correctness fix behind a flag. But do not redesign
working pages while you are in there: change the engine underneath and leave the
layout alone. Flag any owed production step (`prisma db push`, a `--fix` run)
separately rather than performing it. See [user-pushes-manually](user-pushes-manually.md).
