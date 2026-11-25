---
name: feedback-say-sku-not-product-id
description: "In conversation, name products by SKU (and barcode), never by the internal database product id"
metadata:
  type: feedback
  modified: 2026-11-19T21:42:03.090Z
---

When talking about a product, use its SKU (and barcode where useful), plus the name. Do not refer to products by the database product id (e.g. "product 722").

**Why:** The business works with real SKUs and barcodes; the product id is internal to the database and means nothing to the owner or staff (2026-11-20).

**How to apply:** In replies, reports, notes and skill output (product-prep, product-copy, product-recheck, price-watch), look up and show the SKU. If the owner gives a SKU, resolve it to the id internally for API calls. If a product has no SKU, say so and show the name. Ids may still appear in code, URLs and API calls.
