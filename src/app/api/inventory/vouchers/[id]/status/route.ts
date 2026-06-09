import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";

// PATCH /api/inventory/vouchers/[id]/status  body { status: "DRAFT" | "POSTED" }
//
// Toggle the finalisation status of a NON-GL document. For these types the status
// is a document lifecycle — DRAFT = not finalised, POSTED = issued / given to the
// party — NOT a GL-posting state. POS saves them POSTED; the reviewer can flip a
// row back to Draft (or re-issue) here.
//
// HARD GUARD: only non-GL types with no journal entry may be toggled. A real GL
// voucher's status is owned by the post/cancel flow and must never be flipped here
// (that would desync the books).
const TOGGLEABLE = new Set<string>(["POS_ESTIMATE", "POS_ORDER", "ESTIMATE", "SALES_ORDER", "PURCHASE_ORDER"]);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    // Reverting a finalised (POSTED) document back to DRAFT is an un-finalize action —
    // same gravity as Cancel, NOT a mere view. (Was gated only on ACCOUNTANCY_VIEW_ORG.)
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_VOUCHER_CANCEL);
    if (response) return response;

    const id = Number((await params).id);
    if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    try {
        const body = await req.json().catch(() => ({}));
        const status = (body as { status?: string }).status;
        if (status !== "DRAFT" && status !== "POSTED") {
            return NextResponse.json({ error: "status must be DRAFT or POSTED" }, { status: 400 });
        }

        const v = await prisma.invVoucher.findUnique({
            where: { id },
            select: { id: true, type: true, journalEntryId: true, deletedAt: true },
        });
        if (!v || v.deletedAt) return NextResponse.json({ error: "Voucher not found" }, { status: 404 });
        if (!TOGGLEABLE.has(v.type) || v.journalEntryId != null) {
            return NextResponse.json(
                { error: "This voucher's status is GL-controlled and can't be changed here." },
                { status: 422 },
            );
        }

        const updated = await prisma.invVoucher.update({
            where: { id },
            data: { status, postedAt: status === "POSTED" ? new Date() : null },
            select: { id: true, status: true },
        });
        return NextResponse.json(updated);
    } catch (e) {
        return handleApiError(e, "Failed to change status");
    }
}
