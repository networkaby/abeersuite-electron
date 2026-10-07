import { prisma } from "@/shared/lib/prisma/prismaClient";
import { voucherDisplayNo } from "@/shared/lib/accountancy/uvNo";
import { NO_PARTY_LINK, partyLinkFields } from "@/shared/lib/parties/partyLink";
import { resolvePartyAccountId, resolvePartyLinks } from "@/shared/lib/parties/partyLinkServer";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, userCanPostVoucher, userCanActOnVoucher } from "@/shared/lib/auth/permissions";
import { VOUCHER_MATRIX } from "@/shared/lib/auth/voucherMatrix";
import { posKindForVoucherType } from "@/shared/lib/auth/posVoucherMatrix";
import { calcLineTotals, calcVoucherTotals } from "@/modules/inventory/lib/stock";
import { round2 } from "@/shared/lib/format";
import { InvVoucherType, Prisma, type InvVoucherDeliveryMode } from "@/generated/prisma/client";
import { buildPartyJson, readPartyName, readPartyPhone, readPartyAddress } from "@/shared/lib/accountancy/partySnapshot";
import { buildSettlementJson } from "@/shared/lib/accountancy/settlement";
import { resolveServiceCharges, chargesNetTotal, SERVICE_VOUCHER_TYPES } from "@/shared/lib/accountancy/serviceCharges";
import { engineCreateSpine } from "@/modules/accountancy/lib/transactionEngine";
import { syncVoucherLinks } from "@/modules/accountancy/lib/voucherLinks";
import { loadSettlements } from "@/modules/accountancy/lib/billLink";
import { requireWritableBranchId, requireBranchAccess, BranchAccessError } from "@/shared/lib/auth/activeBranch";
import { branchAccessResponse } from "@/shared/lib/api/branchAccessResponse";
import { auth } from "@/auth";
import { handleApiError } from "@/shared/lib/api";
import { GlBuildError, tenderCoverageComplaint, tenderPaisaDrift } from "@/modules/accountancy/lib/postInvVoucher";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { resolveBuyerStateCode } from "@/shared/lib/gst/resolveBuyerState";
import { isValidStateCode } from "@/shared/lib/gst/indianStates";
import { getOrderPipeline, orderEntryStatus } from "@/modules/order/lib/orderPipeline";
import { after } from "next/server";
import { notifyBill, isCustomerSaleType } from "@/shared/lib/whatsapp/notifyBill";
import * as Sentry from "@sentry/nextjs";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import { GlPostFailedError, postVoucherInTx } from "@/modules/inventory/lib/postVoucherInTx";
import { CreditLimitError } from "@/shared/lib/accountancy/checkCreditLimit";
import { cleanLineNote } from "@/shared/lib/print/lineDescription";

