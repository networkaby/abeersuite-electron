---
name: feedback_worktree_branch_from_main
description: "Worktree work starts from main — diff HEAD..main before planning anything — and merges back to main, plus dev when the checkout is on dev."
metadata: 
  type: feedback
  modified: 2026-09-13T23:17:04.753Z
---

`main` is the base and the destination of all worktree work in this repo.

**Before planning or writing anything** in a `.claude/worktrees/*` worktree, run
`git log --oneline HEAD..main` and `git diff --stat HEAD..main`, read what landed,
and fast-forward onto main (`git merge --ff-only main`) before editing.

**When the work is done**, merge it into `main`. If the owner's checkout is currently
on `dev`, merge it into `dev` as well — `dev` is not a substitute for `main`.

**Why:** the owner runs several Claude sessions in parallel worktrees plus the main
checkout, and lands fixes on `main` between turns. On 2026-09-05 I spent a whole
planning cycle designing fixes for audit findings A1 and A2 that had already been
committed to `main` (`c2ad64b3`, `0cac37f8`, `8c660653`) while my worktree sat four
commits behind; the owner had to stop me with "main has several fix now so go to
main". Later the same day they made the branch-from-main/merge-to-main flow a standing
rule — it is also written into AGENTS.md under "Worktrees". `main` is the branch
releases go out from (AGENTS.md §8), and parallel worktrees only stay coherent if they
all share one base.

**How to merge into `main` from the main checkout (2026-09-14):** the main checkout
usually carries the owner's staged files (`personal.local.json`, `settings.local.json`,
a WIP component), and a conflict-resolving `git commit` would sweep them into the
merge commit. Merge in a throwaway worktree instead: `git worktree add <scratch>/merge-wt
-b tmp/merge main`, `git merge --no-ff` each branch there (PROJECT_BRAIN.md is the usual
conflict — keep every dated bullet, main's wording wins for a shared one), then in the
main checkout `git merge --ff-only tmp/merge` and remove the worktree + branch. Before
`--ff-only`, drop the CRLF-only noise on `syncRegistry.generated.ts` (`git diff` shows no
content) or the ff refuses. Preview conflicts with `git merge-tree --write-tree main
<branch>` first. Also `git status | grep counter-build-excluded` before any tsc/precommit:
a `pnpm electron:dist` started from elsewhere renames ~80 files under
`src/app/(external)` while it runs (see [feedback_stage_only_own_files](feedback_stage_only_own_files.md)).

**How to apply:** make the `HEAD..main` diff the first step of any worktree task,
before exploration and before asking the owner design questions — what is already
fixed changes both the plan and the questions worth asking. Never `git stash` to do
it; the stash stack is shared across every live worktree (see
[feedback_stage_only_own_files](feedback_stage_only_own_files.md)) — use a WIP commit if the tree is dirty. Commit
freely but leave the push to the owner unless it is a release
([user-pushes-manually](user-pushes-manually.md)).

**The merge itself may not be mine to run (2026-09-17).** Under the auto-mode
permission classifier both ways of advancing `main` from inside a worktree are
refused as "Git Destructive": `git branch -f main HEAD` and `git worktree add
<scratch> main`. The session rules also forbid `cd`-ing to the original repo root.
So a worktree session ends at the COMMIT: report the branch name and hand the owner
the two `git merge --ff-only` lines. Do not spend turns hunting for another route —
ask once, or leave it to them.
