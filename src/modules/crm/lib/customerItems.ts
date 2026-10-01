import { prisma } from "@/shared/lib/prisma/prismaClient";
import { resolveAccountId, type CustomerRef } from "./customerTimeline";

/**
 * Reconnect — a customer's buying behaviour ("Items" tab).
 *
 * Aggregates every posted sale line for the customer, grouped by product, so the
 * caller can see what they normally buy and pitch something related (a printer
 * owner → push ink; a UPS owner → a battery). Warranty-end is derived per product
 * from its most recent purchase + the product's warranty-term duration.
 */

const SALE_TYPES = ["SALE", "POS", "ONLINE_INVOICE"] as const;
const DAY = 86_400_000;

export interface PurchasedItem {
    productId: number;
    name: string;
    category: string | null;
    /** Total units bought across all occasions. */
    qty: number;
    /** How many separate sale lines/occasions — a proxy for repeat/consumable buying. */
    times: number;
    lastBoughtAt: string;
    amountPaise: number;
    /** Latest purchase + product warranty duration; null when the product has no fixed term. */
    warrantyEndsAt: string | null;
}

export async function buildCustomerPurchaseProfile(ref: CustomerRef): Promise<{ items: PurchasedItem[] }> {
    const accountId = await resolveAccountId(ref);
    if (accountId == null) return { items: [] };

    const lines = await prisma.voucherInventoryLine.findMany({
        where: { universalVoucher: { partyAccountId: accountId, status: "POSTED", type: { in: [...SALE_TYPES] } } },
        select: {
            quantity: true,
            amount: true,
            universalVoucher: { select: { date: true } },
            product: {
                select: {
                    id: true, name: true,
                    category: { select: { name: true } },
                    warrantyTerm: { select: { durationDays: true } },
                },
            },
        },
    });

    type Agg = { productId: number; name: string; category: string | null; qty: number; times: number; last: number; amount: number; warrantyDays: number | null };
    const byProduct = new Map<number, Agg>();
    for (const l of lines) {
        const p = l.product;
        const t = l.universalVoucher.date.getTime();
        const cur = byProduct.get(p.id) ?? {
            productId: p.id, name: p.name, category: p.category?.name ?? null,
            qty: 0, times: 0, last: 0, amount: 0, warrantyDays: p.warrantyTerm?.durationDays ?? null,
        };
        cur.qty += Number(l.quantity);
        cur.times += 1;
        cur.amount += Number(l.amount);
        if (t > cur.last) cur.last = t;
        byProduct.set(p.id, cur);
    }

    const items: PurchasedItem[] = [...byProduct.values()]
        .map((a) => ({
            productId: a.productId,
            name: a.name,
            category: a.category,
            qty: a.qty,
            times: a.times,
            lastBoughtAt: new Date(a.last).toISOString(),
            amountPaise: Math.round(a.amount * 100),
            warrantyEndsAt: a.warrantyDays && a.warrantyDays > 0 ? new Date(a.last + a.warrantyDays * DAY).toISOString() : null,
        }))
        // Most-bought first — the "what they normally buy" signal.
        .sort((x, y) => y.times - x.times || y.qty - x.qty);

    return { items };
}
