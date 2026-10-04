import { prisma } from "@/shared/lib/prisma/prismaClient";
import { PRE_EDIT_ACTION } from "@/shared/lib/accountancy/auditSnapshotKind";
import { voucherDisplayNo } from "@/shared/lib/accountancy/uvNo";
import { NextResponse } from "next/server";
import { after } from "next/server";
import { requireAuth, userCanActOnVoucher } from "@/shared/lib/auth/permissions";
import { calcLineTotals, calcVoucherTotals } from "@/modules/inventory/lib/stock";
import { round2 } from "@/shared/lib/format";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import { reapplyTradingVoucherInPlace } from "@/modules/accountancy/lib/reapplyTradingVoucher";
import { auditSnapshot } from "@/modules/accountancy/lib/voucherLifecycle";
import type { PostVoucherInput } from "@/modules/accountancy/lib/postInvVoucher";
import * as Sentry from "@sentry/nextjs";
import { handleApiError } from "@/shared/lib/api";
import { GlBuildError, tenderCoverageComplaint, tenderPaisaDrift } from "@/modules/accountancy/lib/postInvVoucher";
import { Prisma } from "@/generated/prisma/client";
import { buildPartyJson, readPartyName, readPartyPhone, readPartyAddress } from "@/shared/lib/accountancy/partySnapshot";
import { resolvePartyAccountId } from "@/shared/lib/parties/partyLinkServer";
import { readSettlement, buildSettlementJson } from "@/shared/lib/accountancy/settlement";
import { resolveServiceCharges, chargesNetTotal, SERVICE_VOUCHER_TYPES } from "@/shared/lib/accountancy/serviceCharges";
import { assertVoucherDate } from "@/shared/lib/accountancy/booksPeriodServer";
import { cleanLineNote } from "@/shared/lib/print/lineDescription";
import { resolveCounterPayments, isGiftCardTender, type CounterPayment } from "@/modules/pos/lib/counterTenders";

type Params = { params: Promise<{ id: string }> };

