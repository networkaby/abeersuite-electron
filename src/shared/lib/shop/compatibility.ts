import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";

/**
 * "Works with" — what fits what (owner, 2026-11-08: "someone buying a razor
 * should be recommended a blade; interested in a printer, show him ink for it;
 * interested in black ink, he has the printer — show the other colours").
 *
 * The knowledge is the product's own "Compatible Models" spec — the maker's
 * list, filled by Claude's /product-copy (each model checked on the maker's
 * page) or typed by staff. No new column: the spec already rides on every
 * cached storefront product, so a page reads nothing extra from the database.
 *
 * Three relations come out of it:
 *   - fits       — products we sell that this one fits (ink → the printers)
 *   - forThis    — products that fit THIS one (printer → its inks and heads)
 *   - sameFamily — products that fit the same models (black ink → the colours,
 *                  the head) — a customer with one of them has the printer
 *
 * A model matches a product only as a whole phrase in its name ("HP Smart Tank
 * 580" never matches "Smart Tank 5800"), with or without the brand word. Pure.
 */

/** The spec label that carries the list (also read: any label starting "Compatible"). */
export const COMPATIBLE_SPEC = "Compatible Models";

/** Lower case, words only, single spaces — so phrases compare whole-word. */
const phrase = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The models a product says it fits, as phrases ("hp smart tank 580"). */
export function compatibleModels(p: Pick<ShopProductPublic, "specs">): string[] {
    const raw = Object.entries(p.specs ?? {})
        .filter(([k]) => /^compatib/i.test(k.trim()))
        .map(([, v]) => v)
        .join(",");
    return [...new Set(raw.split(/[,;\n|]+/).map(phrase).filter(specific))];
}

/** Specific enough to match a name: a number in it ("mach3", "580"), or two words or more ("gillette fusion"). */
function specific(m: string): boolean {
    return m.length >= 3 && (/\d/.test(m) || m.split(" ").length >= 2);
}

/** Text the compatible models are looked for in — the shopper-facing name. */
const nameText = (p: Pick<ShopProductPublic, "displayName" | "name">) => ` ${phrase(`${p.displayName} ${p.name}`)} `;

/** Does this model phrase name this product? Whole phrase, brand word optional. */
function names(text: string, model: string): boolean {
    if (text.includes(` ${model} `)) return true;
    const rest = model.split(" ").slice(1).join(" ");
    // "hp smart tank 580" also matches a product called "Smart Tank 580 …" — but
    // only when what is left is still specific (never just "tank").
    return specific(rest) && text.includes(` ${rest} `);
}

export type CompatRows = {
    /** This product fits these (ink page → "Printers this fits"). */
    fits: ShopProductPublic[];
    /** These fit this product (printer page → "Inks and parts for this"). */
    forThis: ShopProductPublic[];
    /** Same models fitted (black ink → the colours and the head). */
    sameFamily: ShopProductPublic[];
};

/** The three rows for one product page, from the cached catalogue. Each product once, best row first. */
export function buildCompatRows(product: ShopProductPublic, catalogue: ShopProductPublic[], limit = 12): CompatRows {
    const mine = compatibleModels(product);
    const mineSet = new Set(mine);
    const myText = nameText(product);
    const used = new Set([product.id]);
    const take = (list: ShopProductPublic[]) => {
        const out = list.filter((p) => !used.has(p.id)).slice(0, limit);
        out.forEach((p) => used.add(p.id));
        return out;
    };
    const others = catalogue.filter((p) => p.id !== product.id);
    const withModels = others.map((p) => ({ p, models: compatibleModels(p) }));

    // Accessories for this product: their list names this one.
    const forThis = take(withModels.filter(({ models }) => models.some((m) => names(myText, m))).map(({ p }) => p));
    if (!mine.length) return { fits: [], forThis, sameFamily: [] };

    // What this one fits: products we sell that its list names (and that are not accessories themselves).
    const fits = take(withModels.filter(({ p, models }) => !models.length && mine.some((m) => names(nameText(p), m))).map(({ p }) => p));
    // Its family: fits at least one of the same models; more shared models first.
    const sameFamily = take(
        withModels
            .map(({ p, models }) => ({ p, shared: models.filter((m) => mineSet.has(m)).length }))
            .filter((x) => x.shared > 0)
            .sort((a, b) => b.shared - a.shared)
            .map((x) => x.p),
    );
    return { fits, forThis, sameFamily };
}
