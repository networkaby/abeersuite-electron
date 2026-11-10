import {
  productPath,
  type ShopProductPublic,
} from "@/shared/lib/shop/productPublic";

/**
 * The option buttons on a product page (owner, 2026-11-10 — like Amazon /
 * Flipkart): every product the customer can see that shares this one's variant
 * family, this one included and marked. Built from the cached storefront
 * catalogue, so a page reads nothing extra from the database; a hidden or
 * unpublished sibling is simply not in the catalogue. Fewer than two → none.
 */
export type VariantOption = {
  id: number;
  label: string;
  href: string;
  current: boolean;
  available: boolean;
};

export function buildVariantOptions(
  product: ShopProductPublic,
  catalogue: ShopProductPublic[],
  /** The customer app links to its own product route. */
  pathOf: (p: ShopProductPublic) => string = productPath,
): VariantOption[] {
  if (product.variantFamilyId == null) return [];
  const members = catalogue.filter(
    (p) => p.variantFamilyId === product.variantFamilyId,
  );
  if (!members.some((p) => p.id === product.id)) members.push(product);
  if (members.length < 2) return [];
  members.sort((a, b) => a.id - b.id);
  const auto = autoVariantLabels(members);
  return members.map((p, i) => ({
    id: p.id,
    // Typed label wins; else what tells this one apart; else the title.
    label: p.variantLabel?.trim() || auto[i] || p.displayName,
    href: pathOf(p),
    current: p.id === product.id,
    available: p.stockStatus !== "out_of_stock",
  }));
}

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

/** True when the family members do not all share the same value. */
function differs(values: (string | null | undefined)[]): boolean {
  return new Set(values.map(norm)).size > 1;
}

/**
 * The button text for members with no typed label (owner, 2026-11-10): what
 * actually differs between them, in this order — each attribute whose value
 * differs (in the order the first product lists its attributes, then any
 * others), the brand if brands differ, the group if groups differ. Only when
 * none of those differ, the words of the name that are not in every name.
 * An empty result means "use the title".
 */
export function autoVariantLabels(members: ShopProductPublic[]): string[] {
  const keys: string[] = [];
  for (const m of members)
    for (const k of Object.keys(m.attrs ?? {}))
      if (!keys.includes(k)) keys.push(k);
  const attrKeys = keys.filter((k) =>
    differs(members.map((m) => m.attrs?.[k])),
  );
  const useBrand = differs(members.map((m) => m.brand));
  const useGroup = differs(members.map((m) => m.groupName));

  if (attrKeys.length || useBrand || useGroup) {
    return members.map((m) =>
      [
        ...attrKeys.map((k) => m.attrs?.[k]),
        useBrand ? m.brand : null,
        useGroup ? m.groupName : null,
      ]
        .map((v) => (v ?? "").trim())
        .filter(Boolean)
        .join(" "),
    );
  }

  // Last resort: drop the words every name shares.
  const words = members.map((m) => m.displayName.split(/\s+/).filter(Boolean));
  const common = new Set(
    words[0]
      .map(norm)
      .filter((w) => words.every((ws) => ws.some((x) => norm(x) === w))),
  );
  return words.map((ws) => ws.filter((w) => !common.has(norm(w))).join(" "));
}
