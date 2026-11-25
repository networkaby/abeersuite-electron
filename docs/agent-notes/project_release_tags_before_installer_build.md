---
name: project_release_tags_before_installer_build
description: "electron:release cuts and pushes the v tag BEFORE building the NSIS installer, so an installer.nsh error strands a pushed tag on a commit that cannot build."
metadata:
  type: project
---

> **May be outdated:** the push commands in AGENTS.md section 9 have changed since (never `--tags`).

`scripts/release-electron.ts` runs in this order: pack + `verify:package` → **create tag
`v<version>` → `git push origin HEAD --tags`** → build the NSIS installer → publish.

`verify:package` does **not** compile `installer.nsh`. So a syntax error there passes the
gate green, the tag is cut and pushed, and only then does `makensis` fail — leaving
`origin` carrying `v<version>` on a commit that cannot produce an installer. This
happened on **2026-09-06** during v1.0.2 and had to be undone with `git tag -d` plus
`git push origin :refs/tags/v1.0.2` before retrying. `229b0413` was the same trap.

**Why:** the release skill lists the tag-then-build order, but not this consequence, and
the owner's rule is "a tag already exists → do not move it, ask". Knowing the failure is
recoverable and how makes that ask a quick one instead of a stalled release.

**How to apply:** when `pnpm electron:release` fails, first check *where*. A failure at
pack (e.g. `EPERM` renaming `dist-app\win-unpacked` — a transient lock from Defender or a
still-closing smoke-test app; delete `win-unpacked` and `win-unpacked.tmp`, then retry) is
**before** tagging and needs no cleanup. A failure at the installer build or publish is
**after** tagging: report the stranded tag and ask before moving it. Two NSIS gotchas that
have already bitten: `/SD IDOK` goes **after** the MessageBox text, and `${__FILEDIR__}`
is not what you want for bundled files.

Related: [project_release_means_full_checklist](project_release_means_full_checklist.md).
