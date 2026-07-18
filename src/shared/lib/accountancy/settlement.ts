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
 *  `taxAmount` (optional) marks a TAX-BEARING charge — a POS-service row whose
 *  `amount` is the NET income and whose GST posts on the voucher's tax legs
 *  (see buildInvVoucherGlLines). Plain charges leave it absent/0. */
export type ChargeInput = {
    accountId:   number;
    amount:      number;
    description?: string | null;
    taxAmount?:  number | null;
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
        })),
    };
}
