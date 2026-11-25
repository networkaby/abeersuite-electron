---
name: feedback_dry_run_must_exercise_write_path
description: "A dry run that skips the validation the write path runs proves nothing — verify the branch that actually writes, not the one that reports."
metadata: 
  type: feedback
  modified: 2026-09-16T02:51:27.524Z
---

I told the owner `reconcile:bill-links` was verified because the **dry run** had
run clean across all 461 settlements. Their very first `--fix` died on the very
first candidate: the write branch calls `assertLinkPlan`, the report branch does
not, so the whole guard chain — and the bug in it — had never once executed.

Worse, my own research had already flagged the exact cause (`partyLedgerIds()`
reads the app's **global** Prisma client, not the `tx`) and I read it, wrote the
code, and did not connect it.

**Why:** report-only and `--fix` are different code paths. Exercising the cheap,
safe one and reporting it as "verified" overstates what was tested, and the owner
finds out by running the dangerous one against live production books.

**How to apply:** before calling a two-mode script verified, name which branches
ran. If the write branch has not, say so plainly in that wording — the commit
message for a1cf819d does. Where writing to live is the owner's call, find a
read-only run that still crosses the same frame (here, `pnpm repair:bill-links`
in report mode now goes through the shared group walk) rather than settling for
the branch that cannot fail. Same rule for any gotcha surfaced during research:
if it names a specific frame, go and check that frame in the code I just wrote.

See [project_db_probing_via_dev_server](project_db_probing_via_dev_server.md), [feedback_permanent_fix_not_patch](feedback_permanent_fix_not_patch.md).
