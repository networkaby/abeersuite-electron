import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { readPartyName, readPartyPhone, readPartyAddress } from "@/shared/lib/accountancy/partySnapshot";
import { canConvert } from "@/modules/accountancy/lib/convertMap";
import { editFormUrl } from "@/modules/inventory/lib/voucherFormUrls";

// POST /api/inventory/vouchers/[id]/convert   body: { targetKind }
//
// Generic voucher conversion — accountancy only, NO pipeline. Creates the target
// document of `targetKind` from the source (party + lines + discounts), links it
// back via refVoucherId, and POSTS it so the conversion is real (not a draft):
// GL invoices (Sale / Purchase) settle to the party ON CREDIT; orders / estimates
// / GRN / challan issue. POS sales are redirected to the till (can't auto-post a
// counter sale). Returns the new voucher's URL + { posted, warning }.
//
// Non-consuming: the source voucher is left completely untouched — no status
// change, no lock — so it can be converted again. Independence: the link is a
// nullable back-reference on the CREATED voucher (SetNull on delete), so keeping
// or deleting either side never affects the other's data.
//
// The DRAFT is created by delegating to the existing trading-voucher create route
// (internal call, cookie forwarded) so numbering / GST / spine wiring are reused
// verbatim — this route never re-implements voucher creation.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { response } = await requireAuth();
        if (response) return response;

        const { id } = await params;
        const sourceId = Number(id);
        if (!Number.isInteger(sourceId) || sourceId < 1) {
            return NextResponse.json({ error: "Invalid voucher id" }, { status: 400 });
        }

        const body = (await req.json().catch(() => ({}))) as { targetKind?: string };
        const targetKind = (body.targetKind ?? "").trim();
        if (!targetKind) return NextResponse.json({ error: "targetKind is required" }, { status: 400 });

        const source = await prisma.voucherDetail.findUnique({
            where: { id: sourceId },
            select: {
                id: true,
                partyJson: true, partyType: true, partyId: true,
                discountPct: true, discountAmt: true, shippingAmt: true, roundOff: true, totalAmount: true,
                universalVoucherId: true,
                universalVoucher: { select: { type: true, voucherNo: true, branchId: true, partyAccountId: true, description: true } },
            },
        });
        if (!source) return NextResponse.json({ error: "Voucher not found" }, { status: 404 });

        const sourceKind = source.universalVoucher?.type ?? "";
        if (!canConvert(sourceKind, targetKind)) {
            return NextResponse.json({ error: `Cannot convert ${sourceKind || "this voucher"} to ${targetKind}.` }, { status: 422 });
        }

        // POS sale can't be auto-posted — a counter sale is rung up at the till
        // (payment + shift); the generic post would leave an EMPTY posted POS (no
        // stock, no GL). Direct the caller to the till instead of faking it.
        if (targetKind === "POS") {
            return NextResponse.json(
                { error: "A POS sale must be rung up at the till.", till: true },
                { status: 400 },
            );
        }

        // Restrict double conversion — block if a LIVE voucher already references
        // this source. Soft-deleting / cancelling that target drops the count to 0,
        // which re-opens conversion (per "delete the conversion → allow again").
        const liveTargets = await prisma.voucherDetail.count({
            where: {
                refVoucherId:     sourceId,
                universalVoucher: { deletedAt: null, status: { not: "CANCELLED" } },
            },
        });
        if (liveTargets > 0) {
            return NextResponse.json(
                { error: "Already converted. Delete the converted voucher to convert this again." },
                { status: 409 },
            );
        }

        // Goods lines hang off the spine (Phase 5 5C).
        const lines = await prisma.voucherInventoryLine.findMany({
            where:  { universalVoucherId: source.universalVoucherId ?? -1 },
            select: { productId: true, description: true, quantity: true, rate: true, taxRate: true, mrpPaise: true, discountPct: true },
        });
        if (lines.length === 0) {
            return NextResponse.json({ error: "Source voucher has no lines to convert." }, { status: 400 });
        }

        // Posting policy: GL invoices (Sale / Purchase) settle to the party ON
        // CREDIT — carry an AR/AP tender for the full total so the post builds the
        // GL (the party owes it until a receipt/payment lands). Documents (orders /
        // estimates / GRN / challan) post with no tender. Carrying the source's
        // discount + total means the created total matches, so the tender balances.
        const GL_INVOICE      = new Set(["SALE", "PURCHASE", "ONLINE_INVOICE"]);
        const needsTender     = GL_INVOICE.has(targetKind);
        const partyAccountId  = source.universalVoucher?.partyAccountId ?? null;
        const sourceTotal     = source.totalAmount != null ? Number(source.totalAmount) : 0;
        const tenders         = needsTender && partyAccountId ? [{ accountId: partyAccountId, amount: sourceTotal }] : [];

        // Narration: carry the source's narration onto the converted document,
        // tagged with the source reference so the trail is visible.
        const sourceRef       = source.universalVoucher?.voucherNo ?? `#${sourceId}`;
        const sourceNarration = (source.universalVoucher?.description ?? "").trim();
        const description     = sourceNarration
            ? `${sourceNarration} · Converted from ${sourceRef}`
            : `Converted from ${sourceRef}`;

        const today = new Date().toISOString().slice(0, 10);
        const cookie = req.headers.get("cookie") ?? "";
        // Carry percentage discounts only (they recompute identically); absolute
        // discounts are left for the operator to re-apply on the editable draft.
        const payload = {
            type:         targetKind,
            date:         today,
            description,
            branchId:     source.universalVoucher?.branchId ?? undefined,
            partyName:    readPartyName(source.partyJson) ?? undefined,
            partyType:    source.partyType ?? undefined,
            partyId:      source.partyId ?? undefined,
            partyPhone:   readPartyPhone(source.partyJson) ?? undefined,
            partyAddress: readPartyAddress(source.partyJson) ?? undefined,
            discountPct:  source.discountPct != null ? Number(source.discountPct) : undefined,
            discountAmt:  source.discountAmt != null ? Number(source.discountAmt) : undefined,
            shippingAmt:  source.shippingAmt != null ? Number(source.shippingAmt) : 0,
            roundOff:     source.roundOff != null ? Number(source.roundOff) : 0,
            refVoucherId: sourceId,
            tenders,
            lines: lines.map((l) => ({
                productId:   l.productId,
                description: l.description ?? undefined,
                quantity:    toNumber(l.quantity),
                rate:        toNumber(l.rate),
                taxRate:     toNumber(l.taxRate),
                mrpPaise:    l.mrpPaise ?? undefined,
                discountPct: l.discountPct != null ? Number(l.discountPct) : undefined,
            })),
        };

        const createRes = await fetch(new URL("/api/inventory/vouchers", req.url), {
            method:  "POST",
            headers: { "content-type": "application/json", cookie },
            body:    JSON.stringify(payload),
        });
        if (!createRes.ok) {
            const e = (await createRes.json().catch(() => ({}))) as { error?: string };
            return NextResponse.json({ error: e.error || "Could not create the converted voucher" }, { status: createRes.status });
        }
        const created = (await createRes.json()) as { id: number; reference?: string };

        // Post it so the conversion is real, not a draft. A GL invoice with no
        // party can't settle on credit → leave it a draft with a note; everything
        // else (credit invoice / issued order / GRN / challan) posts now.
        let posted = false;
        let warning: string | null = null;
        if (needsTender && !partyAccountId) {
            warning = "Created as a draft — attach a customer, then post it.";
        } else {
            const postRes = await fetch(new URL(`/api/inventory/vouchers/${created.id}/post`, req.url), {
                method: "POST", headers: { cookie },
            });
            if (postRes.ok) posted = true;
            else {
                const e = (await postRes.json().catch(() => ({}))) as { error?: string };
                warning = e.error || "Created, but posting failed — left as a draft.";
            }
        }

        return NextResponse.json({
            id:        created.id,
            reference: created.reference ?? null,
            editUrl:   editFormUrl(targetKind, created.id),
            posted,
            warning,
        });
    } catch (e) {
        return handleApiError(e, "Failed to convert voucher");
    }
}
