import { defineConfig } from "prisma/config";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

function primaryUrl(): string | undefined {
  const n = process.env.NEXT_PUBLIC_DB_PRIMARY?.trim().toUpperCase() === "DB2" && (process.env.DATABASE_URL_2?.trim() || process.env.DIRECT_URL_2?.trim()) ? "2" : "1";
  return process.env[`DIRECT_URL_${n}`]?.trim() || process.env[`DATABASE_URL_${n}`]?.trim();
}

export default defineConfig({
  schema: "prisma/schema",
  datasource: {
    // PRISMA_MIGRATE_URL is set by scripts/migrate-primary.mjs on deploy. Otherwise the
    // primary by NEXT_PUBLIC_DB_PRIMARY (same rule as namedPrimary() in dbTargets.ts —
    // until 2026-11-23 this was always DB1). The old DIRECT_URL / DATABASE_URL names are gone.
    url: (process.env.PRISMA_MIGRATE_URL ?? primaryUrl())!,
  },
  migrations: {
    // Committed migrations live here (docs/migrations.md). Spelled out because
    // the schema is a FOLDER (prisma/schema/), and Prisma then looks for
    // migrations beside that folder rather than at prisma/migrations.
    path: "prisma/migrations",
    // `pnpm prisma db seed` = sync-permissions --apply: catalog permissions the
    // DB lacks + R1 (Admin) top-up; safe on live. The generic new-client
    // installer is `pnpm seed:generic`. A running org restores from a backup.
    seed: "pnpm exec tsx prisma/seeds/sync-permissions.ts --apply",
  },
});