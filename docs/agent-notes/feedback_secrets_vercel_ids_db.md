---
name: feedback-secrets-vercel-ids-db
description: Config rule - ids in DB or .env, never in code; secrets may also be saved in App Settings (locked, temporary) with .env fallback
metadata:
  type: feedback
---
Sensitive keys (tokens, secrets) live in Vercel env / .env; low-sensitivity values (Meta phone number ids, WABA id, picks) live in the DB, set from an app screen.
**Why:** owner said so 2026-11-12 when moving WhatsApp number ids off constants/.env; switching numbers should not need a release.
**How to apply:** never propose storing a token in the DB; offer an app setting for ids. Related: [project_wa_96996_coexistence_plan](project_wa_96996_coexistence_plan.md).

Owner 2026-11-12 (again, firmly): account/integration ids (phone number ids, WABA id, app ids, config ids, bucket names) must NOT be hardcoded in code constants — only .env or DB. Supersedes the older "ids in constants not .env" note in [project_wa_second_number_r2](project_wa_second_number_r2.md).


UPDATED 2026-11-12 (owner): secrets MAY now be saved in App Settings too, for testing without a deploy; the plan is to move them to Vercel later and clear them from the DB. They are stored locked with AI_KEY_SECRET, never shown back, and editing needs settings:app:secrets. Do not re-raise the "secrets never in DB" objection.
