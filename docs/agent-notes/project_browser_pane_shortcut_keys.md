---
name: project-browser-pane-shortcut-keys
description: "Browser pane key/type actions do not fire the POS window shortcuts (\"/\", F10); dispatch a KeyboardEvent, and click checkout boxes by ref"
metadata:
  type: project
  modified: 2026-09-27T12:20:39.382Z
---

In the built-in Browser pane, `computer` `key "slash"` and `type "/"` never reached the POS checkout's window `keydown` handler (usePosBilling "/" fill, F10) — the text went into the box, the shortcut did not run. Dispatching `new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })` on `document.activeElement` did. Seen 2026-09-27 testing the paise fix.

**Why:** a shortcut can look broken when only the test harness is.

**How to apply:** to test POS shortcuts in the pane, dispatch the event from `javascript_tool`, and tell the owner a real key press on a counter is still worth one check. The checkout dialog reflows as totals change (the no-credit warning, the extra-collected block), so click tender boxes by `find` ref, never by screen coordinates. Never press Enter in the checkout — it confirms the sale on live books ([project_dev_server_writes_to_live](project_dev_server_writes_to_live.md)).
