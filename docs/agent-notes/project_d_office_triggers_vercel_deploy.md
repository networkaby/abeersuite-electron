---
name: project-d-office-triggers-vercel-deploy
description: d_office and d_shop are the Vercel deploy branches; release fast-forwards them without asking, owner pushes
metadata:
  type: project
---
d_office (office site + prisma migrate deploy) and d_shop (shop site) are the Vercel deploy branches on origin; pushing main or dev deploys nothing.

**Why:** owner 2026-10-13: when a release touches what Vercel serves, fast-forward both without asking; never push them — owner pushes manually; remind at the end of the report. Also no smoke-test pause — test yourself if needed and publish ASAP; Still ask once for notes + urgent tier, and confirm APP_MODE/LANDING_PAGE.

**How to apply:** release step 9 in .claude/skills/release/SKILL.md. See [project_release_means_full_checklist](project_release_means_full_checklist.md).
 "/release urgent" = no questions at all: [urgent] notes, .env variant as is, straight through.
