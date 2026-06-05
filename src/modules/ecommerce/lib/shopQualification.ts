// Shop qualification — a product is eligible to appear in /shop only once it
// carries the minimum online content. Pure / framework-free so it runs on both
// the server (publish guard, public-API filter) and the client (live checklist
// in the product form). Slug is NOT a hard requirement — it is auto-generated on
// publish — so it is not part of the readiness gate.

export type ShopQualifiable = {
    pricePaise?: number | null;
    imageUrl?: string | null;
    galleryUrls?: string[] | null;
    description?: string | null;
};

export type ShopRequirement = { key: string; label: string };

export type ShopQualificationResult = {
    qualified: boolean;
    /** Labels of the requirements still unmet (empty when qualified). */
    missing: string[];
    /** Per-requirement pass/fail, for rendering a checklist. */
    checks: { key: string; label: string; ok: boolean }[];
};

const REQUIREMENTS: { key: string; label: string; ok: (p: ShopQualifiable) => boolean }[] = [
    {
        key: "image",
        label: "Product image",
        ok: (p) => Boolean(p.imageUrl) || (p.galleryUrls?.length ?? 0) > 0,
    },
    {
        key: "description",
        label: "Description",
        ok: (p) => Boolean(p.description && p.description.trim().length > 0),
    },
    {
        key: "price",
        label: "Sale price",
        ok: (p) => (p.pricePaise ?? 0) > 0,
    },
];

export function shopQualification(p: ShopQualifiable): ShopQualificationResult {
    const checks = REQUIREMENTS.map((r) => ({ key: r.key, label: r.label, ok: r.ok(p) }));
    const missing = checks.filter((c) => !c.ok).map((c) => c.label);
    return { qualified: missing.length === 0, missing, checks };
}

/**
 * URL-safe storefront handle derived from the product name (with the SKU
 * appended to keep handles distinct across same-named variants). Used to
 * auto-fill `slug` when a qualified product is published without one. Slug
 * uniqueness is still enforced by the DB `@unique` + the caller's conflict
 * handling.
 */
export function slugifyProduct(name: string, sku?: string | null): string {
    const norm = (s: string) =>
        s
            .toLowerCase()
            .normalize("NFKD")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    const base = norm(name);
    const tail = sku ? norm(sku) : "";
    const slug = [base, tail].filter(Boolean).join("-");
    return slug || tail || "product";
}
