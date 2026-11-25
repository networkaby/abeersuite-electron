---
name: project_no_code_signing_for_now
description: Owner declined paid Windows code signing on 2026-09-06; the SmartScreen prompt stays and must not be re-proposed.
metadata: 
  type: project
  modified: 2026-09-06T00:34:35.281Z
---

The AbeerSuite installer is unsigned, so counters get the SmartScreen "Windows
protected your PC" prompt. On **2026-09-06** the owner decided **not to spend on
a certificate for now**. Treat this as settled: do not re-propose signing, and do
not add signing config to `package.json`, until the owner raises it themselves.

**Why:** no code change removes SmartScreen — only a certificate does — so the
prompt is a known, accepted cost rather than an open bug. Re-raising it wastes
their time on a decision already made.

**How to apply:** when the prompt comes up in a discussion, say plainly that it
is the unsigned installer and that signing is deliberately deferred, then move
on. If the owner ever asks to revisit, the options are Azure Trusted Signing
(~$10/month, no hardware token — the cheaper path) or an EV certificate needing a
USB token in the release machine. Signing would also let electron-updater verify
updates via `publisherName`.

Related: [project_release_means_full_checklist](project_release_means_full_checklist.md).
