// Shared on-disk location for the personal config snapshot. Committed (scrubbed
// of password hashes) so it ports across machines; regenerable from the live DB
// any time via `pnpm seed:personal:capture`.
import { resolve } from "path";

export const PERSONAL_SNAPSHOT_PATH = resolve(process.cwd(), "prisma/seeds/data/personal.local.json");
