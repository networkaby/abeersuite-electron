---
name: user-pushes-manually
description: Standing permission to commit without asking; the user always pushes to the remote themselves.
metadata: 
  type: feedback
  modified: 2026-08-23T23:37:17.914Z
---

> **May be outdated:** AGENTS.md sections 8 and 9 win: pushing non-`d_` branches is allowed, and a release includes its pushes.

**Committing:** allowed at any time without asking first. Commit finished work as it lands rather than waiting for a go-ahead.

**Pushing:** always done by the user by hand. Never run `git push`, and do not treat a remote ref that has moved on its own as an anomaly worth investigating.

**Why:** On 2026-08-24 a commit I had just created appeared on `origin/dev` seconds later. I went looking for an auto-push hook or IDE setting; the user simply pushed it. The investigation was wasted work built on a wrong assumption. In the same exchange the user granted blanket commit permission.

**How to apply:** `git commit` is the last git step, and needs no approval. If the remote is ahead of what I did, assume the user pushed.
