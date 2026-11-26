---
name: photo-size-rule
description: Product photos are measured, not judged by eye — short side < 500 px is too small, < 800 weak
type: feedback
---

Every shop photo is measured with `photo-edit.mjs size` before prep judges or edits it. Short side < 500 px = TOO SMALL: removed (or suggestRemove + staff reshoot when it is the only one of a view), never the main photo, never edited, and Part 4 never verifies a product that still has one. 500–799 px = WEAK: a note in prep, no line in Part 4.

**Why:** owner, 2026-11-27. SKU 136360 shipped a 250×164 thumbnail (uploaded 7 Oct, never overwritten) that the AI kept because it looks fine shown small, and `cutout` stretches inputs to 1500 px, hiding the blur.

**How to apply:** prep `photos.md` "Photo size" and product-recheck §3 own the rule; the tool refuses edits on < 500 px (exit 3). On 2026-11-27 six more shop photos were under 400 px wide; the next prep or recheck of those products catches them.
