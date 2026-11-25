---
name: project_production_tags_lightweight_mismatch
description: "production remote's release tags are lightweight while origin's are annotated (same commits) — causes Cursor/git 'conflicting tags' pull prompts."
metadata: 
  type: project
  modified: 2026-09-12T21:45:50.201Z
---

> **May be outdated:** AGENTS.md section 9 now pushes the one release tag to every release remote.

Checked 2026-09-13: local tags and `origin` (`devloperakramul/abeersuite-electron`) carry
proper **annotated** tag objects for v1.0.2 through v1.3.4. `production`
(`akramuljakir/abeersuite-electron`) has **lightweight** tags of the same names — different
tag SHA, but the peeled commit is identical on both sides for every tag checked. This is
what triggered Cursor's "Unable to pull … conflicting tag(s)" dialog.

**Why:** likely GitHub auto-creates a lightweight tag on `production` when a release is
published there before `git push production main --tags` (AGENTS.md §9 step 7) lands the
real annotated tag; an unforced tag push doesn't overwrite an existing differing tag ref,
so the lightweight one sticks.

**How to apply:** when this pull-conflict dialog reappears, it's safe to accept
"Replace Local Tag(s)" (one-time, not "Always") — verify first that the peeled commit
matches (`git ls-remote --tags <remote>` vs `git for-each-ref refs/tags`) before assuming
that. It's a local-only, non-push operation and doesn't move any tag to a different commit.
Fixing `production` properly would need a forced tag push, which is a "never push without
being asked" action — don't do it proactively, only if the owner requests it during a
release review.

Related: [project_two_release_repos_same_name](project_two_release_repos_same_name.md), [project_release_tags_before_installer_build](project_release_tags_before_installer_build.md), [project_release_means_full_checklist](project_release_means_full_checklist.md), [user-pushes-manually](user-pushes-manually.md).
