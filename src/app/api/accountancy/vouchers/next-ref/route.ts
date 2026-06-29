import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, userCanVoucher } from "@/shared/lib/auth/permissions";
import { assembleReference } from "@/modules/accountancy/lib/voucherRef";

// GET /api/accountancy/vouchers/next-ref?type=JOURNAL
// Preview the next voucher reference (e.g. JOURNAL/26-27/0042) WITHOUT
// incrementing the series. The dialog uses this to show the expected number.
//
// Race-safe? No — the actual reference is generated atomically inside a
// transaction at save time via nextRefFromSeries(). If two users save
// concurrently, the live reference may differ by ±1 from this preview.

export async function GET(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const kind = searchParams.get("type") ?? "JOURNAL";

    // Gate by the requested kind's create key (per-kind OR generic) — whoever may
    // create this voucher may preview its next reference.
    if (!userCanVoucher(user, kind, "create")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const series = await prisma.voucherSeries.findUnique({ where: { kind } });
    if (!series) {
        return NextResponse.json({ reference: "" });
    }

    // Mirror what nextRefFromSeries does at save time: it post-increments
    // nextSeq, then calls assembleReference. To preview the same value,
    // pass a shape with nextSeq + 1.
    const reference = assembleReference(
        { ...series, nextSeq: series.nextSeq + 1 },
        user?.id,
    );

    return NextResponse.json({ reference });
}
