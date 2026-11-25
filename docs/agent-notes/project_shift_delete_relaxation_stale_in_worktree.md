---
name: project_shift_delete_relaxation_stale_in_worktree
description: "Uncommitted shift-delete relaxation (owner's call 2026-09-13) sits in the sift-edit-delete-reclose worktree and predates the voucher-carries-shift refactor; it cannot be merged as-is."
metadata: 
  type: project
  modified: 2026-09-13T23:16:51.372Z
---

The worktree `.claude/worktrees/sift-edit-delete-reclose-949840` (branch `claude/sift-edit-delete-reclose-949840`, 0 commits ahead of main) holds three UNCOMMITTED files that relax the POS shift delete: the route stops refusing a shift that carries receipts / drops / expenditures, the page always shows Delete and names what loses its link, and PROJECT_BRAIN.md records it as the owner's call on 2026-09-13 (a ₹0 shift with two digital receipts could not be removed).

**Why it was not merged on 2026-09-14:** the change was written when receipts and expenditures were rows in `pos_receipts` / `pos_expenditures` that cascade on shift delete. Commit a8db869b then dropped those tables; receipts and expenditures are now vouchers carrying `shiftId`, and main's delete route (`src/app/api/pos/shifts/[id]/delete/route.ts`) refuses on `listShiftMovements` instead. So the worktree edit no longer applies mechanically and its premise (audit links cascade, vouchers stay) has to be re-decided against the new model.

**How to apply:** if the owner still wants a shift with sales deletable, redo it on main against `listShiftMovements` and decide what happens to the vouchers' `shiftId` (set null vs refuse), then update the PROJECT_BRAIN entry. Do not commit the worktree's stale files. Related: [feedback_worktree_branch_from_main](feedback_worktree_branch_from_main.md), [feedback_permanent_fix_not_patch](feedback_permanent_fix_not_patch.md).
