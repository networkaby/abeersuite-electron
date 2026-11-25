---
name: project-product-feed-rebuild-rule
description: "Product feed (Google Merchant / Meta catalog) rebuild rule agreed 2026-10-23 — at most one rebuild a day, only when a feed field changed"
metadata:
  type: project
  modified: 2026-10-23T13:10:40.154Z
---

Owner 2026-10-23: product feed for Google Merchant Center + Meta catalog, planned under Campaigns → Channels, after the WhatsApp Channel phone-share work. Not built yet.

Rule: **max one rebuild per day, and only if dirty.** Dirty = a feed field changed (name, selling/sale price, photo, link, brand, category, shop on/off, stock crossing zero). Weighted-average cost changes on every sale and is NOT a feed field — must never mark it dirty. Fetch schedules set by owner: Google daily, Meta daily (~2 fetches/day).

**Why:** Supabase egress / Vercel CPU — the feed is ~1 MB per rebuild; owner wants it minimal.
**How to apply:** cache the feed with no timer; a feed-field change sets a dirty flag; the first fetch of a day rebuilds only if dirty and no rebuild happened that day, otherwise serve the cached file. Photos stay Cloudinary links. Related: [project_wa_second_number_r2](project_wa_second_number_r2.md).
