import { defineConfig } from "prisma/config";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

export default defineConfig({
  schema: "prisma/schema",
  datasource: {
    // PRISMA_MIGRATE_URL is set by scripts/migrate-primary.mjs on deploy (the primary,
    // DB1 or DB2). Otherwise DB1. The old DIRECT_URL / DATABASE_URL names are gone.
    url: (process.env.PRISMA_MIGRATE_URL ?? process.env.DIRECT_URL_1 ?? process.env.DATABASE_URL_1)!,
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