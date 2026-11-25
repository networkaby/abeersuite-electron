---
name: project-commit-author-devloper-email
description: "Repo-local git email is devloper.akramul@gmail.com so origin's Hobby Vercel builds; production Vercel (akramuljakir) will block these commits."
metadata:
  type: project
  modified: 2026-10-23T20:28:03.708Z
---

Since 2026-10-24 this repo's local `user.email` is devloper.akramul@gmail.com (global stays akramuljakir@gmail.com).

**Why:** akramuljakir's Vercel hit its Hobby limit; office now deploys from `origin` (devloperakramul GitHub + Vercel, Hobby, private repo). Hobby blocks any commit whose author is not the owner — Deploy Hooks are blocked too (tested). Owner chose to change the author "till we use origin".

**How to apply:** Vercel checks only the tip commit of d_office/d_shop, so a deploy needs a fresh commit made with this email. The production Vercel (akramuljakir) will now block new commits the same way. When the owner moves back to production, reset with `git config --local --unset user.email`. See [project_d_office_triggers_vercel_deploy](project_d_office_triggers_vercel_deploy.md).
