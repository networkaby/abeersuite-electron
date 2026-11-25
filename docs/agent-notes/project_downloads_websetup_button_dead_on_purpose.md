---
name: project_downloads_websetup_button_dead_on_purpose
description: "The office Downloads page's AbeerSuite App button gives not-found in any packaged build; on 2026-09-06 the owner chose to leave it that way, unmentioned."
metadata:
  type: project
---

The "AbeerSuite App / Web Setup" box on `office/settings/downloads` links to
`/AbeerSuite-WebSetup.exe`. That file reaches a user in **neither** deployment path:

- `public/AbeerSuite-WebSetup.exe` is untracked and matched by `.gitignore` (`*.exe`),
  so a web deploy from a clean checkout has no such file.
- `scripts/prepare-standalone.ts` sets `SKIP_EXTENSIONS = {".exe", ".zip"}` and strips
  every `.exe` out of `public/` when building the package, so the packaged office app
  does not carry it either. The older `combined-bridge-setup-offline.exe` link has the
  same problem and is committed, but still stripped from the package.

On **2026-09-06**, during the v1.0.2 release, the owner was shown this and chose
**"leave it, don't mention it"** — the button stays, gives not-found, and is kept out
of the release notes. Nobody has been told to use it, so nothing is promised.

**Why:** making it work means a build step copying `dist-app/AbeerSuite-WebSetup.exe`
into the package plus an exemption from the `.exe` skip, and that wanted its own
testing rather than riding along with a release.

**How to apply:** do not report this as a new bug and do not "fix" it unasked. If the
owner ever wants the button live, the two changes above are the work. Also surfaced at
the same time and **not** acted on: that exe embeds `GITHUB_DOWNLOAD_UPDATE_PAT_TOKEN`
scrambled with a single XOR byte (`0x5a`, `scripts/build-downloader.ts`), and anything
under `public/` is served without login — so whoever learns the URL can recover the
token. Raise that separately if the button is ever revived.

Related: [project_release_means_full_checklist](project_release_means_full_checklist.md), [project_v102_fix_list_pending](project_v102_fix_list_pending.md).
