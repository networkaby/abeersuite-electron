---
name: feedback-shipping-never-blocks-prep
description: "Product prep/recheck must never send a product to Attention over shipping weight or parcel size — fill it when possible, never block"
metadata:
  type: feedback
  modified: 2026-11-22T21:36:41.472Z
---

Shipping weight / parcel size (and a weight mismatch between spec and box) is never a pending or staff line in product-prep Parts 1–6 or product-recheck. Fill it when the label or a kept page gives it; otherwise leave it.

**Why:** owner, 2026-11-23 — the shop readiness gate already catches missing shipping and puts the product in Pending even after Publish, so blocking in the skill is double work.

**How to apply:** never write shipping / weight lines in `pending` or `staff`; an old such line on a product → clear it with `/fixed` (send the JSON from a UTF-8 file — inline curl mangles "×" and "—"). Mention the mismatch to the owner in the report only. Related: [project_prep_part4_ready_not_publish](project_prep_part4_ready_not_publish.md).
