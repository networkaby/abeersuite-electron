import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { invNextRef, calcLineTotals, calcVoucherTotals } from "@/modules/inventory/lib/stock";
import { InvVoucherType } from "@/generated/prisma/client";
import { resolveActiveBranchId, requireBranchAccess, BranchAccessError } from "@/shared/lib/auth/activeBranch";
import { auth } from "@/auth";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// GET /api/inventory/vouchers?type=PURCHASE|SALE&status=DRAFT|POSTED|CANCELLED&branchId=BR-HQ|all&includeDeleted=1
export async function GET(req: NextRequest) {
    const { response, user } = await requireAuth();
    if (response) return response;

    const session = await auth();
    const { searchParams } = new URL(req.url);
    const type   = searchParams.get("type")   as InvVoucherType | null;
    const status = searchParams.get("status") as "DRAFT" | "POSTED" | "CANCELLED" | null;
    const branchParam = searchParams.get("branchId");
    // includeDeleted is opt-in and gated on the delete permission so casual
    // viewers don't see soft-deleted rows. The All Vouchers register passes
    // includeDeleted=1 when the user ticks the "Deleted" status filter.
    const includeDeletedParam = searchParams.get("includeDeleted") === "1";
    const canSeeDeleted =
        !!user
        && (user.permissions.includes(PERMISSIONS.ADMIN_BYPASS)
            || user.permissions.includes(PERMISSIONS.INVENTORY_VOUCHER_DELETE));
    const includeDeleted = includeDeletedParam && canSeeDeleted;

    let branchFilter: { branchId?: string } = {};
    if (branchParam === "all") {
        // No branch filter — admin / org-scope only (enforced at perm layer later).
    } else if (branchParam) {
        try { requireBranchAccess(session, branchParam); } catch (e) {
            if (e instanceof BranchAccessError) return NextResponse.json({ error: e.message }, { status: 403 });
            throw e;
        }
        branchFilter = { branchId: branchParam };
    } else {
        try { branchFilter = { branchId: resolveActiveBranchId(req, session) }; } catch (e) {
            if (e instanceof BranchAccessError) return NextResponse.json({ error: e.message }, { status: 400 });
            throw e;
        }
    }

    const vouchers = await prisma.invVoucher.findMany({
        where: {
            ...(type   ? { type }   : {}),
            ...(status ? { status } : {}),
            ...(includeDeleted ? {} : { deletedAt: null }),
            ...branchFilter,
        },
        orderBy: [{ date: "desc" }, { id: "desc" }],
        include: {
            createdBy: { select: { name: true } },
            branch:    { select: { id: true, name: true } },
            _count:    { select: { lines: true } },
        },
    });

    return NextResponse.json(vouchers);
}

