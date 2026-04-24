import { defineConfig } from "prisma/config";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: (process.env.DIRECT_URL ?? process.env.DATABASE_URL)!,
  },
  migrations: {
    seed: "pnpm exec tsx src/new-seed.ts",
  },
});