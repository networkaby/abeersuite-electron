import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";

/**
 * How one product relates to the rest of the catalogue, beyond its Group.
 *
 * A product sits on several relations at once. A gaming keyboard is a
 * *Keyboard* (Group — what it is) and may also be in *Gaming* and
 * *Videography* (Collections — what it is used for). Each relation is a
 * different reason to show something:
 *
 *   - Group      → substitutes ("More like this", similarProducts.ts). Items
 *                  that share more collections with the product rank first,
 *                  so a gaming keyboard shows gaming keyboards before plain ones.
 *   - Collection → a BRIDGE to other groups: the Gaming collection joins the
 *                  keyboard to a monitor, a graphics card, a headset. One row
 *                  per collection, its items from OTHER groups only.
 *
 * Nothing here is configured per collection. A collection that only mirrors
 * the product's own branch (e.g. "Storage & Memory" on an SSD — every other
 * item is a sibling group under Storage) bridges nothing, so it produces no
 * row and drops out on its own. Sibling groups in a real bridge (an IP Dome in
 * a 360 camera's CCTV kit) still show, after the true add-ons.
 *
 * Pure: works on the cached storefront catalogue, so a product page reads
 * nothing extra from the database.
 */

/** Most bridge rows one product page shows. */
export const BRIDGE_ROWS_MAX = 3;
/** Most cards in one bridge row. */
export const BRIDGE_ROW_LIMIT = 12;
/** A row with fewer items than this is not worth a heading. */
const BRIDGE_ROW_MIN = 2;

const inStockFirst = (a: ShopProductPublic, b: ShopProductPublic) =>
    Number(b.stockStatus === "in_stock") - Number(a.stockStatus === "in_stock");

/** How many collections `p` shares with `of`. */
export function sharedCollections(p: ShopProductPublic, of: Set<string>): number {
    let n = 0;
    for (const c of p.collections) if (of.has(c)) n++;
    return n;
}

/**
 * Re-order same-group items so those sharing more collections with `product`
 * come first; in-stock next; otherwise the incoming order is kept (stable).
 */
export function rankBySharedCollections(product: ShopProductPublic, items: ShopProductPublic[]): ShopProductPublic[] {
    const mine = new Set(product.collections);
    if (mine.size === 0) return items;
    return items
        .map((p, i) => ({ p, i, s: sharedCollections(p, mine) }))
        .sort((a, b) => b.s - a.s || inStockFirst(a.p, b.p) || a.i - b.i)
        .map((x) => x.p);
}

export type BridgeRow = { collection: string; groups: number; items: ShopProductPublic[] };

/**
 * One row per collection the product is in, holding that collection's items
 * from OTHER groups. Within a row: one item per group first (so a Gaming row
 * shows a monitor, a GPU and a headset before a second monitor), in-stock
 * first. Rows bridging the most groups come first; an item appears in one
 * row only, and never if it is already in `exclude` (the "More like this" rail).
 */
export function buildBridgeRows(
    product: ShopProductPublic,
    catalogue: ShopProductPublic[],
    exclude: Iterable<number> = [],
    { maxRows = BRIDGE_ROWS_MAX, perRow = BRIDGE_ROW_LIMIT } = {}
): BridgeRow[] {
    if (product.collections.length === 0) return [];
    const taken = new Set<number>([product.id, ...exclude]);

    const candidates = product.collections.map((collection) => {
        const byGroup = new Map<string, ShopProductPublic[]>();
        for (const p of catalogue) {
            if (p.id === product.id || p.groupId === product.groupId) continue;
            if (!p.collections.includes(collection)) continue;
            const key = String(p.groupId ?? p.category);
            byGroup.set(key, [...(byGroup.get(key) ?? []), p]);
        }
        for (const list of byGroup.values()) list.sort(inStockFirst);
        return { collection, byGroup };
    });

    // Widest bridge first; ties keep the product's own collection order.
    candidates.sort((a, b) => b.byGroup.size - a.byGroup.size);

    const rows: BridgeRow[] = [];
    for (const { collection, byGroup } of candidates) {
        if (rows.length >= maxRows) break;
        // Round-robin across groups: the first of each group, then the second…
        // Sibling groups (same parent — an IP Dome beside a 360 camera) are
        // alternatives more than add-ons, so they queue after the true bridges.
        const parent = product.categoryPath[0];
        const isSibling = (q: ShopProductPublic[]) => parent != null && q[0].categoryPath[0] === parent;
        const queues = [...byGroup.values()].sort(
            (a, b) => Number(isSibling(a)) - Number(isSibling(b)) || b.length - a.length
        );
        // Only siblings = the collection mirrors the product's own branch
        // ("Storage & Memory" on an SSD): no bridge, no row.
        if (queues.every(isSibling)) continue;
        const items: ShopProductPublic[] = [];
        for (let depth = 0; items.length < perRow; depth++) {
            let any = false;
            for (const q of queues) {
                if (depth >= q.length) continue;
                any = true;
                const p = q[depth];
                if (taken.has(p.id)) continue;
                items.push(p);
                if (items.length >= perRow) break;
            }
            if (!any) break;
        }
        if (items.length < BRIDGE_ROW_MIN) continue;
        for (const p of items) taken.add(p.id);
        rows.push({ collection, groups: byGroup.size, items });
    }
    return rows;
}
