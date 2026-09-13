import { defineConfig } from "prisma/config";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

export default defineConfig({
  schema: "prisma/schema",
  datasource: {
    url: (process.env.DIRECT_URL ?? process.env.DATABASE_URL)!,
  },
  migrations: {
    // Committed migrations live here (docs/migrations.md). Spelled out because
    // the schema is a FOLDER (prisma/schema/), and Prisma then looks for
    // migrations beside that folder rather than at prisma/migrations.
    path: "prisma/migrations",
    // `pnpm prisma db seed` = PERSONAL bootstrap (code-owned catalog + your
    // captured config; upsert-only, non-destructive). The generic new-client
    // installer moved to `pnpm seed:generic` — run it only to build the demo
    // world on a fresh install with no snapshot.
    seed: "pnpm exec tsx prisma/seeds/personal-bootstrap.ts",
  },
});