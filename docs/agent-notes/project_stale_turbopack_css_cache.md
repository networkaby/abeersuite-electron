---
name: project_stale_turbopack_css_cache
description: "Turbopack can serve a stale globals.css here — verify tokens in the served CSS, not just the file"
metadata: 
  type: project
  modified: 2026-09-16T02:20:34.589Z
---

Editing `src/app/globals.css` does not reliably reach the browser on this machine.
Next prints "Slow filesystem detected" for the D: drive at startup, and the
content-hashed stylesheet came back byte-identical even after a full dev-server
restart, so new `--m-*` tokens read as EMPTY in `getComputedStyle`.

**Why:** the token was in the file, and the file's mtime was current — the cache
under `.next` was stale, not the source.

**How to apply:** before concluding a CSS token is broken, fetch the stylesheet the
page actually loaded and grep it:

    H=$(curl -s http://localhost:3000/staff/login)
    echo "$H" | grep -o '/_next/static/[^"]*\.css' | head -1

then curl that path and grep for the token. If it is missing, the cache is stale —
wait, or clear `.next`. `rm -rf .next` on this drive took >10 minutes and was
killed twice; the cache also recovered on its own, so try waiting first.

Relates to [project_office_colour_rollout](project_office_colour_rollout.md).