// GET /api/inventory/vouchers/[id]
export async function GET(_req: Request, { params }: Params) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const voucherRow = await prisma.voucherDetail.findUnique({
        where: { id: Number(id) },
        include: {
            // 5D-2 creator + 5D-6 ref + 5D-11 type + 5D-12 branch + 5D-4 party ledger + lifecycle live on the spine.
            // 5D-5/5D-10: date + description + narration + postedAt live on the spine too —
            // without them the edit form read `v.date === undefined` and silently
            // fell back to TODAY on every old voucher (same for the narration box).
            universalVoucher: { select: { createdById: true, voucherNo: true, type: true, date: true, description: true, narration: true, postedAt: true, branchId: true, partyAccountId: true, status: true, cancelledAt: true, sourceShiftId: true, branch: { select: { id: true, name: true } } } },
            // refVoucher powers parent-link surfaces — "Replaces <old ref>"
            // for a SALE_RETURN against a SALE, or "Linked to PO-…" on a GRN.
            refVoucher: { select: { id: true, universalVoucher: { select: { id: true, voucherNo: true, type: true } } } },   // 5D-11 type on spine
        },
    });
    if (!voucherRow) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Phase 5 5C: goods lines + stock ledger hang off the spine — load + attach.
    const voucher = {
        ...voucherRow,
        lines: await prisma.voucherInventoryLine.findMany({
            where:   { universalVoucherId: voucherRow.universalVoucherId ?? -1 },
            include: { product: { select: { id: true, sku: true, name: true, unit: { select: { code: true, label: true } } } } },
        }),
        stockEntries: await prisma.invStockLedger.findMany({
            where:   { universalVoucherId: voucherRow.universalVoucherId ?? -1 },
            include: { product: { select: { id: true, sku: true, name: true } } },
        }),
    };

    // G4b: tender + charge input comes from settlementJson now. Re-shape it into
    // the `tenders` / `charges` arrays (with account id/name/code) the edit form
    // already consumes, so the form's edit-mode hydration is unchanged.
    const settlement = readSettlement(voucher.settlementJson);
    const acctIds = [...new Set([...settlement.tenders, ...settlement.charges].map((r) => r.accountId))];
    const acctById = new Map(
        (acctIds.length === 0 ? [] : await prisma.account.findMany({ where: { id: { in: acctIds } }, select: { id: true, name: true } }))
            .map((a) => [a.id, a]),
    );
    const withAccount = <T extends { accountId: number }>(r: T) => ({ ...r, account: acctById.get(r.accountId) ?? null });

    // 5D-2: resolve the creator's name from the spine's createdById.
    const creator = voucher.universalVoucher?.createdById != null
        ? await prisma.user.findUnique({ where: { id: voucher.universalVoucher.createdById }, select: { name: true } })
        : null;

    // A POS sale's own counter — its till + payment accounts — so an edit can
    // re-take the payment against the counter the sale was rung on, whoever
    // edits it and wherever (PATCH `posPayments`).
    const posShiftId = voucher.universalVoucher?.type === "POS" ? voucher.universalVoucher.sourceShiftId : null;
    const posCounter = posShiftId == null ? null : (await prisma.posShift.findUnique({
        where:  { id: posShiftId },
        select: {
            counter: {
                select: {
                    id: true, name: true, tillAccountId: true,
                    paymentAccounts: {
                        where:   { isActive: true },
                        orderBy: { sortOrder: "asc" },
                        select:  { id: true, channel: true, label: true, accountId: true, vpa: true, defaultVisible: true, account: { select: { id: true, name: true } } },
                    },
                },
            },
        },
    }))?.counter ?? null;

    // Derive party display fields from the frozen snapshot so the detail page +
    // form edit-load keep reading partyName / partyPhone / partyAddress.
    return NextResponse.json({
        ...voucher,
        // 5D-6/5D-11/5D-12: the user-facing number + type + branch come from the spine now.
        type:         voucher.universalVoucher?.type,
        // 5D-10/5D-5: the document's own date + narration text. Surfaced here so
        // edit-load and the detail page show what was SAVED, not today's date.
        date:         voucher.universalVoucher?.date ?? null,
        description:  voucher.universalVoucher?.description ?? "",
        narration:    voucher.universalVoucher?.narration ?? null,
        postedAt:     voucher.universalVoucher?.postedAt ?? null,
        branchId:     voucher.universalVoucher?.branchId ?? null,
        // Lifecycle also lives on the spine now — VoucherDetail itself carries
        // none of these, so without surfacing them here the edit form's
        // `v.status`/`v.cancelledAt` reads always came back
        // undefined (posted-vs-draft never detected; CANCELLED never caught).
        status:       voucher.universalVoucher?.status ?? null,
        cancelledAt:  voucher.universalVoucher?.cancelledAt ?? null,
        // 5D-4: the canonical party ledger lives on the spine — surface it as
        // `accountId` so edit-mode hydration (POS screen, forms) can load the customer.
        accountId:    voucher.universalVoucher?.partyAccountId ?? null,
        branch:       voucher.universalVoucher?.branch ?? null,
        reference:    voucherDisplayNo(voucher.universalVoucher?.voucherNo, voucher.universalVoucherId),
        refVoucher:   voucher.refVoucher ? { id: voucher.refVoucher.id, type: voucher.refVoucher.universalVoucher?.type, reference: voucherDisplayNo(voucher.refVoucher.universalVoucher?.voucherNo, voucher.refVoucher.universalVoucher?.id) } : null,
        createdBy:    creator,
        tenders:      settlement.tenders.map(withAccount),
        charges:      settlement.charges.map(withAccount),
        posCounter,
        partyName:    readPartyName(voucher.partyJson),
        partyPhone:   readPartyPhone(voucher.partyJson),
        partyAddress: readPartyAddress(voucher.partyJson),
    });
}

