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
    buildOnlineName,
    buildOnlineSlug,
    DEFAULT_NAMING_CONFIG,
    type NamingConfigShape,
    type NamingMasters,
} from "./productName";

/// The master columns every naming build needs. One select, one mapper — the
/// bulk sweep and the single-product build must see identical inputs or the
/// two paths drift.
const NAMING_SELECT = {
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
} as const;

type NamingRow = {
    namePart: string | null;
    modelNo: string | null;
    attrsJson: unknown;
    brand: { name: string } | null;
    category: { name: string } | null;
    group: { name: string } | null;
    warrantyTerm: { name: string } | null;
    unit: { code: string } | null;
};

function mastersOf(p: NamingRow): NamingMasters {
    return {
        brand: p.brand,
        category: p.category,
        group: p.group,
        warranty: p.warrantyTerm,
        unit: p.unit ? { code: p.unit.code } : null,
        modelNo: p.modelNo,
        attrs: (p.attrsJson as Record<string, string> | null) ?? null,
        userPart: p.namePart,
    };
}

/** What the naming convention WOULD produce for one product, right now. */
export interface ProductNaming {
    name: string;
    onlineName: string;
    slug: string;
    /** False when the convention has the slug block switched off in Settings. */
    slugEnabled: boolean;
}

/** Masters picked on screen but not saved yet — `null` = cleared, absent = as saved. */
export interface NamingOverrides {
    groupId?: number | null;
    brandId?: number | null;
}

/**
 * Build all three names for a single product from its current masters.
 *
 * Read-only — it computes and returns, it never writes. The caller decides
 * whether to keep the result (the shop product form shows it for review, then
 * saves on the operator's Save). Deliberately unlike the bulk sweep, which
 * refuses to touch online name / slug at all: rewriting one product's URL under
 * an operator who is looking at it is a different act from rewriting a thousand.
 */
export async function buildProductNaming(
    productId: number,
    overrides: NamingOverrides = {},
): Promise<ProductNaming | null> {
    const pick = (id: number | null | undefined, find: (id: number) => Promise<{ name: string } | null>) =>
        id === undefined ? undefined : id === null ? Promise.resolve(null) : find(id);
    const [p, config, group, brand] = await Promise.all([
        prisma.invProduct.findUnique({ where: { id: productId }, select: NAMING_SELECT }),
        loadNamingConfig(),
        pick(overrides.groupId, (id) => prisma.invProductGroup.findUnique({ where: { id }, select: { name: true } })),
        pick(overrides.brandId, (id) => prisma.invBrand.findUnique({ where: { id }, select: { name: true } })),
    ]);
    if (!p) return null;

    const masters = mastersOf({
        ...p,
        group: group === undefined ? p.group : group,
        brand: brand === undefined ? p.brand : brand,
    });
    return {
        name: buildOfflineName(masters, config).trim(),
        onlineName: buildOnlineName(masters, config).trim(),
        slug: buildOnlineSlug(masters, config).trim(),
        slugEnabled: config.slugEnabled !== false,
    };
}

/// Which products to rebuild. Exactly one FK filter is set by a master rename;
/// `all` is used when the naming convention itself changes. An empty scope is a
/// no-op (guards against silently rewriting the whole catalog).
export interface RegenNameScope {
    /** Exact products — a single edit that changed a naming source. */
    ids?: number[];
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
export async function loadNamingConfig(): Promise<NamingConfigShape> {
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
        : scope.ids?.length ? { id: { in: scope.ids } }
        : scope.brandId != null ? { brandId: scope.brandId }
        : scope.categoryId != null ? { categoryId: scope.categoryId }
        : scope.groupId != null ? { groupId: scope.groupId }
        : scope.warrantyTermId != null ? { warrantyTermId: scope.warrantyTermId }
        : scope.unitId != null ? { unitId: scope.unitId }
        : null;
    if (where == null) return { scanned: 0, updated: 0 };

    const config = cfg ?? (await loadNamingConfig());

    const products = await prisma.invProduct.findMany({ where, select: NAMING_SELECT });

    const updates: Array<{ id: number; name: string }> = [];
    for (const p of products) {
        // Only rebuild products that have a Custom part (namePart) to anchor the
        // name. With no custom part the stored name IS the descriptive content
        // (imported / hand-typed) and a masters-only rebuild would wipe it — so
        // a master rename / naming-config change leaves those names untouched.
        // Matches the grid / dialog rule (patchWithRegen).
        if (!p.namePart || !p.namePart.trim()) continue;

        const next = buildOfflineName(mastersOf(p), config).trim();
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

/// Product fields the generated name is built from. A save touching any of them
/// rebuilds that product's name on the server — whichever screen or API saved it
/// (owner, 2026-11-12: the e-commerce form, AI and bulk edits used to leave names stale).
export const NAME_SOURCE_FIELDS = ["brandId", "groupId", "categoryId", "warrantyTermId", "unitId", "modelNo", "namePart", "attrsJson"] as const;

export function touchesName(patch: object): boolean {
    return NAME_SOURCE_FIELDS.some((k) => (patch as Record<string, unknown>)[k] !== undefined);
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
