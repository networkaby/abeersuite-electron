import { prismaAuthoritative } from "@/shared/lib/prisma/prismaClient";
import { PERMISSION_CATALOG } from "./permissionCatalog";

const CATALOG_BY_ID = new Map(PERMISSION_CATALOG.map((p) => [p.id, p]));

/**
 * Create the Permission rows for any of `ids` that the CODE knows (they are in
 * PERMISSION_CATALOG) but the DB does not have yet. Idempotent and cheap: one
 * lookup, one createMany only when something is missing.
 *
 * Why: a nav link added to SETTINGS_NAV / MODULE_SECTIONS mints a
 * `ui:sidebar:<module>:<link>` id on its own. Until now that row existed only
 * after `pnpm seed:sync-permissions` or a full seed, so a Departments save was
 * rejected ("Unknown permission") and a Role save silently dropped the tick.
 * Calling this first on both save paths creates the row on first use instead.
 *
 * Ids unknown to BOTH code and DB are left alone — the caller's own validation
 * still rejects those. Never deletes anything; the prune stays with the seeds.
 */
export async function ensureCatalogPermissions(ids: readonly string[]): Promise<string[]> {
    const wanted = [...new Set(ids)].filter((id) => CATALOG_BY_ID.has(id));
    if (!wanted.length) return [];
    const have = await prismaAuthoritative.permission.findMany({ where: { id: { in: wanted } }, select: { id: true } });
    const haveIds = new Set(have.map((p) => p.id));
    const missing = wanted.filter((id) => !haveIds.has(id));
    if (!missing.length) return [];
    await prismaAuthoritative.permission.createMany({
        data: missing.map((id) => {
            const p = CATALOG_BY_ID.get(id)!;
            return { id, label: p.label, module: p.module, description: p.description, systemOnly: p.systemOnly ?? false };
        }),
        skipDuplicates: true,
    });
    return missing;
}
