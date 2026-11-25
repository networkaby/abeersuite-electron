---
name: electron-builder-needs-bigger-heap
description: electron-builder --dir can die with "Node module collector process exited with code 134" (OOM); rerun with NODE_OPTIONS=--max-old-space-size=8192
metadata:
  type: project
---
Seen 2026-09-25 on a resumed pack. Rerunning `NODE_OPTIONS=--max-old-space-size=8192 npx electron-builder --dir` then `pnpm verify:package` passed. An EBUSY on dist-app/win-unpacked the same day was a folder handle held by an Explorer/terminal window; PowerShell Remove-Item cleared the empty dir when bash rm could not.

**Why:** same heap pressure as [project_tsc_needs_bigger_heap](project_tsc_needs_bigger_heap.md).
**How to apply:** resume only the builder + verify steps, per [project_electron_pack_eperm_resumable](project_electron_pack_eperm_resumable.md).