// PATCH /api/inventory/vouchers/[id]
//
// Two modes, decided by the source's status:
//
//   • DRAFT  — straightforward field/lines update. No stock or GL was ever
//              moved, so no reversal needed.
//
//   • POSTED — Tally-style in-place edit. The voucher REFERENCE is preserved
//              (it's the same row); behind the scenes the transaction:
//                1. reverses the original stock ledger entries + cached
//                   InvProduct.stock,
//                2. posts a reversal JE for the linked Journal Entry and
//                   marks the original JE as CANCELLED (audit trail kept),
//                3. replaces the voucher header + line items with the new
//                   values,
//                4. re-runs stock posting + GL posting from scratch on the
//                   updated lines, linking the voucher to the new JE.
//              Stock and GL end up reflecting the new values; the JE list
//              shows the original / reversal / replacement chain.
//
//   • CANCELLED / DELETED — 409, since the voucher isn't a valid edit target.
//
// Same /[id], same ref number, same row.
export async function PATCH(req: Request, { params }: Params) {
    const { response, user } = await requireAuth();
    if (response) return response;

    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const existing = await prisma.voucherDetail.findUnique({ where: { id }, include: { universalVoucher: { select: { voucherNo: true, status: true, type: true, date: true, partyAccountId: true, sourceShiftId: true } } } });   // 5D-6/5D-8/5D-11
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Phase 5 5C: capture old line product ids (goods hang off the spine) for the
    // after-commit pricing recompute — the lines themselves are rewritten below.
    const existingLineProductIds = (await prisma.voucherInventoryLine.findMany({
        where: { universalVoucherId: existing.universalVoucherId ?? -1 }, select: { productId: true },
    })).map((l) => l.productId);
    if (existing.universalVoucher?.status === "CANCELLED") {
        return NextResponse.json({ error: "Voucher is cancelled — use Duplicate to create a fresh copy." }, { status: 409 });
    }
    // "Who can cancel can edit" — the kind's Cancel / edit tick, draft or posted,
    // the same rule the GL voucher edit applies. POS Sale / Order / Estimate ride
    // their POS-table row (userCanActOnVoucher).
    if (!userCanActOnVoucher(user, existing.universalVoucher?.type ?? "", "cancel")) {
        return NextResponse.json({ error: "You do not have permission to edit this voucher kind." }, { status: 403 });
    }

    const body = await req.json();
    const {
        date,
        description,
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
        branchId: bodyBranchId,
        showPrices,
        shippingAmt,
        roundOff,
        discountPct,
        discountAmt,
        lines,
        charges,
        services,
        tenders: bodyTenders,
        posPayments,
    } = body as {
        date?:             string;
        description?:      string;
        partyName?:        string;
        partyType?:        string;
        partyId?:          number;
        partyPhone?:       string;
        partyAddress?:     string;
        creditPeriodDays?: number | null;
        refNumber?:        string;
        refDate?:          string;
        /// Parent voucher (e.g. PO for a GRN); null clears the link.
        refVoucherId?:     number | null;
        /// MANUFACTURING_JOURNAL only — optional FK to InvBom.
        bomId?:            number | null;
        /// BRANCH_TRANSFER only — destination branch.
        destinationBranchId?: string | null;
        /// Source branch (read-only for posted edits; only DRAFT allows change).
        branchId?:         string;
        /// Challan-only: persist print-price visibility.
        showPrices?:       boolean;
        shippingAmt?:      number;
        roundOff?:         number;
        discountPct?:      number;
        discountAmt?:      number;
        lines?: {
            productId:    number;
            description?: string;
            quantity:     number;
            freeQty?:     number;
            rate?:        number;
            /// MRP/barcode snapshots in paise, preserved across edits so the
            /// customer-facing ladder still shows the original tag/struck MRP.
            mrpPaise?: number | null;
            savedSalePricePaise?: number | null;
            discountPct?: number;
            discountAmt?: number;
            taxRate?:     number;
            direction?:   "CONSUME" | "PRODUCE";
        }[];
        charges?: {
            accountId:    number;
            description?: string;
            amount:       number;
            /// GST on a tax-bearing charge (a service row) — preserved through
            /// the edit round-trip so the re-post keeps its tax legs.
            taxAmount?:   number;
        }[];
        /// Service lines, re-resolved from the catalogue exactly as on create
        /// (POST /api/inventory/vouchers). Sent alongside `charges`, never
        /// inside it: the browser may change WHICH service and HOW MANY, never
        /// which ledger or what GST — those are read here.
        services?: {
            serviceId:    number;
            quantity:     number;
            unitPrice:    number;
            description?: string;
        }[];
        tenders?: {
            accountId: number;
            amount:    number;
            method?:   "CASH" | "BANK_TRANSFER" | "CARD" | "CHEQUE" | "MOBILE_PAYMENT" | "OTHER";
            reference?: string;
        }[];
        /// POS sale only — the checkout's payments re-taken on an edit, in the
        /// till's own shape (paymentAccountId null = cash). Resolved below
        /// against the sale's OWN counter into `tenders`; never sent with them.
        posPayments?: CounterPayment[];
    };

    const isPhysicalStock = existing.universalVoucher?.type === "PHYSICAL_STOCK";
    const isManufacturingJournal = existing.universalVoucher?.type === "MANUFACTURING_JOURNAL";
    const isBranchTransfer = existing.universalVoucher?.type === "BRANCH_TRANSFER";

    // ── Service lines → tax-bearing charge rows ───────────────────────────
    // Re-resolved from the catalogue on every save, exactly as on create, so an
    // edit can never smuggle in a ledger or a GST rate the browser chose.
    const voucherType = existing.universalVoucher?.type ?? "";
    if (services !== undefined && services.length > 0 && !SERVICE_VOUCHER_TYPES.has(voucherType)) {
        return NextResponse.json({ error: "This voucher type does not carry service lines." }, { status: 400 });
    }
    const resolvedServices = await resolveServiceCharges(prisma, services ?? []);
    if (!resolvedServices.ok) {
        return NextResponse.json({ error: resolvedServices.error, code: resolvedServices.code }, { status: 422 });
    }
    // What the charges section becomes after this PATCH. `undefined` on BOTH
    // arrays means the caller said nothing about charges, so the stored ones
    // stand; an empty array clears its own half. Services always rewrite the
    // service rows wholesale — the form sends every one it is showing.
    const existingCharges = readSettlement(existing.settlementJson).charges;
    const chargesTouched = charges !== undefined || services !== undefined;
    const effectiveCharges = chargesTouched
        ? [
            ...(charges !== undefined ? charges : existingCharges.filter((c) => c.serviceId == null)),
            ...(services !== undefined ? resolvedServices.charges : existingCharges.filter((c) => c.serviceId != null)),
        ]
        : existingCharges;

    // Preserve the sale's original MRP/barcode snapshots across an edit even if
    // the client omits them on a partial save. This keeps the ladder/receipt
    // display consistent after the voucher is rewritten.
    const existingLineSnapshot = lines?.length
        ? await prisma.voucherInventoryLine.findMany({
            where: { universalVoucherId: existing.universalVoucherId ?? -1 },
            select: { productId: true, mrpPaise: true, savedSalePricePaise: true },
        })
        : [];
    const existingLineByProduct = new Map(existingLineSnapshot.map((l) => [l.productId, l]));
    const productIds = [...new Set((lines ?? []).map((l) => l.productId))];
    const productMeta = productIds.length > 0
        ? await prisma.invProduct.findMany({
            where: { id: { in: productIds } },
            select: { id: true, mrpPaise: true, savedSalePricePaise: true },
        })
        : [];
    const productMetaById = new Map(productMeta.map((p) => [p.id, p]));

    // Recompute totals if lines provided.
    let totals: { subtotal: number; taxAmount: number; totalAmount: number } | undefined;
    let computedLines: ({
        productId: number; description?: string; note?: string | null; quantity: number; freeQty?: number; rate: number;
        mrpPaise?: number | null; savedSalePricePaise?: number | null; discountPct?: number; discountAmt: number; taxRate?: number; taxAmount: number; amount: number;
        direction?: "CONSUME" | "PRODUCE";
    })[] | undefined;
    // Tax-INCLUSIVE bill discount actually applied (clamped to the bill) — what
    // gets stored. Stays 0 when this PATCH doesn't touch the lines.
    let billDiscIncl = 0;

    // `lines` absent = this PATCH isn't touching the items. An EMPTY ARRAY is a
    // different statement — "this voucher now has no items" — and must be obeyed,
    // exactly as POST already allows a sale/purchase carrying only charge rows.
    // Reading `[]` as "leave the lines alone" silently kept the old line while
    // the new charge was added on top, so the re-posted JE no longer matched the
    // payment rows and the whole edit was refused. It also made the last item on
    // an invoice impossible to delete from the form.
    if (lines) {
        computedLines = lines.map((l) => {
            const rate = l.rate ?? 0;
            const oldLine = existingLineByProduct.get(l.productId);
            const productLine = productMetaById.get(l.productId);
            const mrpPaise = l.mrpPaise ?? oldLine?.mrpPaise ?? productLine?.mrpPaise ?? null;
            const savedSalePricePaise = l.savedSalePricePaise ?? oldLine?.savedSalePricePaise ?? productLine?.savedSalePricePaise ?? null;
            if (isPhysicalStock || isBranchTransfer) {
                return { ...l, rate: 0, mrpPaise, savedSalePricePaise, discountAmt: 0, taxAmount: 0, amount: 0 };
            }
            if (isManufacturingJournal) {
                return { ...l, rate, mrpPaise, savedSalePricePaise, discountAmt: 0, taxAmount: 0, amount: l.quantity * rate };
            }
            const { discountAmt: lineDiscountAmt, taxAmount, amount } = calcLineTotals({
                quantity:    l.quantity,
                rate,
                discountPct: l.discountPct ?? 0,
                discountAmt: l.discountAmt ?? 0,
                taxRate:     l.taxRate    ?? 0,
            });
            return { ...l, rate, mrpPaise, savedSalePricePaise, discountAmt: lineDiscountAmt, taxAmount, amount };
        });
        // Tax-bearing charges (services) count at GROSS — net + their GST —
        // mirroring /api/pos/sale, so totalAmount still balances the re-posted JE.
        // Reads the EFFECTIVE list, not the request's: a PATCH that rewrites the
        // items without mentioning charges used to drop every stored charge out
        // of the total while leaving it in settlementJson, so the re-posted JE
        // and the payment rows disagreed by exactly the charge.
        const chargesNet = chargesNetTotal(effectiveCharges);
        // ── Bill-level discount → subtracted AFTER tax ──────────────────────
        // Same treatment as POST /api/inventory/vouchers (see the note there):
        // a LINE discount reduces the taxable value, the HEADER discount comes
        // off the tax-inclusive bottom line. Clamped so an over-typed discount
        // can't drive totalAmount negative.
        const lineSubtotal = computedLines.reduce((s, l) => s + l.amount, 0);
        const requested    = discountAmt ?? (existing.discountAmt != null ? Number(existing.discountAmt) : 0);
        billDiscIncl = round2(Math.min(Math.max(0, requested), lineSubtotal));
        totals = calcVoucherTotals(
            computedLines,
            shippingAmt ?? Number(existing.shippingAmt),
            billDiscIncl,
            roundOff    ?? Number(existing.roundOff),
            chargesNet,
        );
    }

    // ── POS sale re-saved with its payments re-taken ─────────────────────
    // The same routing a fresh sale gets (resolveCounterPayments): cash → the
    // till of the counter the sale was RUNG on (its shift), UPI / card → that
    // counter's account ledgers. A gift card drawn at the sale stays as it was;
    // whatever is not collected rides the customer's ledger (on credit). The
    // re-post then moves the till and the shift's figures like any sale.
    let tenders = bodyTenders;
    if (posPayments !== undefined) {
        if (existing.universalVoucher?.type !== "POS") {
            return NextResponse.json({ error: "Only a POS sale takes counter payments." }, { status: 400 });
        }
        const shiftId = existing.universalVoucher.sourceShiftId;
        const counter = shiftId == null ? null : (await prisma.posShift.findUnique({
            where:  { id: shiftId },
            select: { counter: { select: { tillAccountId: true, paymentAccounts: { select: { id: true, channel: true, accountId: true } } } } },
        }))?.counter;
        if (!counter) {
            return NextResponse.json({ error: "This sale has no counter shift, so its payments can't be re-taken here." }, { status: 422 });
        }
        const resolved = resolveCounterPayments(posPayments, counter.tillAccountId, new Map(counter.paymentAccounts.map((a) => [a.id, a])));
        if (!resolved) {
            return NextResponse.json({ error: "That payment account isn't on the counter this sale was rung on.", code: "PAYMENT_METHOD_NOT_MAPPED" }, { status: 422 });
        }
        const keptGiftCards = readSettlement(existing.settlementJson).tenders.filter((t) => isGiftCardTender(t));
        const billTotal = totals?.totalAmount ?? Number(existing.totalAmount);
        const paid = [...resolved, ...keptGiftCards].reduce((s, t) => s + t.amount, 0);
        const onCredit = round2(billTotal - paid);
        if (onCredit < -0.01) {
            return NextResponse.json({ error: `Payments (₹${paid.toFixed(2)}) are more than the bill (₹${billTotal.toFixed(2)}). Return the change.` }, { status: 422 });
        }
        const partyAccountId = existing.universalVoucher.partyAccountId;
        if (onCredit > 0.005 && partyAccountId == null) {
            return NextResponse.json({ error: "Part of this bill is unpaid, but the sale has no customer account to carry it." }, { status: 422 });
        }
        tenders = [
            ...resolved,
            ...keptGiftCards.map((t) => ({ accountId: t.accountId, amount: t.amount, method: t.method ?? undefined, reference: t.reference ?? undefined })),
            ...(onCredit > 0.005 && partyAccountId != null ? [{ accountId: partyAccountId, amount: onCredit }] : []),
        ];
    }

    // The payment rows must still add up AFTER the edit. This PATCH may change
    // the lines (and so the total) while saying nothing about tenders, in which
    // case the existing ones stand — and a voucher whose goods moved but whose
    // money did not is exactly the state that used to be saved in silence. Same
    // rule as POST, same function, checked before anything is written.
    const effectiveTenders = tenders !== undefined
        ? tenders
        : readSettlement(existing.settlementJson).tenders;
    // A paisa between the total and the payment rows is rounding — it goes on
    // the voucher's own Round Off, exactly as POST does (see tenderPaisaDrift).
    const drift = tenderPaisaDrift(effectiveTenders, totals?.totalAmount ?? Number(existing.totalAmount));
    const roundOffToSave = drift !== 0
        ? round2((roundOff ?? Number(existing.roundOff)) + drift)
        : roundOff;
    if (drift !== 0) {
        const base = totals ?? {
            subtotal:    Number(existing.subtotal),
            taxAmount:   Number(existing.taxAmount),
            totalAmount: Number(existing.totalAmount),
        };
        totals = { ...base, totalAmount: round2(base.totalAmount + drift) };
    }
    const effectiveTotal = totals?.totalAmount ?? Number(existing.totalAmount);
    const tenderComplaint = tenderCoverageComplaint(effectiveTenders, effectiveTotal);
    if (tenderComplaint) return NextResponse.json({ error: tenderComplaint }, { status: 400 });

    const wasPosted = existing.universalVoucher?.status === "POSTED";   // 5D-8
    const userId = user!.id;

    // POSTED edits on PHYSICAL_STOCK / MANUFACTURING_JOURNAL aren't supported
    // yet — Phase-1 reversal + Phase-3 re-post code paths below only cover
    // trading vouchers. Direct the user to cancel + create a new draft.
    if (wasPosted && (isPhysicalStock || isManufacturingJournal || isBranchTransfer)) {
        const niceLabel = isPhysicalStock ? "Physical Stock"
            : isManufacturingJournal ? "Manufacturing Journal"
            : "Branch Transfer";
        return NextResponse.json(
            { error: `Cannot edit a posted ${niceLabel} voucher. Cancel it and create a new one instead.` },
            { status: 409 },
        );
    }

    try {
        const updated = await prisma.$transaction(async (tx) => {
            // POSTED edits run reverse + apply + re-post in one tx. Each phase
            // walks every line + posts a JE, so the default 5s ceiling is
            // tight. 30s gives plenty of headroom on slow dev machines.
            // ────────────────────────────────────────────────────────────
            // PHASE 1 — Reverse the existing posting (POSTED only)
            // ────────────────────────────────────────────────────────────
            if (wasPosted) {
                // Phase 4 ②: snapshot the pre-edit state to AuditLog, then reapply
                // IN PLACE in Phase 3 (rewrite the SAME JE + replace stock rows +
                // recompute caches). No reversal JE, no counter stock entries — the
                // voucher and its journalEntryId are preserved, so receipts
                // allocated against the JE stay linked.
                const origJe = existing.universalVoucherId
                    ? await tx.universalVoucher.findUnique({ where: { id: existing.universalVoucherId }, include: { lines: true } })
                    : null;
                const oldSnapRow = await tx.voucherDetail.findUnique({ where: { id } });
                const oldSnap = oldSnapRow ? {
                    ...oldSnapRow,
                    lines: await tx.voucherInventoryLine.findMany({ where: { universalVoucherId: existing.universalVoucherId ?? -1 } }),
                } : null;
                await tx.auditLog.create({
                    data: auditSnapshot({
                        entityType:  "INV_VOUCHER",
                        subtype:     existing.universalVoucher?.type ?? null,
                        originalId:  existing.id,
                        originalRef: existing.universalVoucher?.voucherNo ?? "",
                        reason:      `Edit (in-place) of ${existing.universalVoucher?.voucherNo ?? ""}`,
                        action:      PRE_EDIT_ACTION,
                        snapshot:    { ...oldSnap, journalEntry: origJe },
                        actorId:     userId,
                    }),
                });
            }

            // ────────────────────────────────────────────────────────────
            // PHASE 2 — Apply the user's edits (header + lines)
            // ────────────────────────────────────────────────────────────
            if (computedLines) {
                await tx.voucherInventoryLine.deleteMany({ where: { universalVoucherId: existing.universalVoucherId ?? -1 } });
            }
            // G4b: tender + charge input lives in settlementJson now. A PATCH may
            // touch either section independently (undefined = leave as-is), so
            // merge the provided arrays over the existing settlement and rewrite
            // the column below. An empty array clears that section.
            const existingSettlement = readSettlement(existing.settlementJson);
            const settlementChanged = chargesTouched || tenders !== undefined;
            const newSettlementJson = settlementChanged
                ? buildSettlementJson(
                    tenders !== undefined ? tenders : existingSettlement.tenders,
                    effectiveCharges,
                )
                : undefined;
            // The (possibly updated) party's ledger, resolved through any
            // conversion / merge forwarding note — an old bill re-saved from the
            // editor still names the converted-away id, and must keep posting to
            // the survivor rather than lose its party ledger.
            const patchAccountId = await resolvePartyAccountId(tx, { partyType: partyType ?? null, partyId: partyId ?? null });
            // Status stays POSTED for posted edits; the re-post below sets a
            // fresh journalEntryId. For draft edits the row is unchanged.
            await tx.voucherDetail.update({
                where: { id },
                data: {
                    // 5D-5/5D-10: description + date live on the spine (updated below).
                    // Party display fields move together as one frozen snapshot.
                    ...(partyName !== undefined || partyPhone !== undefined || partyAddress !== undefined
                        ? { partyJson: buildPartyJson({ name: partyName, phone: partyPhone, address: partyAddress }) ?? Prisma.DbNull }
                        : {}),
                    ...(partyType        !== undefined ? { partyType:        partyType        || null } : {}),
                    ...(partyId          !== undefined ? { partyId:          partyId          || null } : {}),
                    // 5D-4: the canonical party ledger (partyAccountId) lives on the spine (updated below).
                    ...(creditPeriodDays  !== undefined ? { creditPeriodDays:  creditPeriodDays ?? null } : {}),
                    ...(refNumber        !== undefined ? { refNumber:        refNumber        || null } : {}),
                    ...(refDate          !== undefined ? { refDate:          refDate ? new Date(refDate) : null } : {}),
                    ...(refVoucherId     !== undefined ? { refVoucherId:     refVoucherId ?? null } : {}),
                    ...(bomId            !== undefined ? { bomId:            bomId ?? null } : {}),
                    // 5D-12: primary branch lives on the spine (updated below).
                    ...(destinationBranchId !== undefined ? { destinationBranchId: destinationBranchId ?? null } : {}),
                    ...(showPrices       !== undefined ? { showPrices }                              : {}),
                    ...(shippingAmt      !== undefined ? { shippingAmt }     : {}),
                    ...(roundOffToSave   !== undefined ? { roundOff: roundOffToSave } : {}),
                    ...(discountPct      !== undefined ? { discountPct }     : {}),
                    // Clamped to the bill when the lines were recomputed, so an
                    // over-discount can't drive totalAmount negative.
                    ...(discountAmt      !== undefined
                        ? { discountAmt: computedLines ? (billDiscIncl > 0 ? billDiscIncl : null) : discountAmt }
                        : {}),
                    ...(totals ? totals : {}),
                    ...(newSettlementJson !== undefined ? { settlementJson: newSettlementJson } : {}),
                },
            });
            // 5D-4/5D-5/5D-10/5D-12: date + description + party ledger + branch live on the spine.
            if (existing.universalVoucherId != null) {
                // Editing the date is the one way past the guard in the engine,
                // so it is checked again here on the value actually written.
                if (date) await assertVoucherDate(tx, new Date(date));
                const spinePatch: Prisma.UniversalVoucherUncheckedUpdateInput = {
                    ...(date        ? { date: new Date(date) } : {}),
                    ...(description ? { description: description.trim() } : {}),
                    ...(partyId !== undefined ? { partyAccountId: patchAccountId } : {}),
                    ...(bodyBranchId !== undefined && !wasPosted ? { branchId: bodyBranchId } : {}),
                };
                if (Object.keys(spinePatch).length > 0) {
                    await tx.universalVoucher.update({ where: { id: existing.universalVoucherId }, data: spinePatch });
                }
            }
            // Phase 5 5C: rewrite the goods lines on the spine (deleted above).
            // An empty list is legitimate (a charge-only sale) — there is simply
            // nothing to write back.
            if (computedLines?.length) {
                await tx.voucherInventoryLine.createMany({
                    data: computedLines.map((l) => ({
                        universalVoucherId: existing.universalVoucherId!,
                        productId:   l.productId,
                        description: l.description || null,
                        note:        cleanLineNote(l.note),
                        direction:   isManufacturingJournal ? l.direction ?? null : null,
                        quantity:    l.quantity,
                        freeQty:     l.freeQty ?? null,
                        rate:        l.rate,
                        mrpPaise:    l.mrpPaise ?? null,
                        savedSalePricePaise: l.savedSalePricePaise ?? null,
                        discountPct: l.discountPct ?? 0,
                        discountAmt: l.discountAmt,
                        taxRate:     l.taxRate    ?? 0,
                        taxAmount:   l.taxAmount,
                        amount:      l.amount,
                    })),
                });
            }

            // ────────────────────────────────────────────────────────────
            // PHASE 3 — Reapply IN PLACE (POSTED only)
            // ────────────────────────────────────────────────────────────
            if (wasPosted) {
                const freshRow = await tx.voucherDetail.findUnique({ where: { id }, include: { universalVoucher: { select: { date: true, type: true, branchId: true } } } });   // 5D-10 date + 5D-11 type + 5D-12 branch
                if (!freshRow) throw new Error("Voucher disappeared mid-transaction");
                // Phase 5 5C: goods lines hang off the spine. 5D-10/11/12: date + type +
                // branch from the spine drive saleToSpec (GL/stock mapping) + the ledger rows.
                const fresh = {
                    ...freshRow,
                    date: freshRow.universalVoucher!.date,
                    type: freshRow.universalVoucher!.type,
                    branchId: freshRow.universalVoucher!.branchId ?? "",
                    lines: await tx.voucherInventoryLine.findMany({
                        where:   { universalVoucherId: freshRow.universalVoucherId ?? -1 },
                        include: { product: { select: { id: true, mrpPaise: true, stock: true } } },
                    }),
                };

                // Tenders + charges (settlementJson) flow into saleToSpec — one GL
                // leg per row. Rewrite the SAME JE in place + replace stock rows +
                // recompute the caches from truth (no reversal, no re-minted JE —
                // journalEntryId is preserved so receipts allocated against it stay linked).
                const freshSettlement = readSettlement(fresh.settlementJson);
                await reapplyTradingVoucherInPlace(tx, {
                    voucher:        { ...fresh, tenders: freshSettlement.tenders, charges: freshSettlement.charges } as unknown as PostVoucherInput["voucher"],
                    branchId:       fresh.branchId,
                    lines:          fresh.lines,
                    journalEntryId: existing.universalVoucherId,
                    previousDate:   existing.universalVoucher?.date ?? fresh.date,
                });
                // G4d: reapply resyncs the spine (delete + re-mirror → new spine id);
                // refresh the direct link so InvVoucher.universalVoucherId stays valid.
                const newSpine = existing.universalVoucherId != null
                    ? await tx.universalVoucher.findUnique({ where: { id: existing.universalVoucherId }, select: { id: true } })   // 5D-16: spine id directly (was sourceJournalEntryId self-ref)
                    : null;
                await tx.voucherDetail.update({ where: { id }, data: { universalVoucherId: newSpine?.id ?? null } });   // 5D-5: postedAt on spine
                // Phase 5 5C: link the rewritten stock rows (+ any new goods lines) to the spine.
            }

            const updatedRow = await tx.voucherDetail.findUnique({
                where: { id },
                include: { universalVoucher: { select: { createdById: true } } },   // 5D-2: creator on spine
            });
            const creator = updatedRow?.universalVoucher?.createdById != null
                ? await tx.user.findUnique({ where: { id: updatedRow.universalVoucher.createdById }, select: { name: true } })
                : null;
            // Phase 5 5C: goods lines hang off the spine.
            return updatedRow ? {
                ...updatedRow,
                createdBy: creator,
                lines: await tx.voucherInventoryLine.findMany({
                    where:   { universalVoucherId: updatedRow.universalVoucherId ?? -1 },
                    include: { product: { select: { id: true, sku: true, name: true } } },
                }),
            } : null;
        }, { timeout: 30_000, maxWait: 10_000 });

        // After-commit pricing recompute — union of old lines (just reversed)
        // and new lines (just posted). Both sets can affect cost basis.
        const touchedProductIds = new Set<number>();
        for (const pid of existingLineProductIds) touchedProductIds.add(pid);
        for (const l of computedLines ?? []) touchedProductIds.add(l.productId);
        // Pricing-cache refresh is not part of this answer - defer it past the
        // response with after() (reliable on serverless, unlike a bare
        // fire-and-forget) so nobody waits on a cost-ledger walk.
        after(async () => {
            await recomputePricesForProducts([...touchedProductIds]).catch((err: unknown) => {
                Sentry.captureException(err, { tags: { source: "price-recompute", voucherId: String(id) } });
                console.error("[price-recompute] failed for voucher", id, err);
            });
        });

        return NextResponse.json(updated);
    } catch (e) {
        // A voucher whose ledger entry cannot be built is the user's to fix (the
        // payment rows do not add up), not a server fault — show it as it is.
        if (e instanceof GlBuildError) return NextResponse.json({ error: e.message }, { status: 422 });
        return handleApiError(e, "Failed to update voucher");
    }
}

// DELETE /api/inventory/vouchers/[id]  — only allowed on DRAFT
export async function DELETE(_req: Request, { params }: Params) {
    const { response, user } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const existing = await prisma.voucherDetail.findUnique({ where: { id: Number(id) }, include: { universalVoucher: { select: { status: true, type: true } } } });   // 5D-8
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.universalVoucher?.status !== "DRAFT") {
        return NextResponse.json({ error: "Only DRAFT vouchers can be deleted via this route. Use /cancel or /delete for lifecycle." }, { status: 409 });
    }
    // Same Delete tick as hard-delete — a POS Estimate flipped to Draft from the
    // register must not become a way round it (and this removal skips the Recycle Bin).
    if (!userCanActOnVoucher(user, existing.universalVoucher?.type ?? "", "delete")) {
        return NextResponse.json({ error: "You do not have permission to delete this voucher kind." }, { status: 403 });
    }
    await prisma.voucherInventoryLine.deleteMany({ where: { universalVoucherId: existing.universalVoucherId ?? -1 } });
    await prisma.voucherDetail.delete({ where: { id: Number(id) } });
    return NextResponse.json({ ok: true });
}
