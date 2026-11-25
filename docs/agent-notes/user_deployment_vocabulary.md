---
name: user-deployment-vocabulary
description: "Owner's words — office, shop/public, counter app = counter = desktop app (one office-mode Electron app); never say till"
metadata:
  type: user
  modified: 2026-10-27T19:27:32.175Z
---

Owner's vocabulary (2026-10-24, firmed up 2026-10-28):
- **office** = the office web app on Vercel (APP_MODE=office, `d_office`).
- **shop** / **public** = the storefront + customer portal on Vercel (APP_MODE=public, `d_shop`).
- **counter app** = **counter** = **desktop app** — the Electron app, always built as APP_MODE=office.
- **Never say "till"** — owner finds it annoying (2026-10-28). Old docs/comments say till; read it as counter, don't echo it.

2026-10-28 the `APP_MODE=counter` desktop variant is retired "temporarily" (see [project_counter_variant_unproven](project_counter_variant_unproven.md)); revival only in the far future. Keep its code and docs intact — don't build it, don't delete it, don't add rules only it needs. Written into docs/vocabulary.md and PROJECT_BRAIN Key decisions.

**How to apply:** treat "office build" vs "counter build" of the desktop app as one app; no gates or key splits between desktop variants (e.g. no separate office install secret) while it is retired.
