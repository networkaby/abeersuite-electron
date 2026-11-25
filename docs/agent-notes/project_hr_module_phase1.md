---
name: project_hr_module_phase1
description: "HR & People phase 1 (staff record, one ledger per person) landed on dev+main 2026-09-20 (2a7e8010 + 259a4e12), browser-verified end to end on the local copy; attendance/payroll are later phases."
metadata: 
  type: project
  modified: 2026-09-20T00:41:57.124Z
---

Phase 1 of HR & People is committed on `dev` and `main` (2a7e8010, 2026-09-20), not yet released. Design is in PROJECT_BRAIN (`🧭 Design: HR & People`). Owner's calls: staff = User + HR rows; accrual with one ledger per person under "Salary Payable"; **no restrictions** (no office-only sync, no read gates, snapshot captures everything); personal / bank details live on the person's own profile page (Personal & Bank tab), the HR profile is Job / Pay / Money only.

**Browser-verified on the local copy (2026-09-20, after the owner re-signed in):** directory list + filters, profile workspace (Job blur-saves, Pay revisions, Money tab), Personal & Bank tab on the profile page, the 403 / 400 refusals, and the Mark-as-left → Rejoined round trip on the seatless "Super Admin" row. The owner was exploring at the same time and made a ledger literally named "Salary Payable" under Indirect Expenses on the local copy — not the group; harmless there. A burst of repeated GETs seen once was the settled reader re-reading on every browser-pane visibility flip plus cold compile, not a loop in the HR code (8 s idle = 0 requests).

**Release order:** a normal schema release — counter build first (schemaGuard), then `d_office`, then `pnpm seed:sync-permissions --grant hr:staff:edit --roles R1 --apply` (and the sidebar id) on live rather than a full seed. The migration must NOT be hand-applied to live.

**Next phases:** attendance (auto from counter sign-in + office register, `AttendanceDay` keyed userId+date, reads `weeklyOff`), then payroll run + payslip print (`PAYSLIP` print-template kind). Do not re-open the four decisions above.
