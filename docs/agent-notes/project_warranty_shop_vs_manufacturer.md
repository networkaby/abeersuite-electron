---
name: project-warranty-shop-vs-manufacturer
description: "Warranty terms carry a type (Manufacturer default / Seller / Combined / None); what each means, frozen on sale lines, existing terms are Manufacturer."
metadata:
  type: project
  modified: 2026-11-26T18:00:00.000Z
---

Owner's rules, 2026-11-26 (supersede the 2026-10-21 "office term = shop support period" rule):
- **Manufacturer warranty** — the brand's only. The customer claims it directly at the brand's authorised service centre; **the seller is not involved in any way.** Every term that existed before types is Manufacturer (migration `20261126160000_warranty_existing_manufacturer`), and it is the default for new terms.
- **Seller warranty** — the shop repairs the item, **only if it has no physical, liquid or burn damage and its seal / sticker is intact**; repair may take **up to 15 days**.
- **Combined** — the brand's warranty for the whole period **plus** the shop's own warranty on top for the first `sellerDays`; in that part the customer may go to either. Never "shop first, then brand".
- **No warranty** — printed as such.

Modelled as `InvWarrantyTerm.warrantyType` + `sellerDays` + `extraCondition`. Each SALE / POS / ONLINE_INVOICE line freezes its term id; a term on any bill is locked (new policy = new term; names may repeat, so every picker shows "1 Year · Manufacturer"). The bill's Warranty section groups items by type + condition and points at the Terms text ("See terms 4."); the Terms text (points 3–5) spells each kind out. Both live on the print template — renumber the terms and the "See terms N" boxes must follow.

**Why:** the owner sells most items on the brand's warranty and does not want to be the claim point for them; the shop's own warranty is narrow (no damage, 15 days).

**How to apply:** never describe a Manufacturer term as the shop's support; never word Combined as shop-then-brand. E-commerce copy shows the maker's term labelled as the maker's. AI copy never edits the office name/term. Related: [project_services_use_posservice_line](project_services_use_posservice_line.md).
