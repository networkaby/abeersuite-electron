---
name: project-prep-part4-ready-not-publish
description: "Product prep Part 4 moves a verified product to Ready, never straight to Published — until the owner trusts the AI"
metadata:
  type: project
  modified: 2026-11-18T21:26:58.275Z
---

Product prep stage rules (owner, 2026-11-19): anything only a human can do → Attention from any stage; Part 1 ok → same stage; Part 2 ok/nothing found → same stage, technical failure → Attention; Part 3 → Draft; Part 4 verified → **Ready**; Part 5 → Draft. The owner's `then` instruction overrides a success's stage.

Part 4 goes to **Ready, not Published**, even for a product that was Published before.

**Why:** the owner wants to see the AI's verify quality first — "when we trust AI with satisfied performance we will let publish directly in future".

**How to apply:** do not add an auto-publish path or propose one until the owner says the AI has earned it; when they do, it is a `then: "published"`-style option on Part 4 (agentProductPrep.ts `leaveAt`). Related: [project_ui_realtime_heartbeat](project_ui_realtime_heartbeat.md).
