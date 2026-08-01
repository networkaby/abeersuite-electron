import { prisma } from "@/shared/lib/prisma/prismaClient";

/**
 * Storefront category source — office **Group**, not office Category.
 *
 * Vocabulary bridge between the two sides of the app:
 *
 *   office InvProductGroup  → customer-facing "Category"  (CCTV, Cables)
 *   office InvCategory      → customer-facing "Collection" (Office Supplies)
 *
 * The office keeps its own words: Group is the GST/HSN classification, Category
 * is the marketing bucket. But a customer navigates by the *thing* — which is
 * what our Group tree already holds — so the storefront reads Group and shows it
 * under the word the customer expects. See ARCHITECTURE.md.
 *
 * Groups are hierarchical ("CCTV" → "Dome Camera" → "2MP Dome"). Leaf names are
 * far too fine for storefront chips, so a product's category is the name of the
 * **root** of its group chain. One query loads the whole tree; every walk after
 * that is in-memory (same shape as the tax cascade in gstResolver.ts).
 */

const MAX_GROUP_DEPTH = 10;

/** groupId → name of the root group its chain ends at. */
export type GroupRootMap = Map<number, string>;

/**
 * Build the groupId → root-group-name map for the whole catalog in one query.
 * Server-only (imports prisma). Pass the result to `invProductToPublic`.
 */
export async function loadShopGroupRoots(): Promise<GroupRootMap> {
    const rows = await prisma.invProductGroup.findMany({
        select: { id: true, name: true, parentId: true },
    });

    const byId = new Map(rows.map((g) => [g.id, g]));
    const roots: GroupRootMap = new Map();

    for (const g of rows) {
        let cur = g;
        const seen = new Set<number>([g.id]);
        for (let i = 0; i < MAX_GROUP_DEPTH && cur.parentId != null; i++) {
            if (seen.has(cur.parentId)) break; // defensive: cycle
            const parent = byId.get(cur.parentId);
            if (!parent) break; // orphan → treat current as root
            seen.add(parent.id);
            cur = parent;
        }
        roots.set(g.id, cur.name);
    }

    return roots;
}
