# Make AbeerSuite Desktop fit to distribute

## Context

The 0.1.0 Windows installer (`dist-app/AbeerSuite Setup 0.1.0.exe`, 256 MB) is built but not
shippable. An audit of the packaged artifact found one hard launch blocker, one credential leak,
and one network-exposure problem. Goal: a v1 installer that starts reliably on a clean shop PC,
carries no secrets, and talks only to Supabase (local replica deferred).

**Correction to the first audit pass:** the crash log in `scratch/app-log.txt` came from the older
`dist-package` build (20:25), not the current `dist-app` build (23:18). `dotenv` and
`electron-updater` *are* bundled in the current asar (packed inside `app.asar`, which is why a
directory search missed them). Those two are not blockers. The real launch blocker is Step 1 below.

**Decisions taken:** counters get credentials from a hand-placed `%APPDATA%/AbeerSuite/.env`;
v1 ships in live mode (direct Supabase) and the local Postgres replica is deferred; no code-signing
certificate yet.

---

## Step 1 — Make the app actually start (the real blocker)

`.next/standalone/node_modules/*` are **absolute symlinks into the pnpm store**:

```
next -> D:/AbeerSuite/abeersuite-electron/node_modules/.pnpm/next@16.2.6_.../node_modules/next
```

electron-builder does not dereference these when copying `extraResources`, so the packaged
`resources/standalone/` has **no `node_modules` at all** (verified: present locally at 15 MB,
absent in `dist-app/win-unpacked/resources/standalone/`). `standalone/server.js` does
`require('next')`, which resolves against its own directory — so the Next server never boots, and
the window shows `ERR_CONNECTION_REFUSED`. The `NODE_PATH` fallbacks at
[serverManager.ts:46](D:/AbeerSuite/abeersuite-electron/electron/serverManager.ts) cannot fix this:
`next`'s own transitive requires resolve relative to `next`'s location, not `NODE_PATH`.

**Fix — hoist the traced deps into a real tree at build time.**

- Extend [scripts/prepare-standalone.ts](D:/AbeerSuite/abeersuite-electron/scripts/prepare-standalone.ts),
  reusing its existing `copyFolderSync` helper: add a `hoistStandaloneDeps()` pass that walks
  `.next/standalone/node_modules`, resolves each symlink with `fs.realpathSync`, and copies the
  real package into a flat `standalone/node_modules/<name>/`. Dedupe by package name and keep a
  `visited` set — pnpm's `.pnpm` tree is cyclic (A → B → A), so an unguarded recursive copy will
  not terminate. Node resolution walks up parent directories, so a flat top level is sufficient
  for a traced production set.
- Fail the build loudly if the result is incomplete: assert
  `standalone/node_modules/next/package.json` exists before `electron-builder` runs.
- Then delete the now-dead `nodePaths` / `NODE_PATH` block in `serverManager.ts` — the current
  refactor phase calls for removing abstractions that no longer carry weight.

*Fallback if flat hoisting hits a version conflict:* add `.npmrc` with `node-linker=hoisted` and
reinstall, which makes pnpm write real directories. Avoided as the primary route because it changes
the install layout for every dev and for Vercel.

---

## Step 2 — Stop shipping production secrets

`dist-app/win-unpacked/resources/standalone/.env` ships **11.6 KB / ~60 keys in plaintext**,
outside the asar, readable by any customer: `NEXTAUTH_SECRET`, `SUPER_ADMIN_PASSWORD`,
`DATABASE_URL` + `DIRECT_URL` (production Supabase), `RAZORPAY_KEY_SECRET`, `PAYU_MERCHANT_SALT`,
`CASHFREE_SECRET_KEY`, `DROPBOX_APP_SECRET` + `DROPBOX_REFRESH_TOKEN`, `CLOUDINARY_API_SECRET`,
`FIREBASE_SERVICE_ACCOUNT_JSON`, `META_WA_ACCESS_TOKEN`, `RESEND_API_KEY`, `SENTRY_AUTH_TOKEN`,
`GITHUB_DISPATCH_TOKEN`, `SHIPROCKET_PASSWORD`.

- `package.json` → `build.extraResources` for `.next/standalone`: change `filter` to
  `["**/*", "!.env", "!.env.*"]`.
- `prepare-standalone.ts`: unlink `.next/standalone/.env` after the copy pass, so a stray file
  cannot ride along even if the filter is edited later.
- [electron/main.ts:11-21](D:/AbeerSuite/abeersuite-electron/electron/main.ts): drop the
  `standaloneEnv` fallback. If `%APPDATA%/AbeerSuite/.env` is missing, show
  `dialog.showErrorBox` naming the exact expected path and
  [.env.counter.example](D:/AbeerSuite/abeersuite-electron/.env.counter.example), then `app.quit()`.
  Failing visibly beats booting against whatever env happens to be present.
- The forked Next server already inherits `process.env` (`serverManager.ts` spreads it), so
  `dotenv` loading in the main process is enough to feed the server — no second env path needed.
- New `scripts/verify-package.ts` (named `assert-no-secrets-in-package.ts` in the original plan;
  renamed once it also gained the standalone-completeness check): scan `dist-app/win-unpacked` for
  `.env` files and a list of key names; exit non-zero on a hit. Wire into the `electron:dist` script
  after `electron-builder`.
- `.gitignore`: add `dist-package/` (currently untracked but **not** ignored — 256 MB is one
  `git add .` from entering history; `dist-app/` is already ignored).

