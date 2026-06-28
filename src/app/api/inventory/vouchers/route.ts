import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { invNextRef, calcLineTotals, calcVoucherTotals } from "@/modules/inventory/lib/stock";
import { InvVoucherType, Prisma, type InvVoucherDeliveryMode } from "@/generated/prisma/client";
import { buildPartyJson, readPartyName, readPartyPhone, readPartyAddress } from "@/shared/lib/accountancy/partySnapshot";
import { buildSettlementJson } from "@/shared/lib/accountancy/settlement";
import { engineCreateSpine } from "@/modules/accountancy/lib/transactionEngine";
import { syncVoucherLinks } from "@/modules/accountancy/lib/voucherLinks";
import { resolveActiveBranchId, requireBranchAccess, BranchAccessError } from "@/shared/lib/auth/activeBranch";
import { auth } from "@/auth";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { resolveBuyerStateCode } from "@/shared/lib/gst/resolveBuyerState";
import { isValidStateCode } from "@/shared/lib/gst/indianStates";
import { getOrderPipeline, orderEntryStatus } from "@/modules/order/lib/orderPipeline";

// GET /api/inventory/vouchers?type=PURCHASE|SALE&status=DRAFT|POSTED|CANCELLED&branchId=BR-HQ|all&includeDeleted=1
//
// Branch handling:
//   • No `branchId` param → org-wide (no branch filter). Reports default here.
//   • `branchId=all`      → org-wide (kept for explicit callers).
//   • `branchId=<id>`     → branch-scoped, with access check.
// Write paths that want branch-scoping pass `branchId` explicitly. The top-bar
// active-branch cookie is no longer consulted by this GET — top bar represents
// the working branch for writes; reports default to org-wide.
export async function GET(req: NextRequest) {
    const { response, user } = await requireAuth();
    if (response) return response;

    const session = await auth();
    const { searchParams } = new URL(req.url);
    const typeParam = searchParams.get("type");                                       // single value, OR
    const typesParam = searchParams.get("types");                                     // comma-separated list (POS,SALE)
    const status = searchParams.get("status") as "DRAFT" | "POSTED" | "CANCELLED" | null;
    const branchParam = searchParams.get("branchId");
    const accountIdParam = searchParams.get("accountId");
    const ticketIdParam = searchParams.get("ticketId");
    const shopOrderIdParam = searchParams.get("shopOrderId");

    // Normalise the type filter — accept either ?type=SALE or ?types=SALE,POS.
    const ALLOWED_TYPES = new Set<InvVoucherType>([
        "PURCHASE", "SALE", "POS", "ESTIMATE", "POS_ESTIMATE", "POS_ORDER",
        "SALE_RETURN", "PURCHASE_RETURN",
        "MANUFACTURING_JOURNAL", "PHYSICAL_STOCK", "BRANCH_TRANSFER",
        "GRN", "CHALLAN", "REJECTION_IN", "REJECTION_OUT",
        "SALES_ORDER", "PURCHASE_ORDER",
    ]);
    const typeList: InvVoucherType[] = [];
    if (typesParam) {
        for (const t of typesParam.split(",").map((s) => s.trim())) {
            if (ALLOWED_TYPES.has(t as InvVoucherType)) typeList.push(t as InvVoucherType);
        }
    } else if (typeParam && ALLOWED_TYPES.has(typeParam as InvVoucherType)) {
        typeList.push(typeParam as InvVoucherType);
    }
    // includeDeleted is opt-in and gated on the delete permission so casual
    // viewers don't see soft-deleted rows. The All Vouchers register passes
    // includeDeleted=1 when the user ticks the "Deleted" status filter.
    const includeDeletedParam = searchParams.get("includeDeleted") === "1";
    const canSeeDeleted =
        !!user
        && (user.permissions.includes(PERMISSIONS.ADMIN_BYPASS)
            || user.permissions.includes(PERMISSIONS.INVENTORY_VOUCHER_DELETE));
    const includeDeleted = includeDeletedParam && canSeeDeleted;

    let branchScopeId: string | undefined;
    if (branchParam === "all" || !branchParam) {
        // No branch filter — org-wide. Reports land here by omitting the param.
    } else {
        try { requireBranchAccess(session, branchParam); } catch (e) {
            if (e instanceof BranchAccessError) return NextResponse.json({ error: e.message }, { status: 403 });
            throw e;
        }
        branchScopeId = branchParam;
    }

    // 5D-4/8/10/11/12: type/status/deletedAt/party/branch all live on the spine.
    // (Typed so future drift is caught — the prior untyped literal silently kept
    // dropped columns via conditional spreads.)
    const spineFilter: Prisma.UniversalVoucherWhereInput = {
        ...(typeList.length > 0 ? { type: { in: typeList } } : {}),
        ...(status ? { status } : {}),
        ...(includeDeleted ? {} : { deletedAt: null }),
        ...(accountIdParam ? { partyAccountId: Number(accountIdParam) } : {}),
        ...(branchScopeId ? { branchId: branchScopeId } : {}),
    };
    const vouchers = await prisma.voucherDetail.findMany({
        where: {
            universalVoucher: spineFilter,
            ...(ticketIdParam    ? { ticketId:    Number(ticketIdParam) }    : {}),
            ...(shopOrderIdParam ? { shopOrderId: Number(shopOrderIdParam) } : {}),
        },
        orderBy: [{ universalVoucher: { date: "desc" } }, { id: "desc" }],   // 5D-10: date on spine
        include: {
            // 5D-2 creator + 5D-6 ref + 5D-10 date + 5D-12 branch live on the spine.
            universalVoucher: { select: { createdById: true, voucherNo: true, date: true, type: true, branch: { select: { id: true, name: true } } } },   // +5D-11 type +5D-12 branch
            // refReturns = vouchers that reference THIS one via refVoucherId. For a
            // POS_ORDER / POS_ESTIMATE it means a sale was raised against it →
            // "converted" (not pending). (For SALE etc. it's the returns count.)
            // Phase 5 5C: goods lines hang off the spine, not InvVoucher.
            _count:    { select: { refReturns: true } },
        },
    });

    // Resolve partyAccountId per row so the Day Book / register tables can
    // link the Party cell to /office/customers/<accountId>. InvVoucher only
    // stores `partyId` (a Person id), so we bulk-fetch the matching Accounts
    // in one query and attach the id back.
    const partyIds = [...new Set(
        vouchers.map((v) => v.partyId).filter((id): id is number => id != null),
    )];
    const partyAccounts = partyIds.length > 0
        ? await prisma.account.findMany({
            where: {
                OR: [
                    { personId:  { in: partyIds } },
                    { companyId: { in: partyIds } },
                ],
            },
            select: { id: true, personId: true, companyId: true },
        })
        : [];
    const personToAccount  = new Map<number, number>();
    const companyToAccount = new Map<number, number>();
    for (const a of partyAccounts) {
        if (a.personId  != null) personToAccount.set(a.personId,  a.id);
        if (a.companyId != null) companyToAccount.set(a.companyId, a.id);
    }
    // 5D-2: resolve creator names from each row's spine (createdById on the spine).
    const creatorIds = [...new Set(vouchers.map((v) => v.universalVoucher?.createdById).filter((x): x is number => x != null))];
    const creatorById = new Map(
        (creatorIds.length === 0 ? [] : await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } }))
            .map((u) => [u.id, u.name]),
    );
    const creatorName = (v: { universalVoucher: { createdById: number } | null }) =>
        v.universalVoucher?.createdById != null ? { name: creatorById.get(v.universalVoucher.createdById) ?? null } : null;
    const enriched = vouchers.map((v) => {
        // Derived party display fields from the frozen snapshot so list/register
        // clients keep reading `partyName` / `partyPhone` unchanged.
        const partyDisplay = { partyName: readPartyName(v.partyJson), partyPhone: readPartyPhone(v.partyJson), partyAddress: readPartyAddress(v.partyJson) };
        if (v.partyId == null) {
            return { ...v, type: v.universalVoucher?.type, branch: v.universalVoucher?.branch ?? null, date: v.universalVoucher?.date, reference: v.universalVoucher?.voucherNo ?? "", ...partyDisplay, createdBy: creatorName(v), partyAccountId: null, partyPersonId: null, partyCompanyId: null };
        }
        // Same partyId may resolve as either a Person or a Company id depending
        // on which lookup matches. Person wins when both are set (shouldn't
        // happen in practice — Person.id and Company.id are independent
        // sequences, so a collision is possible but the row's partyType
        // disambiguates at write time).
        const accFromPerson  = personToAccount.get(v.partyId);
        const accFromCompany = companyToAccount.get(v.partyId);
        return {
            ...v,
            type:            v.universalVoucher?.type,   // 5D-11: type on spine
            branch:          v.universalVoucher?.branch ?? null,   // 5D-12: branch on spine
            date:            v.universalVoucher?.date,   // 5D-10: date on spine
            reference:       v.universalVoucher?.voucherNo ?? "",   // 5D-6
            ...partyDisplay,
            createdBy:       creatorName(v),
            partyAccountId:  accFromPerson ?? accFromCompany ?? null,
            partyPersonId:   accFromPerson  != null ? v.partyId : null,
            partyCompanyId:  accFromPerson  == null && accFromCompany != null ? v.partyId : null,
        };
    });

    return NextResponse.json(enriched);
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
        creditPeriodDays,
        refNumber,
        refDate,
        refVoucherId,
        bomId,
        destinationBranchId,
        shippingAmt    = 0,
        roundOff       = 0,
        discountPct,
        discountAmt,
        showPrices,
        deliveryMode,
        placeOfSupply,
        lines = [],
        charges = [],
        tenders = [],
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
        /// Voucher-level discount (mutually-convertible with discountAmt)
        discountPct?:    number;
        discountAmt?:    number;
        // Challan-only: when false the printed challan hides rate/amount columns.
        showPrices?:     boolean;
        /// "COUNTER" | "SHIPPED" — drives place-of-supply resolution for GST.
        /// Defaults to "COUNTER" (server-side) so older callers behave as before.
        deliveryMode?:   InvVoucherDeliveryMode;
        /// Explicit 2-char state code for the place of supply. When omitted
        /// the server resolves it from the party + branch via
        /// resolveBuyerStateCode(party, branchState, deliveryMode).
        placeOfSupply?:  string;
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
        /// Additional GL allocation rows ("+ Add Account" below items).
        /// MANUFACTURING_JOURNAL uses these as expense charges (Dr only,
        /// always positive). SALE / PURCHASE etc. accept signed amounts
        /// (positive = body direction, negative = opposite). See
        /// InvVoucherCharge in inventory.prisma.
        charges?: {
            accountId:    number;
            description?: string;
            amount:       number;
        }[];
        /// Multi-tender settlement rows. When provided, replaces the legacy
        /// single `paymentAccountId` + `amountReceived` shape. Each row =
        /// one Dr (sale) / Cr (purchase) on the counter side. AR portion =
        /// a tender row whose accountId points at the customer's ledger.
        tenders?: {
            accountId: number;
            amount:    number;
            method?:   "CASH" | "BANK_TRANSFER" | "CARD" | "CHEQUE" | "MOBILE_PAYMENT" | "OTHER";
            reference?: string;
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
    if (!lines.length && !(isManufacturingJournal && charges.length > 0)) {
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

    if (isManufacturingJournal && charges.length > 0 && tenders.length === 0) {
        return NextResponse.json({ error: "Manufacturing Journal Charges require a payment tender (cash / bank / sundry creditors)." }, { status: 400 });
    }
    for (const e of charges) {
        // MJ enforces positive (Dr Expense); other voucher types allow
        // signed amounts (sign determines direction via postInvVoucher).
        if (!e.accountId) {
            return NextResponse.json({ error: "Each charge line needs an account" }, { status: 400 });
        }
        if (isManufacturingJournal && !(e.amount > 0)) {
            return NextResponse.json({ error: "Each Manufacturing Journal charge needs amount > 0" }, { status: 400 });
        }
        if (!Number.isFinite(e.amount) || Math.abs(e.amount) < 0.005) {
            return NextResponse.json({ error: "Each charge line needs a non-zero amount" }, { status: 400 });
        }
    }
    for (const t of tenders) {
        if (!t.accountId || !(t.amount > 0)) {
            return NextResponse.json({ error: "Each tender row needs an account and amount > 0" }, { status: 400 });
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

    // chargesNet — signed sum of all charge rows. Positive on a sale-side
    // voucher means body-direction (Cr Income → bill goes UP); negative
    // means opposite (Dr Expense → bill goes DOWN). Mirror on purchase.
    const chargesNet = charges.reduce((s, c) => s + Number(c.amount), 0);

    const { subtotal, taxAmount, totalAmount } = calcVoucherTotals(
        computedLines,
        Number(shippingAmt),
        overallDiscount,
        Number(roundOff),
        chargesNet,
    );

    // Validate tenders sum to totalAmount when supplied. Operator UX: when
    // the form's "Balance" auto-fill row was rendered, it's included in
    // the tenders[] array as the customer-AR row, so the sum should match
    // the total exactly. Tolerate ±₹0.01 for rounding.
    if (tenders.length > 0) {
        const tSum = tenders.reduce((s, t) => s + Number(t.amount), 0);
        if (Math.abs(tSum - totalAmount) > 0.01) {
            return NextResponse.json(
                { error: `Tenders sum (₹${tSum.toFixed(2)}) does not match voucher total (₹${totalAmount.toFixed(2)}).` },
                { status: 400 },
            );
        }
    }

    // Resolve place-of-supply for the GST routing. The client (TradingVoucherPage)
    // can send `placeOfSupply` directly when the cashier picked a state override;
    // otherwise we derive it from the party (Person/Company lookup) + delivery
    // mode + branch state. Stamped on InvVoucher.placeOfSupply so /post never
    // has to re-resolve.
    const resolvedDeliveryMode: InvVoucherDeliveryMode = deliveryMode ?? "COUNTER";
    let resolvedPlaceOfSupply = (placeOfSupply ?? "").trim();
    if (resolvedPlaceOfSupply && !isValidStateCode(resolvedPlaceOfSupply)) {
        return NextResponse.json(
            { error: `Invalid placeOfSupply "${resolvedPlaceOfSupply}". Expected a 2-digit GSTIN state code.` },
            { status: 400 },
        );
    }
    if (!resolvedPlaceOfSupply) {
        const branch = await prisma.branch.findUnique({
            where: { id: branchId },
            select: { gstStateCode: true },
        });
        const org = await getOrganisation();
        const sellerState = (branch?.gstStateCode || org.gstStateCode || "").trim();
        let party: { gstin: string | null; gstStateCode: string | null; shippingStateCode: string | null } | null = null;
        if (partyType === "customer" && partyId) {
            party = await prisma.person.findUnique({
                where: { id: partyId },
                select: { gstin: true, gstStateCode: true, shippingStateCode: true },
            });
        } else if (partyType === "company" && partyId) {
            party = await prisma.company.findUnique({
                where: { id: partyId },
                select: { gstin: true, gstStateCode: true, shippingStateCode: true },
            });
        }
        resolvedPlaceOfSupply = resolveBuyerStateCode(party, sellerState, resolvedDeliveryMode);
    }

    const userId = user!.id;

    // Resolve the canonical ledger account from the party identity so accountId is
    // always populated — not just the legacy partyType/partyId pair. (Account.personId
    // / companyId are unique.)
    let resolvedAccountId: number | null = null;
    if (partyType === "customer" && partyId) {
        resolvedAccountId = (await prisma.account.findUnique({ where: { personId: partyId }, select: { id: true } }))?.id ?? null;
    } else if (partyType === "company" && partyId) {
        resolvedAccountId = (await prisma.account.findUnique({ where: { companyId: partyId }, select: { id: true } }))?.id ?? null;
    }

    // Office SALES_ORDER rides the unified Orders pipeline (P7) so it shows on the
    // Orders board alongside counter + online orders.
    let orderPipelineId: string | null = null;
    let orderStatusId: string | null = null;
    if (type === "SALES_ORDER") {
        const op = await getOrderPipeline(prisma);
        orderPipelineId = op?.id ?? null;
        orderStatusId = orderEntryStatus(op);
    }

    try {
        const voucher = await prisma.$transaction(async (tx) => {
            const reference = await invNextRef(tx, type);
            // Phase 5 5.0/5C: spine FIRST (the document anchor) so the goods lines
            // can hang off it. POST attaches GL lines + flips the spine; non-GL
            // types just flip the status. Gated out of balances while DRAFT.
            const spineId = await engineCreateSpine(tx, {
                type,
                date:           new Date(date),
                description:    description.trim(),
                voucherNo:    reference,
                partyAccountId: resolvedAccountId,
                branchId,   // 5D-12: branch primary on the spine
                userId,
            });
            const created = await tx.voucherDetail.create({
                data: {
                    // 5D-11/5D-12: type + branch live on the spine (engineCreateSpine set them).
                    // 5D-6: reference (voucherNo) lives on the spine.
                    universalVoucherId: spineId,
                    orderPipelineId,
                    orderStatusId,
                    // 5D-5/5D-10: description + date + 5D-4 party ledger live on the spine (set at engineCreateSpine).
                    partyJson:    buildPartyJson({ name: partyName, phone: partyPhone, address: partyAddress }) ?? Prisma.DbNull,
                    partyType:    partyType  || null,
                    partyId:      partyId    || null,
                    creditPeriodDays: creditPeriodDays ?? null,
                    refNumber:       refNumber || null,
                    refDate:         refDate ? new Date(refDate) : null,
                    refVoucherId:    refVoucherId ?? null,
                    bomId:           isManufacturingJournal && bomId ? bomId : null,
                    destinationBranchId: isBranchTransfer ? destinationBranchId ?? null : null,
                    shippingAmt,
                    roundOff,
                    discountPct: discountPct != null ? Number(discountPct) : null,
                    discountAmt: overallDiscount > 0 ? overallDiscount : null,
                    ...(typeof showPrices === "boolean" ? { showPrices } : {}),
                    subtotal,
                    taxAmount,
                    totalAmount,
                    deliveryMode:  resolvedDeliveryMode,
                    placeOfSupply: resolvedPlaceOfSupply || null,
                    // 5D-2: creator lives on the spine (engineCreateSpine set it).
                    // G4b: tender + charge INPUT → settlementJson.
                    settlementJson: buildSettlementJson(tenders, charges),
                },
            });
            // 5D-2: creator name comes from the spine's createdById — resolve it for
            // the response shape (the create response carried `createdBy.name`).
            const creator = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });
            // Phase 5 5C: goods lines hang off the spine (universalVoucherId).
            await tx.voucherInventoryLine.createMany({
                data: computedLines.map((l) => ({
                    universalVoucherId: spineId,
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
            });
            const lines = await tx.voucherInventoryLine.findMany({
                where:   { universalVoucherId: spineId },
                include: { product: { select: { id: true, sku: true, name: true } } },
            });
            // Phase 5 5A: dual-write the order-pipeline link (SALES_ORDER rides the board).
            await syncVoucherLinks(tx, spineId, { orderPipelineId, orderStatusId });
            return { ...created, lines, createdBy: creator };
        });

        return NextResponse.json(voucher, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to save voucher");
    }
}
