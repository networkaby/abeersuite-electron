import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { invalidateBooksPeriodCache } from "@/shared/lib/accountancy/booksPeriodServer";

const updateSchema = z.object({
    restartMonth: z.number().int().min(1).max(12).optional(),
    restartDay:   z.number().int().min(1).max(31).optional(),
    // Org period anchors. Nullable so the page can clear them again — see the
    // BooksConfig model comment. GET deliberately returns them raw: a null
    // stays null, and the "1st of the current FY" default is the page's
    // prefill, never something the server quietly records as fact.
    financialYearFrom:  z.coerce.date().nullable().optional(),
    booksBeginningFrom: z.coerce.date().nullable().optional(),
});

// GET /api/accountancy/books-config — singleton; auto-creates row if missing.
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    const config = await prisma.booksConfig.upsert({
        where: { id: 1 },
        create: { id: 1 },
        update: {},
    });
    return NextResponse.json(config);
}

// PATCH /api/accountancy/books-config — update restart month/day.
export async function PATCH(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { data, error } = await validateRequest(req, updateSchema);

    if (error) return error;

    const config = await prisma.booksConfig.upsert({
        where: { id: 1 },
        create: { id: 1, ...data },
        update: data,
    });
    // The voucher-date guard reads these through a one-minute cache. Drop it
    // here so the admin who just set the date sees it bite on their very next
    // voucher, instead of a stale minute making the setting look inert.
    invalidateBooksPeriodCache();
    return NextResponse.json(config);
}
