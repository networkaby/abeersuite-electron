---
name: project-scramble-key-secret-rename
description: "AI_KEY_SECRET renamed SCRAMBLE_KEY_SECRET in code 2026-11-13 (712ec57b2), no fallback; env vars must be renamed (same value) before the next deploy/release"
metadata:
  type: project
  modified: 2026-11-13T08:18:03.598Z
---

> **May be outdated:** the rename shipped in v1.17.5; check the env vars were renamed.

Code reads only `SCRAMBLE_KEY_SECRET` since 712ec57b2 (secretBox moved to src/shared/lib/security/). The key derivation still uses the text "shared", so the SAME value opens everything saved before.

**Why:** owner found "AI" confusing for a key that locks App Settings, Incoming API, Facebook/Google secrets too. Owner refused any fallback; shop + app are off 3 days around the release, so no transition hand-out.

**How to apply:** at the next release/deploy, remind the owner to rename the variable (same value) in Vercel, .env/.env.local and every counter's env BEFORE it goes live; a server or till without it cannot open any saved secret (AI keys, Google connection, Cowork/Product-copy incoming secrets). Never change DERIVE_NAME in secretBox.ts. Related: [project_release_means_full_checklist](project_release_means_full_checklist.md).