**Operational, not code:** every credential above must be rotated. They are already baked into two
installers on disk; if either `.exe` has left this machine, treat all of them as public.
`NEXT_PUBLIC_*` values are inlined into the client bundle at build time and are public by design —
no action needed there.

---

## Step 3 — Live mode only, and stop listening on the LAN

- [serverManager.ts:57](D:/AbeerSuite/abeersuite-electron/electron/serverManager.ts): `HOSTNAME`
  is `"0.0.0.0"`, so the POS is reachable at `http://<counter-ip>:3000` from anywhere on the shop
  wifi. Change to `"127.0.0.1"`.
- [postgresManager.ts](D:/AbeerSuite/abeersuite-electron/electron/postgresManager.ts): return early
  unless `process.env.COUNTER_PC === "1"` **and** the bundled binaries exist. Critically, stop
  setting `LOCAL_DATABASE_URL` on the not-found path (currently line 88 invents
  `postgresql://postgres@localhost:5432/smx`).

  Why this matters beyond tidiness: `reportLiveDown()` in
  [counterMode.ts:94](D:/AbeerSuite/abeersuite-electron/src/shared/lib/prisma/counterMode.ts)
  demotes to `LOCAL` on a transient Supabase error, and `shouldReadLocal()` then returns `true`
  *regardless of `replicaReady`*. With a bogus `LOCAL_DATABASE_URL` set, a brief Supabase blip
  would route reads at a database that does not exist — a hard failure instead of a retry.
  `prismaClient.ts:17-20` documents the correct contract: absent `LOCAL_DATABASE_URL` collapses
  cleanly to single-client live behaviour. Leave it unset.
- `resources/pgsql` is empty (0 files), so nothing was ever bundled. Leave it empty for v1 and let
  the `COUNTER_PC` gate keep the replica path dormant.

---

## Step 4 — Ship-quality basics

- **Icon:** no `build/icon.ico` and no `win.icon`, so the installer, desktop shortcut and taskbar
  all show the default Electron icon. Add a 256×256 `.ico` and reference it.
- **Single-instance lock:** add `app.requestSingleInstanceLock()` in `main.ts`; a second launch
  currently starts another server/Postgres attempt. Focus the existing window instead.
- **Updater filename mismatch:** `latest.yml` points at `AbeerSuite-Setup-0.1.0.exe` (dashes) but
  the artifact is `AbeerSuite Setup 0.1.0.exe` (spaces). Set
  `artifactName: "${productName}-Setup-${version}.${ext}"` so both agree. Also confirm
  `devloperakramul/abeersuite-electron` (from `app-update.yml`) is public, or the updater 404s.
- **Renderer hardening:** `sandbox: false` can become `true` — the preload only touches
  `contextBridge`/`ipcRenderer`, no Node APIs. Add `setWindowOpenHandler` to deny new windows.
- **`sync:trigger` is a stub** ([main.ts:121](D:/AbeerSuite/abeersuite-electron/electron/main.ts))
  returning `{success:true}` without syncing. Either implement it or have it reject, so the UI
  cannot report a sync that never happened.

---

## Verification

Run after each step; Step 1 and Step 5 are the ones that actually prove the build.

1. **Step 1:** `pnpm electron:build`, then confirm
   `.next/standalone/node_modules/next/package.json` exists as a **real file, not a symlink**
   (`ls -la`). Then `pnpm electron:pack` and check
   `dist-app/win-unpacked/resources/standalone/node_modules/next/` is present in the package.
2. **Step 2:** after `pnpm electron:dist`, `find dist-app/win-unpacked -name ".env"` must return
   nothing, and `verify-package.ts` must pass. Launch with no
   `%APPDATA%/AbeerSuite/.env` and confirm the error dialog names the path instead of the app
   silently starting.
3. **Step 3:** with a valid `.env` in place and `COUNTER_PC` unset, launch and confirm the log
   shows no Postgres attempt, the app reaches `/staff/login`, and login works against Supabase.
   From a second machine on the same LAN, `curl http://<counter-ip>:3000` must be refused.
4. **Step 5 — clean-profile smoke test (required before shipping).** Install the signed-off `.exe`
   under a **fresh Windows user profile** (or a VM) with no repo, no pnpm store and no PostgreSQL.
   Verify: app launches, login succeeds, a voucher prints on the thermal printer, the counter ID
   persists across a restart, and the window is not blank. Capture the log to
   `scratch/app-log.txt` as the record. Every blocker so far has come from the packaged
   environment differing from the dev tree, so nothing ships on a dev-machine test alone.

---

## Deferred (agreed, not in this pass)

- **Code signing** — no certificate yet, so shop PCs will show a SmartScreen "unknown publisher"
  prompt that staff must click through. Worth buying an OV cert before wide rollout.
- **Local Postgres replica** — bundling portable binaries plus first-run `createdb smx` and schema
  provisioning. Note the repo has no migrations directory (`db push` only, per the `ignore` comment
  in [scripts/gen-sync-registry.ts](scripts/gen-sync-registry.ts)), so this needs a
  schema-provisioning decision of its own.
- **Installer size** — the asar carries a 646 MB `node_modules` the main process does not need
  (it only requires `dotenv` and `electron-updater`); Step 1 makes `standalone/` self-sufficient,
  after which `build.files` can be narrowed. Left out here to avoid changing two things at once.
