import { prisma } from "@/shared/lib/prisma/prismaClient";

/**
 * Storefront category source — office **Group**, not office Category.
 *
 * Vocabulary bridge between the two sides of the app:
 *
 *   office InvProductGroup  → customer-facing "Category"  (Mouse, HD Dome)
 *   office InvCategory      → office-only classification  (pricing strategy,
 *                             loyalty + coupon rules, movement bands)
 *
 * The office keeps its own words: Group is the GST/HSN classification. But a
 * customer navigates by the *thing*, which is what the Group tree already
 * holds, so the storefront reads Group and shows it under the word the customer
 * expects.
 *
 * A product's category is its **OWN** group, not the root of its chain. Rooting
 * it was a deliberate earlier simplification ("leaf names are too fine for
 * chips") and it is wrong: every mouse, keyboard, cabinet and monitor roots at
 * "IT Products", so rooting collapses a whole department into one bucket and
 * makes leaf-level browsing impossible. The ancestor chain is returned
 * alongside, so callers that want the department (breadcrumbs, top-level
 * filters) can walk up instead of the data being flattened for them.
 */

const MAX_GROUP_DEPTH = 10;

// Shapes + pure helpers live in groupTree.ts (no prisma) so client-reachable
// modules can use them without pulling this file's prisma import into the
// browser bundle. Re-exported here for server callers' convenience.
export { rootOf, type ShopGroup, type ShopGroupIndex } from "@/shared/lib/shop/groupTree";
import type { ShopGroup, ShopGroupIndex } from "@/shared/lib/shop/groupTree";

/**
 * Build the groupId → group+ancestors index for the whole catalog in one query.
 * Server-only (imports prisma). Pass the result to `invProductToPublic`.
 */
export async function loadShopGroupIndex(): Promise<ShopGroupIndex> {
    const rows = await prisma.invProductGroup.findMany({
        select: { id: true, name: true, parentId: true },
    });

    const byId = new Map(rows.map((g) => [g.id, g]));
    const index: ShopGroupIndex = new Map();

    for (const g of rows) {
        const ancestors: { id: number; name: string }[] = [];
        const seen = new Set<number>([g.id]);
        let cur = g;
        for (let i = 0; i < MAX_GROUP_DEPTH && cur.parentId != null; i++) {
            if (seen.has(cur.parentId)) break; // defensive: cycle
            const parent = byId.get(cur.parentId);
            if (!parent) break; // orphan → stop here
            seen.add(parent.id);
            ancestors.push({ id: parent.id, name: parent.name });
            cur = parent;
        }
        index.set(g.id, { id: g.id, name: g.name, ancestors });
    }

    return index;
}
