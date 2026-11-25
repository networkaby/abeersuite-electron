---
name: feedback_wait_for_parallel_session_fix
description: Owner runs parallel Claude sessions; re-check git log before follow-up work, and pause verification builds while another session is mid-fix.
metadata: 
  type: feedback
  modified: 2026-09-30T22:38:21.488Z
---

The owner often has several Claude sessions open on this repo at once. Two
consequences, and the first one bit hard on 2026-09-14.

**`main` moves underneath a long session.** The `gitStatus` in the system prompt is
a snapshot from session start and goes stale. On 2026-09-14 a parallel session
landed `7dae6c38` mid-session, fixing the exact reconcile hazard this session had
just flagged as follow-up work — and did it better, catching a `row_pk` vs
`row_key` separator trap (`chr(31)` against the four-character `\x1f`) that this
session's plan had asserted was a non-issue. An 11-agent workflow had already been
launched to investigate it. Caught only because `git log` was run for an unrelated
reason.

**How to apply:** run `git log --oneline -5` before starting any deferred or
follow-up item, and again before writing a PROJECT_BRAIN entry that claims
something is unfixed. If a parallel commit already covers it, kill the work
immediately, read their fix, and check only for genuine residuals rather than
re-doing or second-guessing it. Two adjacent PROJECT_BRAIN entries contradicting
each other is worse than either being absent — correct the stale one.

**A parallel session can commit YOUR uncommitted files.** On 2026-09-16 this
session had three edited page files sitting in the working tree while writing the
API half. A parallel session committed its own customer-page fix and swept all
three in as `7e937af6` — correct content, wrong commit message, and this session's
`git status` then showed them as unchanged, which reads at first glance like the
edits were lost. Nothing was lost, but the only way to tell was
`git show HEAD:<file>`.

**How to apply:** commit your own files as soon as a coherent piece is done rather
than holding a working tree across a long task — the window where another session
can absorb them is the window they sit uncommitted. If a file you certainly edited
shows no diff, check `git log --oneline -5` and `git show HEAD:<path>` before
re-applying anything; re-doing an edit that already landed is how a file gets
doubled. Say plainly in your own commit which files went in elsewhere.

**The checkout's branch can change under you too.** On 2026-10-01 the shared
checkout was switched from `main` to `d_office` at 02:48 (a deploy step), and the
next five Batch 2 commits landed on local `d_office` while `main` stayed behind —
the owner's `push main` would have shipped none of them. Caught only at the next
`git log`; fixed with `git checkout main && git merge --ff-only d_office`.

**How to apply:** run `git branch --show-current` before every commit, not only at
session start; if it is not `main`, stop and move the work to `main` first.

**Verification builds:** when one session is fixing a bug, other sessions must
**stop building and testing and wait** — verification must run against the fixed
tree. A full `pnpm electron:pack` here is ~10 minutes of `next build` plus
packaging; verifying against a tree that is about to change burns that twice and
produces a "pass" that proves nothing. Commit the finished work so nothing is lost
(see [user-pushes-manually](user-pushes-manually.md) and [feedback_stage_only_own_files](feedback_stage_only_own_files.md)), report
plainly what is verified and what is not, and wait for the go-ahead. Do not re-run
"just to check".

Related: the owner usually keeps `next dev` running (~2.4 GB) while builds go, and
the machine has ~12 GB — electron-builder's PNG→ICO step has hit
`WebAssembly.Memory(): could not allocate memory` because of that pressure. It is
environmental, not a code fault; retry the packaging step rather than re-running
the whole chain.
