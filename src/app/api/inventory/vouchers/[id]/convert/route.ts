import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { readPartyName, readPartyPhone, readPartyAddress } from "@/shared/lib/accountancy/partySnapshot";
import { canConvert } from "@/modules/accountancy/lib/convertMap";
import { editFormUrl } from "@/modules/inventory/lib/voucherFormUrls";
import { businessTodayIso } from "@/shared/lib/format/formatDate";
import { convertSourceError } from "@/modules/pos/lib/convertSource";
import { readSettlement } from "@/shared/lib/accountancy/settlement";
import { SERVICE_VOUCHER_TYPES } from "@/shared/lib/accountancy/serviceCharges";
import { exactLineRate } from "@/modules/inventory/lib/voucherMath";

// POST /api/inventory/vouchers/[id]/convert   body: { targetKind }
//
// Generic voucher conversion — accountancy only, NO pipeline. Creates the target
// document of `targetKind` from the source (party + lines + discounts + services
// / charges), links it
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
                settlementJson: true,
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
        const convertErr = await convertSourceError(prisma, sourceId);
        if (convertErr) return NextResponse.json({ error: convertErr }, { status: 409 });

        // Goods lines hang off the spine (Phase 5 5C).
        const lines = await prisma.voucherInventoryLine.findMany({
            where:  { universalVoucherId: source.universalVoucherId ?? -1 },
            select: { productId: true, description: true, note: true, quantity: true, freeQty: true, rate: true, taxRate: true, mrpPaise: true, discountPct: true, discountAmt: true, amount: true },
        });

        // Service lines + "+ Add Account" rows ride settlementJson, not the goods
        // lines. Leaving them behind made the created total fall short of the
        // source total the credit tender below is sized to, and the create route
        // refused the save ("the payment rows come to …"). Carried only onto the
        // trade documents that take a charge — a Challan / GRN moves stock alone.
        // A service goes back through `services` so the create route re-resolves
        // its ledger + GST exactly as when it was typed; a row saved before the
        // round-trip fields existed falls back to one unit at its net amount.
        const sourceCharges = SERVICE_VOUCHER_TYPES.has(targetKind) ? readSettlement(source.settlementJson).charges : [];
        const services = sourceCharges.filter((c) => c.serviceId != null).map((c) => ({
            serviceId:   c.serviceId!,
            quantity:    c.quantity ?? 1,
            unitPrice:   c.rate ?? Number(c.amount),
            description: c.note ?? undefined,
        }));
        const charges = sourceCharges.filter((c) => c.serviceId == null).map((c) => ({
            accountId:   c.accountId,
            amount:      Number(c.amount),
            description: c.description ?? undefined,
        }));

        if (lines.length === 0 && services.length === 0 && charges.length === 0) {
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

        // Server clock is UTC regardless of where the shop is — business-zone
        // "today" so a conversion run between 00:00-05:30 IST isn't stamped
        // with yesterday's date.
        const today = businessTodayIso();
        const cookie = req.headers.get("cookie") ?? "";
        // Everything that makes up the source total is carried — bill and line
        // discounts (the saved line ₹ discount wins over its %, as on the form, so
        // it recomputes to the same paisa), services and charges — because the
        // credit tender is the source total and must match the recomputed one.
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
            services,
            charges,
            lines: lines.map((l) => ({
                productId:   l.productId,
                description: l.description ?? undefined,
                note: l.note,
                quantity:    toNumber(l.quantity),
                freeQty:     l.freeQty != null ? toNumber(l.freeQty) : undefined,
                rate:        exactLineRate(l),
                taxRate:     toNumber(l.taxRate),
                mrpPaise:    l.mrpPaise ?? undefined,
                discountPct: l.discountPct != null ? Number(l.discountPct) : undefined,
                discountAmt: toNumber(l.discountAmt),
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
