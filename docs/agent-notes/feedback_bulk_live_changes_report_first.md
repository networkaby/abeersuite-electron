---
name: feedback-bulk-live-changes-report-first
description: "Bulk edits to live master data (warranty, group, brand, HSN) — give a CSV report to verify first, apply only on the owner's go"
metadata:
  type: feedback
  modified: 2026-11-11T21:13:49.450Z
---

For bulk changes to live product master data, produce the verification CSV (with a "Your decision" column) and wait; apply only when the owner says go. A stated rule ("all electronics above ₹1000 = 1 year") is not a go-ahead to apply.

**Why:** 2026-11-12 the owner stopped a warranty bulk-apply mid-run ("dont apply give report"); 370 of 391 had already landed and were kept.
**How to apply:** run browser bulk scripts only after an explicit apply; reloading the tab is how to stop an in-page script. Related: [project_db_probing_via_dev_server](project_db_probing_via_dev_server.md).
