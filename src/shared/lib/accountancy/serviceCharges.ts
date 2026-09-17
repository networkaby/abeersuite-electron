// Service lines → tax-bearing charge rows. ONE resolver for every voucher that
// can carry a service (POS sale, office trading vouchers, POS estimate/order),
// so the ledger, the GST and the printed description can never drift between
// the counter and the office.
//
// Server-only (reads the service catalogue through Prisma). The CLIENT never
// says which ledger or which GST rate a service uses — it sends the service id
// and the qty × rate it typed, and this re-resolves the rest from the database.
//
// Direction is not decided here. The charge row carries a POSITIVE amount and
// `postInvVoucher` picks the side from the voucher type — credited on a sale,
// debited on a purchase — which is why one ledger per service is enough for
// both sides of the trade.

import type { ChargeInput } from "@/shared/lib/accountancy/settlement";
import { round2 } from "@/shared/lib/format";

/** Voucher types that can carry a service line — the ones that move MONEY.
 *
 * A service is a charge, so it only belongs where a charge does: the trade
 * documents and the quotes that become them. The stock-only movements (GRN,
 * Challan, Rejection, Branch Transfer, Physical Stock, Manufacturing Journal)
 * are deliberately left out — they post no sale/purchase body for a service
 * charge to follow, so offering one there would only invite a bill nobody can
 * explain. POS is the counter's own SALE and is listed for the same reason. */
export const SERVICE_VOUCHER_TYPES = new Set([
    "SALE", "PURCHASE", "POS", "ONLINE_INVOICE",
    "SALE_RETURN", "PURCHASE_RETURN",
    "ESTIMATE", "POS_ESTIMATE",
    "SALES_ORDER", "PURCHASE_ORDER", "POS_ORDER",
]);

/** What a form sends for one service line. `unitPrice` is GST-EXCLUSIVE ₹. */
export type ServiceLineInput = {
    serviceId:    number;
    quantity:     number;
    unitPrice:    number;
    description?: string | null;
};

/** Minimal Prisma surface — works with the client or a transaction handle. */
type ServiceReader = {
    posService: {
        findMany(args: {
            where: { id: { in: number[] }; isActive: boolean };
            select: { id: true; name: true; accountId: true; gstRate: { select: { rate: true } } };
        }): Promise<{ id: number; name: string; accountId: number; gstRate: { rate: unknown } | null }[]>;
    };
};

export type ServiceChargeResult =
    | { ok: true;  charges: ChargeInput[] }
    | { ok: false; error: string; code: "POS_SERVICE_NOT_FOUND" };

/** The message every caller shows when a line points at a service that has been
 *  deleted or switched off since the screen loaded. */
export const SERVICE_NOT_FOUND =
    "A service on the bill no longer exists or is inactive. Remove it and retry.";

/** Thrown by callers that build a voucher inside a helper rather than a route,
 *  so the reason survives the trip out. Without it the cashier is told only
 *  "Failed to save order" for a service someone switched off an hour ago. */
export class ServiceLineError extends Error {
    readonly code = "POS_SERVICE_NOT_FOUND" as const;
    constructor(message = SERVICE_NOT_FOUND) {
        super(message);
        this.name = "ServiceLineError";
    }
}

/**
 * Turn service lines into charge rows (net `amount` + its `taxAmount`).
 *
 * The GST is rounded to the paisa, exactly as `calcLineTotals` rounds a product
 * line's — and for the same reason. Every screen that shows a service line
 * computes its tax through that helper and displays a 2dp figure, so a server
 * that kept the full float disagreed with the browser by up to half a paisa PER
 * LINE. Three service lines was enough to push the totals a full paisa apart and
 * have `tenderCoverageComplaint` refuse the save with "the payment rows come to
 * … but the voucher comes to …". Rounding here, once, is what makes the two
 * agree by construction. The GL engine still rounds every leg at the write
 * boundary; this only makes sure it is handed the same number the operator read.
 */
export async function resolveServiceCharges(
    db: ServiceReader,
    services: ServiceLineInput[],
): Promise<ServiceChargeResult> {
    if (services.length === 0) return { ok: true, charges: [] };

    const ids = [...new Set(services.map((s) => s.serviceId))];
    const rows = await db.posService.findMany({
        where:  { id: { in: ids }, isActive: true },
        select: { id: true, name: true, accountId: true, gstRate: { select: { rate: true } } },
    });
    const byId = new Map(rows.map((s) => [s.id, s]));
    if (services.some((s) => !byId.has(s.serviceId))) {
        return { ok: false, error: SERVICE_NOT_FOUND, code: "POS_SERVICE_NOT_FOUND" };
    }

    return {
        ok: true,
        charges: services.map((s) => {
            const svc = byId.get(s.serviceId)!;
            const taxRate = svc.gstRate ? Number(svc.gstRate.rate) : 0;
            const net = s.quantity * s.unitPrice;
            return {
                accountId:   svc.accountId,
                description: serviceChargeLabel(svc.name, s.description, s.quantity),
                amount:      net,
                taxAmount:   round2((net * taxRate) / 100),
                // Round-trip fields — see ChargeInput in settlement.ts.
                serviceId:   svc.id,
                serviceName: svc.name,
                note:        s.description?.toString().trim() || null,
                quantity:    s.quantity,
                rate:        s.unitPrice,
                taxRate,
            };
        }),
    };
}

/** The charge description a service posts under — one spelling for every
 *  document, because this string is what the invoice and the receipt print. */
export function serviceChargeLabel(
    name: string,
    description?: string | null,
    quantity = 1,
): string {
    const note = description?.toString().trim();
    return `Service: ${name}${note ? ` · ${note}` : ""}${quantity !== 1 ? ` × ${quantity}` : ""}`;
}

/** Signed sum a charge list adds to the bill. Tax-bearing rows (services) count
 *  at GROSS — net + their GST — because the GL splits the gross back into the
 *  charge leg and the voucher's tax legs.
 *
 *  Rounded PER ROW, like a voucher line, so this total is the sum of the row
 *  amounts the operator can actually see on the screen. */
export function chargesNetTotal(
    charges: { amount: number | string; taxAmount?: number | string | null }[],
): number {
    return charges.reduce((s, c) => s + round2(Number(c.amount) + Number(c.taxAmount ?? 0)), 0);
}