// POST /api/inventory/vouchers
export async function POST(req: NextRequest) {
    const { response, user } = await requireAuth();
    if (response) return response;

    const session = await auth();
    const body = await req.json();
    const {
        type,
        date,
        description,
        branchId: bodyBranchId,
        partyName,
        partyType,
        partyId,
        partyPhone,
        partyAddress,
        paymentMode,
        paymentAccountId,
        creditPeriodDays,
        refNumber,
        refDate,
        refVoucherId,
        bomId,
        destinationBranchId,
        shippingAmt    = 0,
        roundOff       = 0,
        amountReceived = 0,
        discountPct,
        discountAmt,
        showPrices,
        lines = [],
        expenseLines = [],
    } = body as {
        type:         InvVoucherType;
        date:         string;
        description:  string;
        branchId?:    string;
        partyName?:   string;
        partyType?:   string;
        partyId?:     number;
        partyPhone?:  string;
        partyAddress?: string;
        paymentMode?:    string;
        /// Cash / bank Account that received the money — drives postInvVoucher's
        /// cash-leg ledger selection. Null falls back to the name-based lookup.
        paymentAccountId?: number;
        /// Number of days from voucher date until payment is due (CREDIT mode only).
        creditPeriodDays?: number;
        /// Supplier-issued bill number on PURCHASE; original invoice / bill
        /// number on SALE_RETURN / PURCHASE_RETURN.
        refNumber?:      string;
        /// Date of the referenced source bill / invoice (ISO yyyy-mm-dd).
        refDate?:        string;
        /// Optional FK to the source InvVoucher being returned against.
        refVoucherId?:   number;
        /// MANUFACTURING_JOURNAL only — optional FK to InvBom this voucher was generated from.
        bomId?:          number;
        /// BRANCH_TRANSFER only — destination branch (source is `branchId`).
        destinationBranchId?: string;
        shippingAmt?:    number;
        roundOff?:       number;
        amountReceived?: number;
        /// Voucher-level discount (mutually-convertible with discountAmt)
        discountPct?:    number;
        discountAmt?:    number;
        // Challan-only: when false the printed challan hides rate/amount columns.
        showPrices?:     boolean;
        lines: {
            productId:   number;
            description?: string;
            quantity:    number;
            /// Free / complimentary qty — flows out of stock, ₹0 revenue
            freeQty?:    number;
            /// Optional for PHYSICAL_STOCK / MANUFACTURING_JOURNAL — defaults to 0
            rate?:       number;
            /// MRP in paise — stored on the line; used to update InvProduct.mrpPaise on post.
            mrpPaise?:   number;
            discountPct?: number;
            discountAmt?: number;
            taxRate?:    number;
            /// "CONSUME" | "PRODUCE" — required for MANUFACTURING_JOURNAL lines.
            direction?:  "CONSUME" | "PRODUCE";
        }[];
        /// MANUFACTURING_JOURNAL Charges — expense allocation rows.
        expenseLines?: {
            accountId:    number;
            description?: string;
            amount:       number;
        }[];
    };

    if (!type || !date || !description?.trim()) {
        return NextResponse.json({ error: "type, date, description required" }, { status: 400 });
    }

    const isPhysicalStock = type === "PHYSICAL_STOCK";
    const isManufacturingJournal = type === "MANUFACTURING_JOURNAL";
    const isBranchTransfer = type === "BRANCH_TRANSFER";

    if (isBranchTransfer) {
        if (!destinationBranchId) {
            return NextResponse.json({ error: "Branch Transfer needs a destination branch" }, { status: 400 });
        }
    }

    // Manufacturing Journal is allowed to have zero stock lines IF it has at
    // least one expense (Charges) line — covers pure-overhead allocations.
    // Every other type requires at least one line.
    if (!lines.length && !(isManufacturingJournal && expenseLines.length > 0)) {
        return NextResponse.json({ error: "At least one line item required" }, { status: 400 });
    }

    let branchId: string;
    try {
        branchId = bodyBranchId
            ? (requireBranchAccess(session, bodyBranchId), bodyBranchId)
            : resolveActiveBranchId(req, session);
    } catch (e) {
        if (e instanceof BranchAccessError) {
            return NextResponse.json({ error: e.message }, { status: e.code === "forbidden_branch" ? 403 : 400 });
        }
        throw e;
    }
    if (isBranchTransfer && destinationBranchId === branchId) {
        return NextResponse.json({ error: "Source and destination branches must differ." }, { status: 400 });
    }
    for (const l of lines) {
        if (!l.productId || l.quantity <= 0) {
            return NextResponse.json({ error: "Each line needs a product and quantity > 0" }, { status: 400 });
        }
        if (isManufacturingJournal && l.direction !== "CONSUME" && l.direction !== "PRODUCE") {
            return NextResponse.json({ error: "Manufacturing Journal lines need a direction (CONSUME or PRODUCE)" }, { status: 400 });
        }
    }

    if (isManufacturingJournal && expenseLines.length > 0 && !paymentAccountId) {
        return NextResponse.json({ error: "Manufacturing Journal Charges require a payment account" }, { status: 400 });
    }
    for (const e of expenseLines) {
        if (!e.accountId || !(e.amount > 0)) {
            return NextResponse.json({ error: "Each charge line needs an expense account and amount > 0" }, { status: 400 });
        }
    }

    // Compute line totals.
    //  • Physical Stock is purely qty-based — no rate / no amount.
    //  • Manufacturing Journal carries a per-line rate (seeded from each
    //    product's cost basis) so consumption + production show their
    //    rupee value and the operator can see probable P/L. No tax /
    //    discount on these lines — amount = qty × rate.
    //  • Trading vouchers go through the full calcLineTotals path.
    const computedLines = lines.map((l) => {
        const rate = l.rate ?? 0;
        if (isPhysicalStock || isBranchTransfer) {
            return { ...l, rate: 0, discountAmt: 0, taxAmount: 0, amount: 0 };
        }
        if (isManufacturingJournal) {
            return { ...l, rate, discountAmt: 0, taxAmount: 0, amount: l.quantity * rate };
        }
        const { discountAmt, taxAmount, amount } = calcLineTotals({
            quantity:    l.quantity,
            rate,
            discountPct: l.discountPct ?? 0,
            discountAmt: l.discountAmt ?? 0,
            taxRate:     l.taxRate    ?? 0,
        });
        return { ...l, rate, discountAmt, taxAmount, amount };
    });

    // Resolve voucher-level discount. Either pct or amt may be supplied; the
    // amount wins when both are present (UI keeps them in sync).
    const lineSubtotal = computedLines.reduce((s, l) => s + l.amount, 0);
    const overallDiscount =
        discountAmt != null && Number(discountAmt) > 0
            ? Number(discountAmt)
            : discountPct != null && Number(discountPct) > 0
                ? (lineSubtotal * Number(discountPct)) / 100
                : 0;

    const { subtotal, taxAmount, totalAmount } = calcVoucherTotals(
        computedLines,
        Number(shippingAmt),
        overallDiscount,
        Number(roundOff),
    );

    const userId = user!.id;

    const voucher = await prisma.$transaction(async (tx) => {
        const reference = await invNextRef(tx, type);
        return tx.invVoucher.create({
            data: {
                type,
                reference,
                branchId,
                date:         new Date(date),
                description:  description.trim(),
                partyName:    partyName  || null,
                partyType:    partyType  || null,
                partyId:      partyId    || null,
                partyPhone:   partyPhone || null,
                partyAddress: partyAddress || null,
                paymentMode:     paymentMode || null,
                paymentAccountId: paymentAccountId ?? null,
                creditPeriodDays: creditPeriodDays ?? null,
                refNumber:       refNumber || null,
                refDate:         refDate ? new Date(refDate) : null,
                refVoucherId:    refVoucherId ?? null,
                bomId:           isManufacturingJournal && bomId ? bomId : null,
                destinationBranchId: isBranchTransfer ? destinationBranchId ?? null : null,
                shippingAmt,
                roundOff,
                amountReceived,
                discountPct: discountPct != null ? Number(discountPct) : null,
                discountAmt: overallDiscount > 0 ? overallDiscount : null,
                ...(typeof showPrices === "boolean" ? { showPrices } : {}),
                subtotal,
                taxAmount,
                totalAmount,
                createdById: userId,
                lines: {
                    create: computedLines.map((l) => ({
                        productId:   l.productId,
                        description: l.description || null,
                        direction:   isManufacturingJournal ? l.direction ?? null : null,
                        quantity:    l.quantity,
                        freeQty:     l.freeQty != null && l.freeQty > 0 ? l.freeQty : null,
                        rate:        l.rate,
                        mrpPaise:    l.mrpPaise ?? null,
                        discountPct: l.discountPct ?? 0,
                        discountAmt: l.discountAmt,
                        taxRate:     l.taxRate    ?? 0,
                        taxAmount:   l.taxAmount,
                        amount:      l.amount,
                    })),
                },
                ...(isManufacturingJournal && expenseLines.length > 0 ? {
                    expenseLines: {
                        create: expenseLines.map((e) => ({
                            accountId:   e.accountId,
                            description: e.description?.trim() || null,
                            amount:      e.amount,
                        })),
                    },
                } : {}),
            },
            include: {
                lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
                createdBy: { select: { name: true } },
            },
        });
    });

    return NextResponse.json(voucher, { status: 201 });
}
