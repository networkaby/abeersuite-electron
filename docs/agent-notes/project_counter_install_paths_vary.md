---
name: project-counter-install-paths-vary
description: Counter PCs have AbeerSuite in either Program Files or LocalAppData — never assume one path in support commands.
metadata: 
  type: project
  modified: 2026-09-06T13:15:38.903Z
---

Shop counter PCs do not all install AbeerSuite to the same place. Counter 93
(DESKTOP-6KQ7A8H) has the per-user install at
`%LOCALAPPDATA%\Programs\AbeerSuite`; counter 94 has a per-machine install at
`C:\Program Files\AbeerSuite`. `package.json` sets `nsis.perMachine: false`, so
the config alone suggests per-user only — but `allowElevation: true` lets the
operator choose all-users at install time, and on at least one counter they did.

**Why:** a hardcoded `%LOCALAPPDATA%` path in a support command fails with
"is not recognized as the name of a cmdlet" on those machines, which reads like
the app is missing when it is only somewhere else.

**How to apply:** when handing the owner a command that runs a bundled binary
(`psql.exe`, `pg_dump.exe` — see `getEmbeddedBinPath()` in
electron/postgresManager.ts), discover the path instead of assuming it:

    $PSQL = (Get-ChildItem "$env:LOCALAPPDATA\Programs","$env:ProgramFiles","${env:ProgramFiles(x86)}" -Recurse -Filter psql.exe -ErrorAction SilentlyContinue | Select-Object -First 1).FullName

The embedded cluster is always `postgresql://postgres@localhost:54329/smx`
(trust auth, no password) and only runs while the app is open. The data
directory stays per-user at `%APPDATA%\AbeerSuite\pgdata` regardless of where
the program is installed.

Also: Windows PowerShell 5.1 writes a BOM with `-Encoding utf8`, which psql
rejects as a syntax error on the first line — use `-Encoding ascii` for
generated `.sql` files.
