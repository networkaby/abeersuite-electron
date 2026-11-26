// Warranty terms — labels, and the "Warranty" section a sale bill prints.
//
// A term says WHO honours the claim (warrantyType): the shop (SELLER), the brand
// (MANUFACTURER), the shop first then the brand (COMBINED, the shop's part in
// sellerDays) or NONE. The product name already carries the period
// ("(Warranty-2 Year)"), so the bill never repeats durations: it groups the
// items by type + condition and lists their line numbers. Only COMBINED prints
// its seller part, which the name does not show. The condition text per type
// lives on the print template; a term may add its own extraCondition.
//
// Pure — imported by the print routes, the POS screen and the master page.

export const WARRANTY_TYPES = ["SELLER", "MANUFACTURER", "COMBINED", "NONE"] as const;
export type WarrantyTypeValue = (typeof WARRANTY_TYPES)[number];

export const WARRANTY_TYPE_LABEL: Record<WarrantyTypeValue, string> = {
    SELLER:       "Seller",
    MANUFACTURER: "Manufacturer",
    COMBINED:     "Combined",
    NONE:         "No warranty",
};

export function isWarrantyType(v: unknown): v is WarrantyTypeValue {
    return typeof v === "string" && (WARRANTY_TYPES as readonly string[]).includes(v);
}

/**
 * A day count as "1y" / "6m" / "7d". Rounds to whole years or months when the
 * count is within a leap day per year (1096 → "3y") or a day per month
 * (183 → "6m"), so leap-year-counted terms don't print as raw days.
 */
export function formatWarrantyDays(days: number | null | undefined): string {
    if (days == null || days <= 0) return "—";
    const years = Math.round(days / 365);
    if (years >= 1 && Math.abs(days - years * 365) <= years) return `${years}y`;
    const months = Math.round(days / 30);
    if (months >= 1 && Math.abs(days - months * 30) <= months * 1.5) return `${months}m`;
    return `${days}d`;
}

