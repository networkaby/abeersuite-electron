---
name: project_ux_six_patterns_branch
description: "The six UI/UX patterns fix is merged on main at 4a6f0dc6; mechanism done, page rollout still open in docs/ui-ux-patterns.md."
metadata: 
  type: project
  modified: 2026-09-12T10:14:09.062Z
---

A UI/UX audit on 2026-09-12 read all 121 sidebar-reachable pages and logged 138 findings that collapse into **six repeated patterns**. The shared mechanism for all six is built and **merged on `main` as commit 4a6f0dc6**, sitting on top of ada100b3. (The owner's release session reverted the v1.3.4 commit, merged the branch `claude/ux-six-patterns`, rebased, and removed the worktree — so the branch and worktree are gone and main is the only copy.)

**Read `docs/ui-ux-patterns.md` before touching any of this.** It holds the rule per pattern, what is already done, and the remaining page-by-page rollout — including which fix is preferred over which: a real `<button>` beats `rowActivation`, and server paging beats `useClientPagination`.

Shared pieces added: `QueryStateBlock`, `confirmAction` + `ConfirmHost` (mounted once in the root layout), `useFieldSave` + `FieldSaveMark`, `rowActivation`, `Field`, `useClientPagination`. `useBiQuery` and `useApiResource` were rewritten, which fixed patterns A and B for all 20 BI reports at the hook level rather than page by page.

Patterns D, E and F are **mechanism only** — no page uses them yet. That rollout is the next piece of work.

Found while fixing A: `<Toaster />` was missing from `vouchers/layout.tsx`, so `/vouchers/pos` and every inventory voucher route (challans, GRN, purchase orders, physical stock, branch transfers, rejections, manufacturing journals) rendered no toasts at all — a failed save looked identical to a saved one. Fixed by mounting it once there and removing the four nested duplicates.

Verified by `tsc --noEmit` and `eslint`, both clean on main. **Never verified in a browser** — the dev server was left alone because a release was in progress. A browser pass over these screens is still owed.

Related: [project_v102_fix_list_pending](project_v102_fix_list_pending.md), [feedback_permanent_fix_not_patch](feedback_permanent_fix_not_patch.md), [project_worktree_cannot_be_browser_verified](project_worktree_cannot_be_browser_verified.md)