// GET /api/inventory/vouchers?type=PURCHASE|SALE&status=DRAFT|POSTED|CANCELLED&branchId=BR-HQ|all
//
// Branch handling:
//   • No `branchId` param → org-wide (no branch filter). Reports default here.
//   • `branchId=all`      → org-wide (kept for explicit callers).
//   • `branchId=<id>`     → branch-scoped, with access check.
// Write paths that want branch-scoping pass `branchId` explicitly. The top-bar
// active-branch cookie is no longer consulted by this GET — top bar represents
// the working branch for writes; reports default to org-wide.
export async function GET(req: NextRequest) {
    const { response } = await requireAuth();
    if (response) return response;

    const session = await auth();
    const { searchParams } = new URL(req.url);
    const typeParam = searchParams.get("type");                                       // single value, OR
    const typesParam = searchParams.get("types");                                     // comma-separated list (POS,SALE)
    const status = searchParams.get("status") as "DRAFT" | "POSTED" | "CANCELLED" | null;
    const branchParam = searchParams.get("branchId");
    const accountIdParam = searchParams.get("accountId");
    const ticketIdParam = searchParams.get("ticketId");
    // Optional date window on the spine's `date` (yyyy-mm-dd, inclusive). Lets a
    // picker ask for "the last N days" instead of pulling every voucher.
    const isDay = (v: string | null): v is string => v != null && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const dateWindow = {
        ...(isDay(fromParam) ? { gte: new Date(`${fromParam}T00:00:00.000Z`) } : {}),
        ...(isDay(toParam) ? { lte: new Date(`${toParam}T23:59:59.999Z`) } : {}),
    };
    // Only rows RAISED at this counter — the POS register's "Only this counter".
    const counterIdRaw = Number(searchParams.get("counterId"));
    const counterId = Number.isInteger(counterIdRaw) && counterIdRaw > 0 ? counterIdRaw : null;
    // 5D-17: shopOrderId filter removed — the order↔voucher FK is disconnected (ecommerce rebuild).

    // Normalise the type filter — accept either ?type=SALE or ?types=SALE,POS.
    const ALLOWED_TYPES = new Set<InvVoucherType>([
        "PURCHASE", "SALE", "POS", "ONLINE_INVOICE", "ESTIMATE", "POS_ESTIMATE", "POS_ORDER", "ONLINE_ORDER",
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
    let branchScopeId: string | undefined;
    if (branchParam === "all" || !branchParam) {
        // No branch filter — org-wide. Reports land here by omitting the param.
    } else {
        try { requireBranchAccess(session, branchParam); } catch (e) {
            if (e instanceof BranchAccessError) return branchAccessResponse(e);
            throw e;
        }
        branchScopeId = branchParam;
    }

    // 5D-4/8/10/11/12: type/status/party/branch all live on the spine.
    // (Typed so future drift is caught — the prior untyped literal silently kept
    // dropped columns via conditional spreads.)
    const spineFilter: Prisma.UniversalVoucherWhereInput = {
        ...(typeList.length > 0 ? { type: { in: typeList } } : {}),
        ...(status ? { status } : {}),
        ...(accountIdParam ? { partyAccountId: Number(accountIdParam) } : {}),
        ...(branchScopeId ? { branchId: branchScopeId } : {}),
        // "Only this counter" on the POS register (Orders / Estimates tabs).
        ...(counterId != null ? { sourceCounterId: counterId } : {}),
        ...(Object.keys(dateWindow).length > 0 ? { date: dateWindow } : {}),
    };
    const vouchers = await prisma.voucherDetail.findMany({
        where: {
            universalVoucher: {
                ...spineFilter,
                ...(ticketIdParam ? { links: { some: { kind: "TICKET", targetId: ticketIdParam } } } : {}),
            },
        },
        // Newest first by WHEN IT WAS RAISED. `date` is @db.Date (day only, no
        // time) so it groups the days; `sourceCreatedAt` is the faithful counter
        // wall-clock and orders within one. `id` is only a last tie-break — on its
        // own it records insert-at-office order, which puts a till's late-synced
        // backlog above documents raised days afterwards.
        orderBy: [
            { universalVoucher: { date: "desc" } },
            { universalVoucher: { sourceCreatedAt: "desc" } },
            { id: "desc" },
        ],   // 5D-10: date on spine
        include: {
            // 5D-2 creator + 5D-6 ref + 5D-8 lifecycle + 5D-10 date + 5D-12 branch live on the spine.
            universalVoucher: { select: { createdById: true, voucherNo: true, description: true, date: true, type: true, status: true, cancelledAt: true, createdAt: true, sourceCreatedAt: true, sourceCounterId: true, branch: { select: { id: true, name: true, number: true } }, _count: { select: { inventoryLines: true } } } },   // +5D-5 description +5D-11 type +5D-12 branch; _count.inventoryLines = how many goods lines the voucher carries (5C: lines hang off the spine)
            // refReturns = vouchers that reference THIS one via refVoucherId. For a
            // POS_ORDER / POS_ESTIMATE it means a sale was raised against it →
            // "converted" (not pending). (For SALE etc. it's the returns count.)
            // Phase 5 5C: goods lines hang off the spine, not InvVoucher.
            _count:    { select: { refReturns: true } },
        },
    });

    // Resolve each row's party to its profile link so the Day Book / register can
    // link the Party cell. A conversion or merge re-points every bill's party id at
    // the surviving record, so the stored id always leads to a live profile.
    // `withAccountId` because the settlement pass below keys off partyAccountId.
    const partyLinks = await resolvePartyLinks(prisma, vouchers, { withAccountId: true });
    // 5D-2: resolve creator names from each row's spine (createdById on the spine).
    const creatorIds = [...new Set(vouchers.map((v) => v.universalVoucher?.createdById).filter((x): x is number => x != null))];
    const creatorById = new Map(
        (creatorIds.length === 0 ? [] : await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } }))
            .map((u) => [u.id, u.name]),
    );
    const creatorName = (v: { universalVoucher: { createdById: number } | null }) =>
        v.universalVoucher?.createdById != null ? { name: creatorById.get(v.universalVoucher.createdById) ?? null } : null;
    // Live-conversion flag: a source is "converted" while a non-deleted, non-
    // cancelled voucher references it via refVoucherId. Deleting/cancelling that
    // target clears the flag (re-opens conversion). One grouped lookup.
    const voucherIdsForConv = vouchers.map((v) => v.id);
    const liveConvRefs = voucherIdsForConv.length === 0 ? [] : await prisma.voucherDetail.findMany({
        where:  { refVoucherId: { in: voucherIdsForConv }, universalVoucher: { status: { not: "CANCELLED" } } },
        select: { refVoucherId: true },
    });
    const convertedIds = new Set(liveConvRefs.map((r) => r.refVoucherId));
    const enriched = vouchers.map((v) => {
        // Derived party display fields from the frozen snapshot so list/register
        // clients keep reading `partyName` / `partyPhone` unchanged.
        const partyDisplay = { partyName: readPartyName(v.partyJson), partyPhone: readPartyPhone(v.partyJson), partyAddress: readPartyAddress(v.partyJson) };
        // 5D-8: lifecycle (status/cancelledAt) + createdAt live on the spine
        // now — surface them so register/Day-Book clients keep reading the old shape.
        const spineLifecycle = {
            status:      v.universalVoucher?.status,
            cancelledAt: v.universalVoucher?.cancelledAt ?? null,
            createdAt:   v.universalVoucher?.createdAt,
            // Faithful posting wall-clock + the till it was raised at. Surfaced
            // alongside the lifecycle fields so every register client reads them
            // the same way.
            sourceCreatedAt: v.universalVoucher?.sourceCreatedAt ?? null,
            sourceCounterId: v.universalVoucher?.sourceCounterId ?? null,
        };
        if (v.partyId == null) {
            return { ...v, type: v.universalVoucher?.type, branch: v.universalVoucher?.branch ?? null, date: v.universalVoucher?.date, reference: voucherDisplayNo(v.universalVoucher?.voucherNo, v.universalVoucherId), description: v.universalVoucher?.description ?? null, lineCount: v.universalVoucher?._count?.inventoryLines ?? 0, ...spineLifecycle, ...partyDisplay, createdBy: creatorName(v), converted: convertedIds.has(v.id), partyAccountId: null, ...NO_PARTY_LINK };
        }
        const link = partyLinks.for(v);
        return {
            ...v,
            type:            v.universalVoucher?.type,   // 5D-11: type on spine
            branch:          v.universalVoucher?.branch ?? null,   // 5D-12: branch on spine
            date:            v.universalVoucher?.date,   // 5D-10: date on spine
            reference:       voucherDisplayNo(v.universalVoucher?.voucherNo, v.universalVoucherId),   // 5D-6
            description:     v.universalVoucher?.description ?? null,   // 5D-5: narration on spine
            lineCount:       v.universalVoucher?._count?.inventoryLines ?? 0,   // how many goods lines this voucher carries
            ...spineLifecycle,   // 5D-8: status/cancelledAt/createdAt on spine
            ...partyDisplay,
            createdBy:       creatorName(v),
            converted:       convertedIds.has(v.id),
            partyAccountId:  link?.accountId ?? null,
            ...partyLinkFields(link),
        };
    });

    // Bill-wise settlement — Settled / Partial / Due, the same chip the party's
    // own Transactions tab shows. A VoucherDetail carries no GL lines, so unlike
    // the Day Book and the GL register this one pays for its own party-leg query:
    // three bounded queries for the whole list, never one per row.
    const settlements = await loadSettlements(prisma, enriched.map((v) => ({
        universalVoucherId: v.universalVoucherId,
        partyAccountId:     v.partyAccountId ?? null,
        kind:               v.type ?? null,
        status:             v.status ?? null,
    })));
    const withSettlement = enriched.map((v) => ({
        ...v,
        settlement:     (v.universalVoucherId != null ? settlements[v.universalVoucherId]?.state : null) ?? null,
        settlementOpen: (v.universalVoucherId != null ? settlements[v.universalVoucherId]?.open  : 0) ?? 0,
        canLink:        (v.universalVoucherId != null ? settlements[v.universalVoucherId]?.canLink : false) ?? false,
    }));

    return NextResponse.json(withSettlement);
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
        post: postNow = false,
        lines = [],
        charges = [],
        services = [],
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
        /// Save AND post in one request. The client used to save a draft, get its
        /// id back, then call /[id]/post — two HTTP round trips and two
        /// transactions for what is one action at the counter. With this the whole
        /// thing happens in a single transaction, which also means a failure to
        /// post leaves no orphan draft behind.
        post?:           boolean;
        lines: {
            productId:   number;
            description?: string;
            /// The line's Note box (serial no., colour) — its own column.
            note?:       string | null;
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
        /// Service lines ("Add service" on the voucher form) — the catalogue
        /// rows from Settings → Services. The client sends only the id and the
        /// qty × GST-EXCLUSIVE rate it typed; the ledger and the GST rate are
        /// re-resolved here from the database (resolveServiceCharges), and the
        /// row joins `charges` as a tax-bearing leg. The SAME ledger is
        /// credited on a sale and debited on a purchase — postInvVoucher takes
        /// the direction from the voucher type, so no second ledger is needed.
        services?: {
            serviceId:    number;
            quantity:     number;
            unitPrice:    number;
            description?: string;
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

    // Only the kinds this route authors: the office inventory kinds, and POS Sale /
    // Order / Estimate (Convert makes a POS Order from an Estimate). Anything else —
    // an online order or invoice, a GL kind, OPENING, a made-up name — has no tick
    // to check, so it is refused instead of waved through the gates below.
    const authoredHere = VOUCHER_MATRIX.some((r) => r.module === "inventory" && r.type === type)
        || posKindForVoucherType(type) != null;
    if (!authoredHere) {
        return NextResponse.json({ error: `${type} vouchers cannot be created here.` }, { status: 400 });
    }

    // Per-kind create gate — a matrix voucher kind requires its own create key
    // (`inventory:voucher:create:<kind>`; admin:bypass also passes). POS Sale /
    // Order / Estimate need their POS-table Create tick.
    if (!userCanActOnVoucher(user, type, "create")) {
        return NextResponse.json({ error: "You do not have permission to create this voucher kind." }, { status: 403 });
    }
    // Posting in the same request still needs the POST key, exactly as the separate
    // /[id]/post call did — saving in one step must not be a way around the gate.
    if (postNow && !userCanPostVoucher(user, type)) {
        return NextResponse.json({ error: "You do not have permission to post this voucher kind." }, { status: 403 });
    }

    const isPhysicalStock = type === "PHYSICAL_STOCK";
    const isManufacturingJournal = type === "MANUFACTURING_JOURNAL";
    const isBranchTransfer = type === "BRANCH_TRANSFER";

    if (isBranchTransfer) {
        if (!destinationBranchId) {
            return NextResponse.json({ error: "Branch Transfer needs a destination branch" }, { status: 400 });
        }
    }

    // ── Service lines → tax-bearing charge rows ───────────────────────────
    // Resolved BEFORE the "needs at least one line" guard below, so a voucher
    // that is nothing but services still counts as having something on it.
    // The ledger and the GST rate come from the catalogue, never from the
    // browser; the same ledger is credited on a sale and debited on a purchase.
    if (services.length > 0 && !SERVICE_VOUCHER_TYPES.has(type)) {
        return NextResponse.json({ error: "This voucher type does not carry service lines." }, { status: 400 });
    }
    for (const s of services) {
        if (!s.serviceId || !(s.quantity > 0)) {
            return NextResponse.json({ error: "Each service line needs a service and quantity > 0" }, { status: 400 });
        }
    }
    const resolvedServices = await resolveServiceCharges(prisma, services);
    if (!resolvedServices.ok) {
        return NextResponse.json({ error: resolvedServices.error, code: resolvedServices.code }, { status: 422 });
    }
    // One list from here on — a service IS a charge, it just carries its own GST
    // and the identity needed to re-render it as a service line on edit.
    const allCharges = [...charges, ...resolvedServices.charges];

    // Manufacturing Journal is allowed to have zero stock lines IF it has at
    // least one expense (Charges) line — covers pure-overhead allocations.
    // SALE / PURCHASE are allowed to have zero item lines too — a pure
    // service invoice (e.g. "Service charge for computer repairing") posted
    // entirely through the "+ Add Account" charges, no stock item involved.
    // Every other type still requires at least one item line — unless it is
    // carrying services, which are a document in their own right.
    const isSaleOrPurchase = type === "SALE" || type === "PURCHASE";
    if (!lines.length
        && !(isManufacturingJournal && charges.length > 0)
        && !(isSaleOrPurchase && charges.length > 0)
        && resolvedServices.charges.length === 0) {
        return NextResponse.json({ error: "At least one line item or charge required" }, { status: 400 });
    }

    let branchId: string;
    try {
        branchId = bodyBranchId
            ? (requireBranchAccess(session, bodyBranchId), bodyBranchId)
            : requireWritableBranchId(req, session);
    } catch (e) {
        if (e instanceof BranchAccessError) return branchAccessResponse(e);
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
    // A tax-bearing row (a service) counts at GROSS — net + its own GST — so
    // the total matches what the operator saw; the GL splits the gross back
    // into the charge leg and the voucher's tax legs.
    const chargesNet = chargesNetTotal(allCharges);

    // ── Bill-level discount → subtracted AFTER tax ──────────────────────────
    // Deliberate, by decision (2026-07-28): a LINE discount reduces the price
    // and GST is charged on the reduced value (calcLineTotals above), but the
    // HEADER discount comes off the tax-inclusive bottom line — GST stays on
    // the undiscounted value.
    //
    // This knowingly deviates from CGST Act §15(3)(a) / the Tally treatment,
    // which excludes an on-invoice discount from the taxable value. Parked in
    // PROJECT_BRAIN.md; do not "fix" it by apportioning onto the lines without
    // agreement — that was tried (6c6c1027) and reverted, because it saved a
    // line whose taxAmount/amount no longer satisfied the row's own invariant
    // (amount = qty × rate − discountAmt + taxAmount), so re-opening the
    // voucher for edit recomputed a total short by the discount's GST.
    //
    // Clamped to the line subtotal so an over-typed discount can't drive
    // totalAmount negative.
    const billDiscIncl = round2(Math.min(overallDiscount, lineSubtotal));
    const totals = calcVoucherTotals(
        computedLines,
        Number(shippingAmt),
        billDiscIncl,
        Number(roundOff),
        chargesNet,
    );
    // A paisa between this total and the form's payment rows is rounding — it
    // goes on the voucher's own Round Off, so invoice, payment and ledger agree.
    const drift = tenderPaisaDrift(tenders, totals.totalAmount);
    const savedRoundOff = round2(Number(roundOff) + drift);
    const { subtotal, taxAmount } = totals;
    const totalAmount = round2(totals.totalAmount + drift);

    // The payment rows must add up to the total — the same rule the edit route
    // applies, from the same function, so the two can never drift apart again.
    // The form's "Balance" auto-fill row is itself a tender (the customer-AR
    // one), so a credit sale satisfies this like any other.
    const tenderComplaint = tenderCoverageComplaint(tenders, totalAmount);
    if (tenderComplaint) return NextResponse.json({ error: tenderComplaint }, { status: 400 });

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
    // Everything the save needs from the database BEFORE the transaction opens, in
    // ONE round trip instead of four in a row. None of these depend on each other:
    // the branch's state, the party's state, the party's ledger and the item names
    // are four independent questions that used to be asked one after the other,
    // each waiting for the last to come back from Supabase.
    const isCustomer = partyType === "customer" && !!partyId;
    const isCompany  = partyType === "company"  && !!partyId;
    const productIds = [...new Set(lines.map((l) => l.productId))];
    const [branch, partyPerson, partyCompany, partyAccount, productsForResponse] = await Promise.all([
        // Always loaded now: posting in the same request needs the branch's state
        // for the CGST/SGST-vs-IGST split, not only place-of-supply resolution.
        prisma.branch.findUnique({ where: { id: branchId }, select: { gstStateCode: true } }),
        !resolvedPlaceOfSupply && isCustomer
            ? prisma.person.findUnique({ where: { id: partyId }, select: { gstin: true, gstStateCode: true, shippingStateCode: true } })
            : null,
        !resolvedPlaceOfSupply && isCompany
            ? prisma.company.findUnique({ where: { id: partyId }, select: { gstin: true, gstStateCode: true, shippingStateCode: true } })
            : null,
        // The party's ledger, resolved through any conversion / merge forwarding
        // note so the spine always carries the account that is live today.
        resolvePartyAccountId(prisma, { partyType: partyType ?? null, partyId: partyId ?? null }),
        // Dresses the response's `lines[].product`, and — when this request also
        // posts — feeds the stock arm, which reads `stock` and `mrpPaise`. Fetched
        // here so the transaction never has to read back rows it just wrote.
        productIds.length > 0
            ? prisma.invProduct.findMany({
                where:  { id: { in: productIds } },
                select: { id: true, sku: true, name: true, stock: true, mrpPaise: true },
            })
            : [],
    ]);

    if (!resolvedPlaceOfSupply) {
        const org = getOrganisation();
        const sellerState = (branch?.gstStateCode || org.gstStateCode || "").trim();
        resolvedPlaceOfSupply = resolveBuyerStateCode(partyPerson ?? partyCompany, sellerState, resolvedDeliveryMode);
    }

    // The CGST/SGST-vs-IGST split inputs, for the post arm below. Place of supply
    // IS the buyer's state and was just resolved above (party lookup included), so
    // nothing is looked up twice. Blank buyer falls back to the seller — intra-state
    // — which is the same default the post route applies.
    const sellerStateCode = (branch?.gstStateCode || getOrganisation().gstStateCode || "").trim();
    const buyerStateCode  = resolvedPlaceOfSupply || sellerStateCode;

    const userId = user!.id;
    const resolvedAccountId: number | null = partyAccount;
    const productById = new Map(productsForResponse.map((p) => [p.id, p]));

    // Orders ride the unified Orders pipeline (P7) so they show on the Orders board
    // AND get an entry stage (New) — which is what makes them editable (order edits
    // are gated to New / Under-Review). Both office SALES_ORDER and counter POS_ORDER
    // need it; without the stage a (e.g. converted) order opens non-editable.
    let orderPipelineId: string | null = null;
    let orderStatusId: string | null = null;
    if (type === "SALES_ORDER" || type === "POS_ORDER") {
        const op = await getOrderPipeline(prisma);
        orderPipelineId = op?.id ?? null;
        orderStatusId = orderEntryStatus(op);
    }

    try {
        const voucher = await prisma.$transaction(async (tx) => {
            // 5D-2: creator name comes from the spine's createdById — which on a
            // create is always the person making the request, so it comes from the
            // session instead of a lookup for a name we were already holding.
            const creator = { name: session?.user?.name ?? null };

            // The two rows this route owns, as data. Written against whichever spine
            // we end up with, so the draft path and the posted path cannot drift
            // apart in what they store.
            const detailData = (universalVoucherId: number) => ({
                // 5D-11/5D-12: type + branch live on the spine.
                // 5D-6: reference (voucherNo) lives on the spine.
                universalVoucherId,
                // 5A-3: orderPipelineId/orderStatusId dropped — live on VoucherLink (syncVoucherLinks below).
                // 5D-5/5D-10: description + date + 5D-4 party ledger live on the spine.
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
                roundOff: savedRoundOff,
                discountPct: discountPct != null ? Number(discountPct) : null,
                // Tax-INCLUSIVE, as typed (clamped to the bill) — subtracted
                // from the bottom line: totalAmount = subtotal − discountAmt + …
                discountAmt: billDiscIncl > 0 ? billDiscIncl : null,
                ...(typeof showPrices === "boolean" ? { showPrices } : {}),
                subtotal,
                taxAmount,
                totalAmount,
                deliveryMode:  resolvedDeliveryMode,
                placeOfSupply: resolvedPlaceOfSupply || null,
                // G4b: tender + charge INPUT → settlementJson.
                settlementJson: buildSettlementJson(tenders, allCharges),
            });

            // Phase 5 5C: goods lines hang off the spine (universalVoucherId).
            const lineData = (universalVoucherId: number) => computedLines.map((l) => ({
                universalVoucherId,
                productId:   l.productId,
                description: l.description || null,
                note:        cleanLineNote(l.note),
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
            }));

            /** Write the document itself against a spine that already exists. */
            const writeDocument = async (universalVoucherId: number) => {
                const created = await tx.voucherDetail.create({ data: detailData(universalVoucherId) });
                // A pure-service invoice (charges only, no stock item) has no goods
                // lines — skip the statement rather than send an empty insert.
                // `createManyAndReturn` hands back the rows it just wrote, so the
                // response is dressed from them and the product names fetched before
                // the transaction, instead of reading the same rows straight back out.
                const createdLines = computedLines.length === 0
                    ? []
                    : await tx.voucherInventoryLine.createManyAndReturn({ data: lineData(universalVoucherId) });
                const lines = createdLines.map((l) => ({ ...l, product: productById.get(l.productId) ?? null }));
                // Phase 5 5A: dual-write the order-pipeline link (SALES_ORDER rides
                // the board). A spine created moments ago has no link to clear, so
                // there is nothing to do unless there is one to write.
                if (orderPipelineId || orderStatusId) {
                    await syncVoucherLinks(tx, universalVoucherId, { orderPipelineId, orderStatusId }, { fresh: true });
                }
                return { created, lines };
            };

            // ── Saving a DRAFT ───────────────────────────────────────────────
            // Born DRAFT because someone chose a draft. No number: the series
            // advances when the voucher POSTS, so a draft that is never posted
            // leaves no hole in the register. Until then the spine id IS its
            // identifier — every list and print falls back to UV-<id>.
            if (!postNow) {
                const spineId = await engineCreateSpine(tx, {
                    type,
                    date:           new Date(date),
                    description:    description.trim(),
                    voucherNo:      null,
                    partyAccountId: resolvedAccountId,
                    branchId,   // 5D-12: branch primary on the spine
                    userId,
                });
                const { created, lines } = await writeDocument(spineId);
                return { ...created, lines, createdBy: creator, posted: false };
            }

            // ── Saving a POSTED voucher ──────────────────────────────────────
            // The spine is born POSTED and numbered, so the POSTING runs first and
            // the document hangs off the spine it returns. This voucher was created
            // in order to be posted; writing it DRAFT and updating it a moment later
            // was two row versions, an extra read and an extra write for one
            // document — and on a counter replica, two outbox rows instead of one.
            //
            // It is also one HTTP request: the client used to save a draft, wait for
            // its id, then call /[id]/post. And a voucher that cannot post now
            // leaves nothing behind at all, because none of it was written.
            const { universalVoucherId, notes } = await postVoucherInTx(tx, {
                voucher: {
                    // No detail row yet — `id` is only used to exclude THIS voucher
                    // from the Physical Stock same-day lookup, and there is nothing
                    // to exclude.
                    id:                  0,
                    // Null is what asks for a spine born POSTED.
                    universalVoucherId:  null,
                    type,
                    branchId,
                    destinationBranchId: isBranchTransfer ? destinationBranchId ?? null : null,
                    placeOfSupply:       resolvedPlaceOfSupply || null,
                    deliveryMode:        resolvedDeliveryMode,
                    partyType:           partyType || null,
                    partyId:             partyId   || null,
                    partyAccountId:      resolvedAccountId,
                    // The same two snapshots the detail row stores. Both builders are
                    // typed for Prisma INPUT, which is why each needs saying that it
                    // is plain JSON here; the post path only ever READS them.
                    settlementJson:      buildSettlementJson(tenders, allCharges) as unknown as Prisma.JsonValue,
                    partyJson:           (buildPartyJson({ name: partyName, phone: partyPhone, address: partyAddress }) ?? null) as unknown as Prisma.JsonValue,
                    subtotal,
                    taxAmount,
                    shippingAmt:         Number(shippingAmt),
                    roundOff:            savedRoundOff,
                    totalAmount,
                    discountAmt:         billDiscIncl > 0 ? billDiscIncl : null,
                    universalVoucher: {
                        date:        new Date(date),
                        voucherNo:   null,   // allocated as the spine is created
                        description: description.trim(),
                        branch:      { gstStateCode: branch?.gstStateCode ?? null },
                    },
                    lines: computedLines.map((l) => ({
                        ...l,
                        product: {
                            id:       l.productId,
                            stock:    productById.get(l.productId)?.stock ?? null,
                            mrpPaise: productById.get(l.productId)?.mrpPaise ?? null,
                        },
                    })),
                },
                userId,
                sellerStateCode,
                buyerStateCode,
            });
            const { created, lines } = await writeDocument(universalVoucherId!);
            return { ...created, lines, createdBy: creator, posted: true, _postNotes: notes };
        // This transaction carries the posting too, so it takes the same headroom
        // the /[id]/post route has always had. It does far less work than the two
        // transactions it replaces, but a 200-line stock-take is still long.
        }, { timeout: 30_000, maxWait: 10_000 });

        // Pricing recompute runs AFTER the response has gone — it is explicitly
        // non-critical and the cashier was waiting through a cost-ledger walk and a
        // second transaction for a number that is not on the bill they just printed.
        if (postNow && productIds.length > 0) {
            after(async () => {
                await recomputePricesForProducts(productIds).catch((err: unknown) => {
                    Sentry.captureException(err, { tags: { source: "price-recompute", voucherId: String(voucher.id) } });
                    console.error("[price-recompute] failed for voucher", voucher.id, err);
                });
            });
        }

        if (postNow && isCustomerSaleType(type) && voucher.universalVoucherId != null) {
            const uvId = voucher.universalVoucherId;
            after(() => notifyBill("SALE", uvId));
        }

        return NextResponse.json(voucher, { status: 201 });
    } catch (e) {
        // A voucher whose ledger entry cannot be built is the user's to fix (the
        // payment rows do not add up), not a server fault — show it as it is.
        if (e instanceof GlBuildError) return NextResponse.json({ error: e.message }, { status: 422 });
        if (e instanceof GlPostFailedError) return NextResponse.json({ error: e.message, notes: e.notes }, { status: 422 });
        // The customer has no credit left (or none at all) — the salesman's to
        // settle with them, not a server fault. `creditLimit` carries the figures
        // the form's raise-the-limit dialog shows, so it needs no second call.
        if (e instanceof CreditLimitError) {
            return NextResponse.json({ error: e.message, code: e.code, creditLimit: e.detail }, { status: 422 });
        }
        return handleApiError(e, "Failed to save voucher");
    }
}