/** "1 year" / "6 months" / "10 days" — the long form printed on a bill. */
export function formatWarrantyDaysLong(days: number | null | undefined): string {
    const short = formatWarrantyDays(days);
    const n = parseInt(short, 10);
    if (!Number.isFinite(n)) return "";
    const unit = short.endsWith("y") ? "year" : short.endsWith("m") ? "month" : "day";
    return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

export type WarrantyTermLike = {
    name?: string | null;
    durationDays: number | null;
    warrantyType?: WarrantyTypeValue | string | null;
    sellerDays?: number | null;
    extraCondition?: string | null;
};

const typeOf = (t: WarrantyTermLike): WarrantyTypeValue =>
    isWarrantyType(t.warrantyType) ? t.warrantyType : "SELLER";

/**
 * Short label for screens: "1y seller", "2y mfr", "1y seller + 2y mfr",
 * "No warranty". Falls back to the term name when it has no duration.
 */
export function warrantyTermLabel(t: WarrantyTermLike): string {
    const type = typeOf(t);
    if (type === "NONE") return "No warranty";
    const total = t.durationDays && t.durationDays > 0 ? formatWarrantyDays(t.durationDays) : null;
    if (type === "COMBINED") {
        const seller = t.sellerDays && t.sellerDays > 0 ? formatWarrantyDays(t.sellerDays) : null;
        if (seller && total) return `${seller} seller + ${total} mfr`;
    }
    if (!total) return t.name?.trim() || WARRANTY_TYPE_LABEL[type];
    return `${total} ${type === "MANUFACTURER" ? "mfr" : type === "COMBINED" ? "seller + mfr" : "seller"}`;
}

/** The template's standard condition per type (VoucherPrintTemplate.warranty*Text). */
export type WarrantyTexts = {
    warrantySellerText?: string | null;
    warrantyManufacturerText?: string | null;
    warrantyCombinedText?: string | null;
    warrantyNoneText?: string | null;
};

/** One printed row of the bill's Warranty section. */
export type WarrantyGroup = {
    /** 1-based line numbers as printed on the bill. */
    items: number[];
    /** "Manufacturer warranty", "Seller warranty for the first 1 year, then manufacturer", "No warranty". */
    label: string;
    /** Template text for the type, then the term's own extra condition. May be "". */
    condition: string;
};

function groupLabel(t: WarrantyTermLike): string {
    switch (typeOf(t)) {
        case "MANUFACTURER": return "Manufacturer warranty";
        case "NONE":         return "No warranty";
        case "COMBINED": {
            const seller = formatWarrantyDaysLong(t.sellerDays);
            return seller ? `Seller warranty for the first ${seller}, then manufacturer` : "Seller warranty, then manufacturer";
        }
        default:             return "Seller warranty";
    }
}

function typeText(type: WarrantyTypeValue, texts: WarrantyTexts): string {
    const raw = type === "MANUFACTURER" ? texts.warrantyManufacturerText
        : type === "COMBINED" ? texts.warrantyCombinedText
        : type === "NONE" ? texts.warrantyNoneText
        : texts.warrantySellerText;
    return (raw ?? "").trim();
}

/**
 * Group a bill's lines by warranty type + condition, in order of first
 * appearance. `terms[i]` is line i's frozen term (null = no term on the line —
 * older bills, or a product without one — and the line is skipped). Returns []
 * when no line carries a term, so the section does not print at all.
 */
export function buildWarrantyGroups(
    terms: readonly (WarrantyTermLike | null | undefined)[],
    texts: WarrantyTexts,
): WarrantyGroup[] {
    const groups = new Map<string, WarrantyGroup>();
    terms.forEach((t, i) => {
        if (!t) return;
        const label = groupLabel(t);
        const condition = [typeText(typeOf(t), texts), (t.extraCondition ?? "").trim()].filter(Boolean).join(" ");
        const key = `${label}\u0000${condition}`;
        const g = groups.get(key);
        if (g) g.items.push(i + 1);
        else groups.set(key, { items: [i + 1], label, condition });
    });
    return [...groups.values()];
}

/** "Item 2" / "Items 1, 3, 4" — the group's lead-in on the bill. */
export function warrantyItemsLabel(items: readonly number[]): string {
    return `${items.length === 1 ? "Item" : "Items"} ${items.join(", ")}`;
}

/**
 * The days a term keeps for its type — the one rule the master screen and the
 * API both apply. NONE keeps no days; only COMBINED keeps sellerDays, which
 * must be shorter than the total. Returns the error to show, or the clean shape.
 */
export function checkWarrantyShape(t: {
    warrantyType: WarrantyTypeValue;
    durationDays: number | null;
    sellerDays: number | null;
}): { error: string } | { value: { warrantyType: WarrantyTypeValue; durationDays: number | null; sellerDays: number | null } } {
    const { warrantyType } = t;
    if (warrantyType === "NONE") return { value: { warrantyType, durationDays: null, sellerDays: null } };
    const total = t.durationDays && t.durationDays > 0 ? t.durationDays : null;
    if (warrantyType !== "COMBINED") return { value: { warrantyType, durationDays: total, sellerDays: null } };
    const seller = t.sellerDays && t.sellerDays > 0 ? t.sellerDays : null;
    if (!seller || !total) return { error: "A combined warranty needs both the seller period and the total period." };
    if (seller >= total) return { error: "The seller period must be shorter than the total period." };
    return { value: { warrantyType, durationDays: total, sellerDays: seller } };
}

/** True when two terms differ in what a printed bill shows (locked once used). */
export function warrantyPrintChanged(
    a: { warrantyType: string; durationDays: number | null; sellerDays: number | null; extraCondition: string | null },
    b: { warrantyType: string; durationDays: number | null; sellerDays: number | null; extraCondition: string | null },
): boolean {
    return a.warrantyType !== b.warrantyType
        || (a.durationDays ?? null) !== (b.durationDays ?? null)
        || (a.sellerDays ?? null) !== (b.sellerDays ?? null)
        || (a.extraCondition?.trim() || null) !== (b.extraCondition?.trim() || null);
}
