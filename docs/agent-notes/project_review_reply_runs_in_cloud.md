---
name: project-review-reply-runs-in-cloud
description: "Owner wants scheduled review-reply to run in the cloud (Claude Code /schedule), not Cowork or a local task"
metadata:
  type: project
  modified: 2026-10-29T18:32:15.793Z
---

Owner decided 2026-10-30: scheduled review-reply must run in the cloud, even with every shop device off. Cowork and local Code tasks are out, because both need a PC on.

**Why:** they want it to run with every device off. The Cowork API key is fine to hold in a private skill, because the owner won't share it and can rotate the key in Settings → Incoming API.

**How to apply:** use a cloud scheduled agent (/schedule) on the repo's review-reply skill. ABEERSUITE_URL and COWORK_API_KEY go into the cloud environment's secrets, not git.
