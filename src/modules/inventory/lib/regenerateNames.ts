// Server-side bulk regeneration of InvProduct.name from the naming convention.
//
// The client (product form + products grid) regenerates one product's name as
// the operator edits it. But a master rename (group / brand / category /
// warranty / unit) or a naming-convention change affects every product that
// references it — those need a server-side sweep so the stored `name` tracks
// the convention without re-opening each product.
//
// Only the OFFLINE name is rebuilt. Online display name and slug are left alone
// (the slug drives shop URLs — bulk-rewriting it would break links / SEO).

import { prisma } from "@/shared/lib/prisma/prismaClient";
import * as Sentry from "@sentry/nextjs";
import {
    buildOfflineName,
    DEFAULT_NAMING_CONFIG,
    type NamingConfigShape,
    type NamingMasters,
} from "./productName";

/// Which products to rebuild. Exactly one FK filter is set by a master rename;
/// `all` is used when the naming convention itself changes. An empty scope is a
/// no-op (guards against silently rewriting the whole catalog).
export interface RegenNameScope {
    brandId?: number;
    categoryId?: number;
    groupId?: number;
    warrantyTermId?: number;
    unitId?: number;
    all?: boolean;
}

export interface RegenNameResult {
    scanned: number;
    updated: number;
}

/// Load the singleton naming config as a full NamingConfigShape (DEFAULT filled
/// in for any missing field), matching what the API GET returns to the client.
async function loadNamingConfig(): Promise<NamingConfigShape> {
    const row = await prisma.invNamingConfig.findFirst({ orderBy: { id: "asc" } });
    return { ...DEFAULT_NAMING_CONFIG, ...(row ?? {}) } as unknown as NamingConfigShape;
}

const CHUNK = 500;

/**
 * Rebuild `InvProduct.name` from the naming convention for every product in
 * `scope`, writing only the rows whose name actually changes. A rebuild that
 * resolves to an empty string is skipped so an existing name is never blanked.
 *
 * Runs in chunked transactions (per-row updates, generous timeout) — the `all`
 * path can touch the whole catalog on a naming-config change.
 */
export async function regenerateProductNames(
    scope: RegenNameScope,
    cfg?: NamingConfigShape,
): Promise<RegenNameResult> {
    const where = scope.all
        ? {}
        : scope.brandId != null ? { brandId: scope.brandId }
        : scope.categoryId != null ? { categoryId: scope.categoryId }
        : scope.groupId != null ? { groupId: scope.groupId }
        : scope.warrantyTermId != null ? { warrantyTermId: scope.warrantyTermId }
        : scope.unitId != null ? { unitId: scope.unitId }
        : null;
    if (where == null) return { scanned: 0, updated: 0 };

    const config = cfg ?? (await loadNamingConfig());

    const products = await prisma.invProduct.findMany({
        where,
        select: {
            id: true,
            name: true,
            namePart: true,
            modelNo: true,
            attrsJson: true,
            brand: { select: { name: true } },
            category: { select: { name: true } },
            group: { select: { name: true } },
            warrantyTerm: { select: { name: true } },
            unit: { select: { code: true } },
        },
    });

    const updates: Array<{ id: number; name: string }> = [];
    for (const p of products) {
        const masters: NamingMasters = {
            brand: p.brand,
            category: p.category,
            group: p.group,
            warranty: p.warrantyTerm,
            unit: p.unit ? { code: p.unit.code } : null,
            modelNo: p.modelNo,
            attrs: (p.attrsJson as Record<string, string> | null) ?? null,
            userPart: p.namePart,
        };
        const next = buildOfflineName(masters, config).trim();
        // Skip unchanged names, and never blank a name to "".
        if (next && next !== p.name) updates.push({ id: p.id, name: next });
    }

    for (let i = 0; i < updates.length; i += CHUNK) {
        const slice = updates.slice(i, i + CHUNK);
        await prisma.$transaction(
            async (tx) => {
                for (const u of slice) {
                    await tx.invProduct.update({ where: { id: u.id }, data: { name: u.name } });
                }
            },
            { timeout: 60_000, maxWait: 15_000 },
        );
    }

    return { scanned: products.length, updated: updates.length };
}

/// Best-effort wrapper for the master / naming-config edit routes: a name
/// regeneration failure must never fail the edit itself. Logs to Sentry.
export async function regenerateProductNamesSafe(
    scope: RegenNameScope,
    cfg?: NamingConfigShape,
): Promise<void> {
    try {
        await regenerateProductNames(scope, cfg);
    } catch (err) {
        Sentry.captureException(err, { tags: { source: "regenerate-names" } });
        console.error("[regenerate-names] failed", err);
    }
}
