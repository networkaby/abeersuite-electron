import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { after } from "next/server";
import { requireAuth, userCanPostVoucher } from "@/shared/lib/auth/permissions";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import * as Sentry from "@sentry/nextjs";
import { handleApiError } from "@/shared/lib/api";
import {
    GlPostFailedError,
    classifyVoucherPost,
    postVoucherInTx,
    resolvePostGstStates,
    type PostableVoucher,
} from "@/modules/inventory/lib/postVoucherInTx";
import { CreditLimitError } from "@/shared/lib/accountancy/checkCreditLimit";

// POST /api/inventory/vouchers/[id]/post
//   1. Write InvStockLedger entries + update cached InvProduct.stock
//   2. Auto-create the GL entry via the Transaction Engine (trading kinds only)
//   3. Mark voucher as POSTED
//
// The work itself lives in `postVoucherInTx` — this route loads the draft, checks
// it may be posted, and hands it over. The create route runs the SAME function in
// the same transaction when a voucher is saved and posted in one go, so the two
// cannot drift.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response, user } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const userId = user!.id;

    // The voucher AND its goods lines in ONE query. The lines hang off the spine
    // (Phase 5 5C), and the spine is already being joined here, so asking for them
    // separately was a second round trip to Supabase for rows the first query could
    // have carried. `sku`/`name` come along too, so the response at the end does
    // not have to read the same rows a third time.
    const voucherRow = await prisma.voucherDetail.findUnique({
        where: { id: Number(id) },
        include: {
            // 5D-5 description + 5D-6 ref + 5D-8 status + 5D-10 date + 5D-11 type + 5D-12 branch(+state) live on the spine — needed for saleToSpec / messages / the DRAFT gate / stock rows / direction / the CGST/SGST-vs-IGST split.
            universalVoucher: {
                select: {
                    description: true, voucherNo: true, status: true, date: true, type: true,
                    // 5D-4: the party's ledger lives on the spine — the credit-limit
                    // check inside postVoucherInTx needs it to know whose credit is
                    // being used.
                    branchId: true, createdById: true, partyAccountId: true,
                    branch: { select: { id: true, gstStateCode: true } },
                    inventoryLines: {
                        orderBy: { id: "asc" },
                        include: { product: { select: { id: true, sku: true, name: true, mrpPaise: true, stock: true } } },
                    },
                },
            },
        },
    });
    // Phase 5 5C: goods lines hang off the spine — attach as `voucher.lines`.
    const goodsLines = voucherRow?.universalVoucher?.inventoryLines ?? [];
    // 5D-8/5D-11/5D-12: status + type + branch live on the spine — attach for the DRAFT gate + direction guards + stock rows.
    const voucher = voucherRow
        ? {
            ...voucherRow,
            lines:    goodsLines,
            type:     voucherRow.universalVoucher?.type ?? "",
            branchId: voucherRow.universalVoucher?.branchId ?? "",
            status:   voucherRow.universalVoucher?.status ?? "DRAFT",
            partyAccountId: voucherRow.universalVoucher?.partyAccountId ?? null,
        }
        : null;

    if (!voucher)                   return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (voucher.status !== "DRAFT") return NextResponse.json({ error: `Voucher is already ${voucher.status}` }, { status: 409 });

    // Per-kind post gate — a matrix kind needs its own Post tick; a POS Sale / Order /
    // Estimate draft needs its POS-row Create tick. Online variants pass through.
    if (!userCanPostVoucher(user, voucher.type)) {
        return NextResponse.json({ error: "You do not have permission to post this voucher kind." }, { status: 403 });
    }

    const { isBranchTransfer } = classifyVoucherPost(voucher.type);
    if (isBranchTransfer && !voucher.destinationBranchId) {
        return NextResponse.json({ error: "Branch Transfer is missing a destination branch — edit the draft and pick one." }, { status: 422 });
    }
    if (isBranchTransfer && voucher.destinationBranchId === voucher.branchId) {
        return NextResponse.json({ error: "Source and destination branches must differ." }, { status: 422 });
    }

    try {
        const { sellerStateCode, buyerStateCode } = await resolvePostGstStates(voucher as unknown as PostableVoucher);

        const { result, notes } = await prisma.$transaction(
            async (tx) => {
                const { universalVoucherId, notes: postNotes } = await postVoucherInTx(tx, {
                    voucher: voucher as unknown as PostableVoucher,
                    userId,
                    sellerStateCode,
                    buyerStateCode,
                });
                // The detail row is this route's — it already exists, and this links
                // it to the spine that was just posted. Posting does not own it.
                const updated = await tx.voucherDetail.update({
                    where: { id: voucher.id },
                    data:  { universalVoucherId },
                });
                // Posting does not change the goods lines, so the rows loaded before
                // the transaction are still the rows.
                return { result: { ...updated, lines: goodsLines }, notes: postNotes };
            },
            // Stock-ledger walk + GL post + the balance update are sequential round
            // trips; over the Supabase pooler this used to overrun the default 5s
            // interactive-transaction ceiling (P2028). Far fewer statements now, but
            // the headroom stays — a 200-line stock-take is still a long transaction.
            { timeout: 30_000, maxWait: 10_000 },
        );

        // The creator's name is only a display field on the response. It is a
        // different person from the poster whenever a draft is posted later by
        // someone else, so it cannot come from the session the way the create
        // route's can.
        const createdById = voucherRow?.universalVoucher?.createdById ?? null;
        const creator = createdById != null
            ? await prisma.user.findUnique({ where: { id: createdById }, select: { name: true } })
            : null;

        // Pricing recompute runs AFTER the response has gone. It is explicitly
        // non-critical — its own failure path says so — and it walks the cost ledger
        // and opens a second transaction, all of which the cashier was waiting
        // through for a number that is not on the bill they just printed.
        const touchedProductIds = voucher.lines.map((l) => l.productId);
        after(async () => {
            await recomputePricesForProducts(touchedProductIds).catch((err: unknown) => {
                Sentry.captureException(err, { tags: { source: "price-recompute", voucherId: String(voucher.id) } });
                console.error("[price-recompute] failed for voucher", voucher.id, err);
            });
        });

        return NextResponse.json({ ...result, createdBy: creator, _postNotes: notes });
    } catch (e) {
        if (e instanceof GlPostFailedError) {
            return NextResponse.json(
                { error: e.message, notes: e.notes },
                { status: 422 },
            );
        }
        // The draft asks the customer for more credit than they have left. The
        // draft stays a draft — collect something, or raise the limit.
        if (e instanceof CreditLimitError) {
            return NextResponse.json({ error: e.message, code: e.code, creditLimit: e.detail }, { status: 422 });
        }
        return handleApiError(e, "Failed to post voucher");
    }
}
