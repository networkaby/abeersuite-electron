import { productMatchesSearch } from "@/shared/lib/inventory/productSearch";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";

/**
 * The storefront's search and filter rules — one copy for the website catalog
 * (ShopCatalogClient) and the customer app's product list, so a search finds the
 * same products in both.
 */

export type PriceBand = { id: string; label: string; minPaise: number; maxPaise: number | null };

function norm(s: string) {
    return s.toLowerCase().trim();
}

/**
 * What a shopper may search — name, description, category. Deliberately built
 * here rather than taken from the office helper: the office one also matches
 * SKU, barcodes and internal attributes. `ShopProductPublic` carries none of
 * those (see productPublic.ts), and this keeps it that way on purpose.
 */
type Searchable = Pick<ShopProductPublic, "displayName" | "description" | "category">;

function shopSearchText(p: Searchable) {
    return norm(`${p.displayName} ${p.description ?? ""} ${p.category}`);
}

/**
 * The same tiered matcher the counter uses, over public fields only.
 *
 * The old test was ONE literal substring, so a shopper had to type a
 * contiguous fragment of the actual title: "copier paper a4" found 4 products
 * where 28 are relevant, and "a4paper" found none at all. Tokenised matching
 * fixes the first, the run-together rescue the second.
 *
 * Still a predicate, not a ranking: it feeds the facet counts (matchesExcept)
 * as much as the list, and the shopper's own Sort control owns the order.
 * No fuzzy or guess passes either — on a storefront, showing things the
 * shopper did not ask for reads as broken, not as helpful.
 */
export function matchesQuery(p: Searchable, q: string) {
    return productMatchesSearch(p, q, { text: shopSearchText });
}

export function discountPct(p: ShopProductPublic) {
    if (!p.mrpPaise || p.mrpPaise <= p.pricePaise) return 0;
    return Math.round((1 - p.pricePaise / p.mrpPaise) * 100);
}

/** Round up to the nearest 1 / 2 / 5 × 10ⁿ so band edges read as round rupees. */
function niceStep(raw: number) {
    if (raw <= 0) return 1;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const unit = raw / mag;
    const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10;
    return nice * mag;
}

/** Price brackets derived from the real catalog spread, not hardcoded slabs. */
export function buildPriceBands(products: ShopProductPublic[]): PriceBand[] {
    if (products.length === 0) return [];
    const prices = products.map((p) => p.pricePaise);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    if (max <= min) return [];
    const step = niceStep((max - min) / 4);
    const start = Math.floor(min / step) * step;
    const bands: PriceBand[] = [];
    for (let edge = start; edge < max && bands.length < 5; edge += step) {
        const isLast = bands.length === 4 || edge + step >= max;
        bands.push({
            id: `p${edge}`,
            label: isLast
                ? `${formatRupeesFromPaise(edge)} & above`
                : `${formatRupeesFromPaise(edge)} – ${formatRupeesFromPaise(edge + step)}`,
            minPaise: edge,
            maxPaise: isLast ? null : edge + step,
        });
        if (isLast) break;
    }
    return bands;
}

export const DISCOUNT_OPTIONS = [10, 20, 30, 50];
