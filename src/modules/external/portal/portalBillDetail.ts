import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { buildVoucherReceiptSample } from "@/modules/accountancy/lib/voucherReceiptSample";
import type { ThermalReceiptSample } from "@/shared/components/print/ThermalReceiptPreview";
import { ownedBill } from "./portalDocAccess";

/** One money row under the items — a charge, a tax leg, a payment. */
export interface BillDetailRow {
    label: string;
    amount: number;
}

/**
 * A bill opened in place in My Bills (tap a row): what the printed bill says,
 * as plain rows — items, then charges, tax, round-off, total, what was paid and
 * what is still due. Built from the same sample the A4 print renders, so the
 * two never disagree.
 */
export interface BillDetail {
    detailId: number;
    items: { name: string; note: string | null; qty: number; unit: string | null; rate: number | null; amount: number | null }[];
    /** Discount, service charges, shipping — signed (a discount is negative). */
    charges: BillDetailRow[];
    tax: BillDetailRow[];
    roundOff: number | null;
    total: number | null;
    paid: BillDetailRow[];
    balanceDue: number | null;
}

function toDetail(detailId: number, s: ThermalReceiptSample): BillDetail {
    const tb = s.taxBreakdown;
    const tax: BillDetailRow[] = tb
        ? tb.kind === "INTRA"
            ? [{ label: "CGST", amount: tb.cgst }, { label: "SGST", amount: tb.sgst }]
            : [{ label: "IGST", amount: tb.igst }]
        : s.taxAmount
          ? [{ label: "Tax", amount: s.taxAmount }]
          : [];
    return {
        detailId,
        items: s.lines.map((l) => ({
            name: l.description,
            note: l.note ?? null,
            qty: l.quantity,
            unit: l.unit ?? null,
            // Pre-tax when the bill carries GST rows (as the A4 table prints it), so
            // qty × rate = amount and the tax rows below add up to the total.
            rate: s.hidePrices || !l.quantity ? null : (l.taxable ?? l.amount) / l.quantity,
            amount: s.hidePrices ? null : (l.taxable ?? l.amount),
        })),
        charges: (s.charges ?? []).map((c) => ({ label: c.label, amount: c.amount })),
        tax: tax.filter((t) => Math.abs(t.amount) > 0.005),
        roundOff: s.roundOff ?? null,
        total: s.total,
        paid: (s.receipts ?? []).map((r) => ({ label: r.label, amount: r.amount })),
        balanceDue: s.balanceDue ?? null,
    };
}

// A minute, like My Bills itself (portalStatement.ts): tapping the same bill
// again, or a second bill and back, reads no database.
const cachedDetail = unstable_cache(
    async (detailId: number): Promise<BillDetail | null> => {
        const data = await buildVoucherReceiptSample("inv", detailId);
        return data ? toDetail(detailId, data.sample) : null;
    },
    ["portal:bill-detail"],
    { revalidate: 60 },
);

/** The bill behind a My Bills row (UniversalVoucher id), the customer's own only. */
export async function loadOwnedBillDetail(customerId: number, uvId: number): Promise<BillDetail | null> {
    const vd = await prisma.voucherDetail.findUnique({ where: { universalVoucherId: uvId }, select: { id: true } });
    if (!vd || !(await ownedBill(customerId, vd.id))) return null;
    return cachedDetail(vd.id);
}
