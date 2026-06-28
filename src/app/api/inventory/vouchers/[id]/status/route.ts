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
// HARD GUARD: only OPTIONAL (non-binding) documents may be toggled. A REGULAR
// voucher's status is owned by the post/cancel flow and must never be flipped
// here (that would desync the books). 5D-9: bindingness is the spine's `binding`
// flag, NOT a hardcoded type-list.
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
            // 5D-8/5D-9: status + deletedAt + binding live on the spine.
            select: { id: true, universalVoucherId: true, universalVoucher: { select: { deletedAt: true, binding: true } } },
        });
        if (!v || v.universalVoucher?.deletedAt) return NextResponse.json({ error: "Voucher not found" }, { status: 404 });
        // Only OPTIONAL (non-binding) documents carry a free document-lifecycle status
        // that may be toggled here. A REGULAR voucher's status is owned by the
        // post/cancel flow and must never be flipped here (that would desync the books).
        if (v.universalVoucherId == null || v.universalVoucher?.binding !== "OPTIONAL") {
            return NextResponse.json(
                { error: "This voucher's status is GL-controlled and can't be changed here." },
                { status: 422 },
            );
        }

        // 5D-8: the toggle now writes the SPINE status (the single source of truth).
        const updated = await prisma.universalVoucher.update({
            where: { id: v.universalVoucherId },
            data: { status },   // 5D-5: postedAt lives on the spine
            select: { status: true },
        });
        return NextResponse.json({ id: v.id, status: updated.status });
    } catch (e) {
        return handleApiError(e, "Failed to change status");
    }
}
