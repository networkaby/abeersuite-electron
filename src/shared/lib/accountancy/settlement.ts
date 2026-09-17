// Phase 4 G4b — voucher settlement (tender + charge) INPUT, stored as
// `InvVoucher.settlementJson` (replaced the InvVoucherTender / InvVoucherCharge
// tables). This is re-rendered for edit and consumed by the GL builder on POST
// to emit role=TENDER / role=CHARGE VoucherGlLine rows; it is NEVER aggregated
// (money/reporting read the posted spine). One read/write helper pair so every
// caller treats the JSON uniformly.

import type { Prisma, PaymentMethod } from "@/generated/prisma/client";

/** One "Received In" tender row — a cash/bank/card/UPI/AR leg that settled the bill. */
export type TenderInput = {
    accountId: number;
    amount:    number;
    method?:   PaymentMethod | null;
    reference?: string | null;
};

/** One "+ Add Account" charge/income row (signed amount; sign encodes direction).
 *  `taxAmount` (optional) marks a TAX-BEARING charge — a service row whose
 *  `amount` is the NET value and whose GST posts on the voucher's tax legs
 *  (see buildInvVoucherGlLines). Plain charges leave it absent/0.
 *
 *  A SERVICE row (Settings → Services, picked with "Add service" on the POS cart
 *  or the office voucher) carries the extra fields below, so re-opening the
 *  voucher renders it back as the service line the operator typed instead of a
 *  bare ledger amount: `serviceId`, `serviceName`, the operator's own `note`,
 *  and `quantity` × `rate` (GST-EXCLUSIVE per unit) at `taxRate`.
 *
 *  Name and note are stored in their own right rather than parsed back out of
 *  `description`: that string is a printed LABEL ("Service: Fitting · urgent
 *  × 2"), and a service whose name happens to contain the separator would come
 *  back cut in half.
 *
 *  All of them are display / round-trip fields only. The GL still posts from
 *  `accountId` / `amount` / `taxAmount`, and the same ledger is credited on a
 *  sale and debited on a purchase (postInvVoucher picks the direction from the
 *  voucher type). Plain "+ Add Account" rows leave every one of them absent. */
export type ChargeInput = {
    accountId:   number;
    amount:      number;
    description?: string | null;
    taxAmount?:  number | null;
    serviceId?:   number | null;
    serviceName?: string | null;
    note?:        string | null;
    quantity?:    number | null;
    rate?:        number | null;
    taxRate?:     number | null;
};

export type Settlement = { tenders: TenderInput[]; charges: ChargeInput[] };

/** Parse `InvVoucher.settlementJson` into typed tender/charge arrays (empty when absent). */
export function readSettlement(json: Prisma.JsonValue | null | undefined): Settlement {
    if (!json || typeof json !== "object" || Array.isArray(json)) return { tenders: [], charges: [] };
    const o = json as Record<string, unknown>;
    const tenders = Array.isArray(o.tenders)
        ? (o.tenders as unknown[]).map((t) => {
            const r = t as Record<string, unknown>;
            return {
                accountId: Number(r.accountId),
                amount:    Number(r.amount),
                method:    (r.method ?? null) as PaymentMethod | null,
                reference: (r.reference ?? null) as string | null,
            };
        })
        : [];
    const charges = Array.isArray(o.charges)
        ? (o.charges as unknown[]).map((c) => {
            const r = c as Record<string, unknown>;
            return {
                accountId:   Number(r.accountId),
                amount:      Number(r.amount),
                description: (r.description ?? null) as string | null,
                taxAmount:   r.taxAmount != null ? Number(r.taxAmount) : null,
                serviceId:   r.serviceId != null ? Number(r.serviceId) : null,
                serviceName: (r.serviceName ?? null) as string | null,
                note:        (r.note ?? null) as string | null,
                quantity:    r.quantity  != null ? Number(r.quantity)  : null,
                rate:        r.rate      != null ? Number(r.rate)      : null,
                taxRate:     r.taxRate   != null ? Number(r.taxRate)   : null,
            };
        })
        : [];
    return { tenders, charges };
}

/** Build the `settlementJson` value to store on an InvVoucher. */
export function buildSettlementJson(
    tenders: TenderInput[],
    charges: ChargeInput[] = [],
): Prisma.InputJsonValue {
    return {
        tenders: tenders.map((t) => ({
            accountId: t.accountId,
            amount:    Number(t.amount),
            method:    t.method ?? null,
            reference: t.reference?.toString().trim() || null,
        })),
        charges: charges.map((c) => ({
            accountId:   c.accountId,
            amount:      Number(c.amount),
            description: c.description?.toString().trim() || null,
            taxAmount:   c.taxAmount != null && Number(c.taxAmount) !== 0 ? Number(c.taxAmount) : null,
            // Service identity + the qty × rate the operator typed. Written only
            // for service rows so a plain charge's JSON stays exactly as it was.
            serviceId:   c.serviceId != null ? Number(c.serviceId) : null,
            serviceName: c.serviceId != null ? (c.serviceName?.toString() ?? null) : null,
            note:        c.serviceId != null ? (c.note?.toString().trim() || null)  : null,
            quantity:    c.serviceId != null && c.quantity != null ? Number(c.quantity) : null,
            rate:        c.serviceId != null && c.rate     != null ? Number(c.rate)     : null,
            taxRate:     c.serviceId != null && c.taxRate  != null ? Number(c.taxRate)  : null,
        })),
    };
}
