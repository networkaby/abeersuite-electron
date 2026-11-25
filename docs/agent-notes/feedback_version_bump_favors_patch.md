---
name: feedback_version_bump_favors_patch
description: "Owner picks a patch bump over minor even when the diff includes new UI (FaceGrid/PinPad components), if the framing is 'fixing the sign-in flow' rather than 'shipping a new feature'."
metadata: 
  type: feedback
  modified: 2026-09-18T15:14:18.422Z
---

At the v1.5.1 release (2026-09-18), the batch included a full re-creation of the counter sign-in sequence (new `FaceGrid.tsx`, `PinPad.tsx` components, new states) alongside straightforward fixes (photo/position bugs, day-book filter). I recommended a minor bump (1.6.0) on the reasoning that new components = new capability. The owner chose patch (1.5.1) instead.

**Why:** the PIN sign-in feature itself had already shipped in v1.5.0 and was announced there; this release was framed as putting that same feature back together correctly, not introducing it. New files/components created while repairing an already-shipped feature don't by themselves justify a minor bump.

**How to apply:** when drafting the version-bump question in the [project_release_means_full_checklist](project_release_means_full_checklist.md) release runbook, weigh "was this capability already announced in a prior release's notes" more heavily than "did new files get added this batch." Still ask rather than assume — this is one data point, not a hard rule.
