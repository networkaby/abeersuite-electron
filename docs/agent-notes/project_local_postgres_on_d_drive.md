---
name: project_local_postgres_on_d_drive
description: "Local PostgreSQL 17 lives on D:, not C:; the C:\Program Files\PostgreSQL\17 folder is a leftover data dir with no bin and makes psql look missing."
metadata:
  type: project
---

On the owner's dev machine the working PostgreSQL 17 install is at
**`D:\Program Files\PostgreSQL\17\bin`** (`psql`, `pg_dump`, `pg_restore`, 17.11).
Service `postgresql-x64-17` runs from there with its data dir on D: too.

`C:\Program Files\PostgreSQL\17` also exists but holds only `data` and `lib` — **no `bin`** —
so looking there concludes "psql is not installed" and that is wrong.

**Why:** an earlier note had the Vyapar work blocked on "a local PostgreSQL 17 reinstall"
(see [project_vyapar_migration](project_vyapar_migration.md)). Nothing needs reinstalling; the path was just wrong.

**How to apply:** read the service's own `PathName`
(`Get-CimInstance Win32_Service -Filter "Name='postgresql-x64-17'"`) to find the real bin,
the same discover-don't-hardcode rule as [project_counter_install_paths_vary](project_counter_install_paths_vary.md).
