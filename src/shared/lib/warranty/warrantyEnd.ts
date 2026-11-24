// Warranty end dates, bill-wise and item-wise.
//
// A product's warranty runs from the date of the bill it was sold on (POS or
// Sale) for its warranty term's `durationDays`. Every bill line is its own
// warranty: the same product on two bills is two warranties with two end dates.
//
// Pure — no Prisma. Used by the POS customer snapshot ("Warranties ending
// soon" on the counter's customer panel).

/** One sold item, as read from a posted bill line. */
export type SoldItem = {
    productName: string;
    billNo: string | null;
    /** Bill date as stored (a @db.Date — midnight UTC). */
    billDate: Date;
    /** The product's warranty term in days; 0 / null = no fixed warranty. */
    durationDays: number | null;
};

export type WarrantyEnding = {
    /** Item name with its bill number, e.g. "HP Laptop 15s · POS-1042". */
    productName: string;
    billNo: string | null;
    billDate: string;   // yyyy-mm-dd
    endsOn: string;     // yyyy-mm-dd
    /** Display date, e.g. "12 Dec 2026". */
    endsAt: string;
    daysLeft: number;
};

const DAY_MS = 86_400_000;
const display = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

/** Calendar day (midnight UTC) of `d` in India — the shop's "today". */
export function indiaDay(d: Date): Date {
    const ist = new Date(d.getTime() + 330 * 60_000);
    return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

/** Last day of cover: bill date + durationDays. null = no fixed warranty. */
export function warrantyEndDate(billDate: Date, durationDays: number | null): Date | null {
    if (durationDays == null || durationDays <= 0) return null;
    const start = Date.UTC(billDate.getUTCFullYear(), billDate.getUTCMonth(), billDate.getUTCDate());
    return new Date(start + durationDays * DAY_MS);
}

/**
 * Warranties still running that end within `withinDays` of `today` (today
 * included), soonest first, at most `max`. One row per bill line.
 */
export function warrantiesEndingSoon(
    items: SoldItem[],
    now: Date,
    { withinDays = 90, max = 5 }: { withinDays?: number; max?: number } = {},
): WarrantyEnding[] {
    const today = indiaDay(now).getTime();
    const out: WarrantyEnding[] = [];
    for (const it of items) {
        const end = warrantyEndDate(it.billDate, it.durationDays);
        if (!end) continue;
        const daysLeft = Math.round((end.getTime() - today) / DAY_MS);
        if (daysLeft < 0 || daysLeft > withinDays) continue;
        out.push({
            productName: it.billNo ? `${it.productName} · ${it.billNo}` : it.productName,
            billNo: it.billNo,
            billDate: it.billDate.toISOString().slice(0, 10),
            endsOn: end.toISOString().slice(0, 10),
            endsAt: display.format(end),
            daysLeft,
        });
    }
    return out.sort((a, b) => a.daysLeft - b.daysLeft).slice(0, max);
}
