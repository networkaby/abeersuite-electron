---
name: voucher-locks-held
description: Double-press lock fix is on main (7e26fc84f) for v1.17.17; two real presses never tested
metadata:
  type: project
---
Owner, 2026-11-26: landed on main before the v1.17.17 tag (7e26fc84f), replacing the earlier "after 1.17.17".
**Why:** the 1.17.17 installer of 2026-11-25 predates it and is being rebuilt.
**How to apply:** any 1.17.17 installer must be built from 7e26fc84f or later; try post, cancel and shift close on it. hold/voucher-locks (43bb75989, same code) deleted 2026-11-26 on the owner's word. See [project_write_mode_live_on_purpose](project_write_mode_live_on_purpose.md).
