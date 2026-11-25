---
name: project_worktree_cannot_be_browser_verified
description: "preview_start reads the MAIN checkout's launch.json, so a worktree's changes cannot be verified in the Browser pane."
metadata: 
  type: project
  modified: 2026-09-08T18:37:58.501Z
---

`preview_start` resolves `.claude/launch.json` from the **main checkout**, pinned at session launch — editing the worktree's own copy has no effect, and the server it starts runs in the main folder, which does not contain the worktree's changes. There is no way to browser-verify a worktree from inside it.

**Why:** it silently verifies the wrong code, which is worse than not verifying at all. The owner also stops Bash-started dev servers, so working around it that way is not wanted.

**How to apply:** in a worktree, verify with what does work there — `tsc --noEmit`, `eslint`, and the rolled-back proof scripts like `pnpm verify:bill-links`. Do the browser pass after the branch is merged into `main`, from the main checkout, using `preview_start` with "Next.js Dev Server". See [project_fresh_worktree_precommit_setup](project_fresh_worktree_precommit_setup.md) and [feedback_worktree_branch_from_main](feedback_worktree_branch_from_main.md).
