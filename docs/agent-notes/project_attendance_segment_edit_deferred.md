---
name: project-attendance-segment-edit-deferred
description: "Segment-level attendance edit (count an Off duty gap as duty, e.g. a 2h meeting) is planned but deferred by the owner on 2026-10-13"
metadata:
  type: project
  modified: 2026-10-13T12:11:58.015Z
---

Owner asked on 2026-10-13 for segment-level editing on the Employee Activity day card: "I send him for a meeting for 2h, auto will consider him off duty for 2h". On 2026-10-13 they deferred it ("if it's big, keep in memory, we will do later").

The plan presented (not built):
- In "The day in order", each Off duty line gets a "Count as duty" button. It takes a reason (Meeting / Office work / Bank-outside work / Other + note) and can cover part of the gap. The line then shows "On duty — Meeting · by office", and the grant can be undone.
- Worked = the till's minutes + granted minutes. Away goes down by the same amount. Short, overtime and the short balance follow from that. Actual Worked stays the till's figure. A hand-typed Adjusted Worked (overrideWorkedMinutes) still wins.
- Storage: a new office-only table (userId, date, from, to, minutes, reason, grantedById, at). It needs a migration, and nothing ships to the counters first because tills never write it.
- Open questions for the owner: also the reverse (mark part of an On segment as off)? Gate on hr:attendance:edit?

**Why:** a new table + migration was too big for that session.
**How to apply:** when the owner returns to attendance work, offer this plan; don't start without their yes. Related: [project_hr_module_phase1](project_hr_module_phase1.md), [project_schema_ships_via_migrations](project_schema_ships_via_migrations.md).
