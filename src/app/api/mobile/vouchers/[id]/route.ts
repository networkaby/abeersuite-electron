import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import { readPartyName } from "@/shared/lib/accountancy/partySnapshot";
import { readSettlement } from "@/shared/lib/accountancy/settlement";
import { readLineText } from "@/shared/lib/print/lineDescription";
import { voucherTypeLabel } from "@/shared/lib/format/voucherTypeLabel";
import { round2 } from "@/shared/lib/format/moneyInr";
import { VOUCHER_VIEW_PERMISSIONS } from "@/modules/mobile/lib/mobileAccess";
import { seesSuppliers } from "@/modules/mobile/lib/mobileScreens";
import { supplierAccountIds } from "@/modules/mobile/lib/supplierGuard";
import { booksUnchangedSince } from "@/modules/mobile/lib/booksUnchanged";
import { SUPPLIER_SIDE_TYPES } from "@/modules/accountancy/lib/tradingVoucherKinds";
import type { VoucherView } from "@/modules/mobile/lib/types";

// GET /api/mobile/vouchers/[id][?since=<computedAt>]
//
// One voucher (by its spine id) for the phone's voucher screen, opened from a
// party's Vouchers tab or the Day Book: what was sold (goods lines, services and
// charges), the bill figures, how it was paid, and the ledger legs — the only
// body a Receipt / Payment / Journal has. View only.
//
// Without "Show suppliers (creditors)" a purchase-side voucher, or one touching a
// Sundry Creditor's ledger, answers "not found" — the lists never show it either.
//
// `?since=`: `{ unchanged: true }` when nothing in the books moved, so re-opening
// a voucher costs one tiny reply (a POS sale can still be edited after the day).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireAnyPermission(...VOUCHER_VIEW_PERMISSIONS);
    if (response) return response;

    const id = Number((await params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    try {
        const now = new Date();
        if (await booksUnchangedSince(req.nextUrl.searchParams.get("since"), now)) {
            return NextResponse.json({ unchanged: true, computedAt: now.toISOString() });
        }

        const v = await prisma.universalVoucher.findUnique({
            where: { id },
            select: {
                id: true, type: true, voucherNo: true, date: true, status: true,
                description: true, narration: true, partyAccountId: true,
                sourceCreatedAt: true, createdAt: true, createdById: true,
                // The form's own order where the GL builder tagged it, else as written.
                lines: { orderBy: [{ seq: "asc" }, { id: "asc" }], select: { accountId: true, type: true, amount: true } },
                inventoryLines: {
                    orderBy: { id: "asc" },
                    select: {
                        description: true, note: true, quantity: true, freeQty: true, rate: true, amount: true,
                        product: { select: { sku: true, name: true } },
                    },
                },
                voucherDetail: {
                    select: {
                        partyJson: true, discountAmt: true, shippingAmt: true, shippingTaxAmt: true,
                        taxAmount: true, roundOff: true, totalAmount: true, settlementJson: true,
                    },
                },
            },
        });
        const notFound = NextResponse.json({ error: "Voucher not found" }, { status: 404 });
        if (!v) return notFound;

        const detail = v.voucherDetail;
        const settlement = readSettlement(detail?.settlementJson);
        const accountIds = [...new Set([
            ...v.lines.map((l) => l.accountId),
            ...settlement.tenders.map((t) => t.accountId),
            ...settlement.charges.map((c) => c.accountId),
            ...(v.partyAccountId != null ? [v.partyAccountId] : []),
        ])];

        if (!seesSuppliers(user.permissions)) {
            if (SUPPLIER_SIDE_TYPES.includes(v.type) || (await supplierAccountIds(accountIds)).size > 0) return notFound;
        }

        const [accounts, creator] = await Promise.all([
            prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } }),
            prisma.user.findUnique({ where: { id: v.createdById }, select: { name: true } }),
        ]);
        const accountName = new Map(accounts.map((a) => [a.id, a.name]));
        const nameOf = (accountId: number) => accountName.get(accountId) ?? `Ledger ${accountId}`;

        // GST inside the bill: the goods lines', the services', and shipping's.
        const chargesTax = settlement.charges.reduce((s, c) => s + Math.max(0, c.taxAmount ?? 0), 0);

        const body: VoucherView = {
            id: v.id,
            kind: voucherTypeLabel(v.type) ?? v.type,
            ref: v.voucherNo || formatUvNo(v.id),
            date: v.date.toISOString(),
            savedAt: (v.sourceCreatedAt ?? v.createdAt).toISOString(),
            by: creator?.name ?? null,
            status: v.status,
            party: (detail ? readPartyName(detail.partyJson) : null)
                ?? (v.partyAccountId != null ? nameOf(v.partyAccountId) : null),
            narration: v.narration?.trim() || v.description?.trim() || null,
            // Every figure GST-inclusive, as the customer paid it: the stored line
            // rate is pre-GST and pre-discount, so a piece's price is amount ÷ qty.
            items: v.inventoryLines.map((l) => {
                const text = readLineText(l, l.product);
                const qty = Number(l.quantity);
                const amount = Number(l.amount);
                return {
                    name: text.name,
                    note: text.note,
                    qty,
                    freeQty: Number(l.freeQty ?? 0),
                    rate: qty ? round2(amount / qty) : Number(l.rate),
                    amount,
                };
            }),
            // A service stores its NET amount and its GST apart — added back here.
            charges: settlement.charges.map((c) => {
                const amount = round2(c.amount + (c.taxAmount ?? 0));
                return {
                    name: c.serviceName ?? c.description ?? nameOf(c.accountId),
                    qty: c.quantity ?? null,
                    rate: c.quantity ? round2(amount / c.quantity) : null,
                    amount,
                };
            }),
            bill: detail ? {
                discount: Number(detail.discountAmt ?? 0),
                shipping: Number(detail.shippingAmt),
                tax: round2(Number(detail.taxAmount) + chargesTax + Number(detail.shippingTaxAmt)),
                roundOff: Number(detail.roundOff),
                total: Number(detail.totalAmount),
            } : null,
            paid: settlement.tenders
                .filter((t) => t.amount !== 0)
                .map((t) => ({ name: nameOf(t.accountId), amount: round2(t.amount) })),
            legs: v.lines.map((l) => ({ name: nameOf(l.accountId), side: l.type === "DEBIT" ? "Dr" as const : "Cr" as const, amount: Number(l.amount) })),
        };
        return NextResponse.json({ ...body, computedAt: now.toISOString() });
    } catch (e) {
        return handleApiError(e, "Could not load this voucher");
    }
}
