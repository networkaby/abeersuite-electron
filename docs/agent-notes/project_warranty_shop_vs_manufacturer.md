---
name: project-warranty-shop-vs-manufacturer
description: "Product warranty term in office/POS = the shop's own support period; e-commerce copy shows the manufacturer's full warranty, labelled as the manufacturer's."
metadata:
  type: project
  modified: 2026-10-21T13:03:44.317Z
---

Owner's rule (2026-10-21). Two warranties per product:
- **Shop support period** (product name "(Warranty-1 Year)", warranty term, POS bill): we collect the item, send it to the maker at our cost, return it. Local walk-in customers know only this.
- **Manufacturer warranty** (e.g. Logitech 3 years): customer ↔ maker. E-commerce description shows this fact, clearly worded as the manufacturer's, not ours.

**Why:** a shorter shop period limits what customers can claim from the shop; online buyers still see the true maker term.

**How to apply:** a shop term shorter than the maker's is NOT a data clash; flag only when the shop term is longer. AI copy never writes the shop period as "Manufacturer Warranty" (aiProductCopy.ts fallback did this as of 2026-10-21) and never edits the office name/term. Related: [project_services_use_posservice_line](project_services_use_posservice_line.md).
