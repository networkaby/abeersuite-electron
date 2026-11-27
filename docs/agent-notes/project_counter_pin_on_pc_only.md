---
name: counter-pin-on-pc-only
description: Counter PIN lives only on the counter PC (sealed file), never in any database; server sees only a signed password note
type: project
---

Since 2026-11-27 the counter PIN is kept only by the desktop app (`electron/pinVault.ts`, Windows-sealed `counter-pins.bin`). The server never sees a PIN; it signs a "password note" (`counterResume.ts`) at a password sign-in, and the note — unlocked by the PIN on the PC — signs the person back in.

**Why:** owner: storing the PIN beside the password in the DB is insecure; the password is the real login, the PIN only gets someone back into a login they already made on that counter.

**How to apply:** never add a PIN column/table or sync it; never send the PIN to the server. The old `user_counter_pins` table is dead and is to be dropped by a migration after counters update. Do not re-propose a server-side PIN.
