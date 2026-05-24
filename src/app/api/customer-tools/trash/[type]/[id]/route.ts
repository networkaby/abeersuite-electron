import { NextResponse } from "next/server";
import { requireAuth, hasPermission, isAdmin } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import {
    hardDeleteTombstone,
    TombstoneStillReferencedError,
} from "@/modules/customer/lib/convertParty";

// DELETE /api/customer-tools/trash/person/123  (or .../company/45)
export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ type: string; id: string }> },
) {
    const { user, response } = await requireAuth();
    if (response) return response;

    if (!isAdmin(user) && !hasPermission(user, PERMISSIONS.CUSTOMERS_HARD_DELETE)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { type, id } = await params;
    if (type !== "person" && type !== "company") {
        return NextResponse.json({ error: "Invalid type — expected 'person' or 'company'" }, { status: 400 });
    }
    const numId = Number(id);
    if (!Number.isFinite(numId) || numId <= 0) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    try {
        await hardDeleteTombstone(type as "person" | "company", numId);
        return NextResponse.json({ ok: true });
    } catch (err) {
        if (err instanceof TombstoneStillReferencedError) {
            return NextResponse.json(
                { error: err.message, references: err.references },
                { status: 409 },
            );
        }
        return handleApiError(err, "Failed to hard-delete tombstone");
    }
}
