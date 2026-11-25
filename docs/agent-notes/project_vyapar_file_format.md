---
name: project_vyapar_file_format
description: "A Vyapar .vyb is a ZIP holding a plain unencrypted SQLite DB — always verify it, because truncated backups look valid."
metadata: 
  type: reference
  modified: 2026-09-11T00:51:00.544Z
---

A Vyapar `.vyb` backup is an ordinary **ZIP** containing one `.vyp`, and a `.vyp` is a **plain,
unencrypted SQLite 3 database**. No key, no obfuscation — `unzip` + `sqlite3` reads everything.

**Why this is worth remembering:** a `.vyb` written off a phone or sync folder can be
**truncated mid-write and still look plausible** — a valid ZIP *local* header, a sensible
filename, no error until SQLite rejects the unpacked file as `database disk image is malformed`.
One such file (3.6 MB where 12 MB was expected) cost a morning in Sep 2026.

**How to apply:** never open a `.vyb` without checking all three — ZIP end-of-central-directory
present, entry CRC matches, and `pragma integrity_check` returns `ok`. `scripts/vyapar/openVyb.ts`
does exactly this and has no skip flag.

Two more traps inside the file:
- **`kb_transactions` has no secondary indexes at all.** Any per-row lookup is a full scan — a
  correlated subquery over 3,800 parties hung at ~89M row visits. Use grouped pre-passes.
- **`item_code` is a manufacturer BARCODE (EAN-13/UPC), not an SKU**, and
  `txn_payment_type_id` is NULL on every row — real tender lives in `txn_payment_mapping`.

Used by [project_vyapar_migration](project_vyapar_migration.md).
