---
name: project_two_release_repos_same_name
description: "There are TWO release repos in .env, both named abeersuite-electron under different owners; re-read .env at publish time and check both at step 9."
metadata:
  type: project
  modified: 2026-09-30T10:02:06.483Z
---

`.env` carries two publish targets, scanned `_1`, `_2`, ... until a gap:

- `GITHUB_UPDATE_REPO_1=akramuljakir/abeersuite-electron` + `GH_TOKEN_1`
- `GITHUB_UPDATE_REPO_2=devloperakramul/abeersuite-electron` + `GH_TOKEN_2`

Both repo halves are **`abeersuite-electron`** — only the owner differs. On
**2026-09-06** the v1.0.2 release went out to `_1` only, because `.env` held just `_1`
when the build ran and gained `_2` afterwards; it took a second targeted publish to put
v1.0.2 on `devloperakramul`. Note also that `devloperakramul` had **no** 1.0.x releases
before that — its release line still showed `5.0.2` from the old numbering, even though
the v1.0.0 / v1.0.1 **tags** were pushed there (the script pushes tags to `origin`
regardless of where it publishes).

**Why:** a preflight snapshot of `.env` is not proof of what the build will use, and the
owner edits `.env` between steps. Step 9 of the release says "**every** release repo shows
the installer" — that check is what catches this, and it only works if you know how many
repos there should be.

**How to apply:** re-read the `GITHUB_UPDATE_REPO_N` list immediately before
`pnpm electron:release`, not just at preflight, and verify **both** releases at step 9
with `gh release view v<version> --repo <owner>/abeersuite-electron`. The local `gh` is
active as `devloperakramul`, which cannot even resolve the `akramuljakir` repo — query
that one with `GH_TOKEN` taken from `GH_TOKEN_1` in `.env` — or, simpler and without
reading `.env`, the second keyring login: `GH_TOKEN="$(gh auth token --user akramuljakir)"
gh release view …` (worked at v1.9.3, 2026-09-30; does not switch the active account). To publish to one repo only,
pass the **full owner/repo**: `RELEASE_ONLY_REPO=devloperakramul/abeersuite-electron`;
the bare name matches both (fixed in `6ea6b6dd`, which now refuses an ambiguous value).

Related: [project_release_means_full_checklist](project_release_means_full_checklist.md), [project_release_tags_before_installer_build](project_release_tags_before_installer_build.md).
