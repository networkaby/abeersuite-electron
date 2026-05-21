import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// GET /api/accountancy/journal-entries
//
// By default this endpoint hides **engine-output** JournalEntries — the
// double-entry postings auto-created by Sale/Purchase/Contra/Payment/Receipt/
// Journal-Voucher posts. Those events already show up in the Day Book via
// their primary InvVoucher / Voucher rows; surfacing the mirror JE again
// duplicates every transaction. Engine output is identified by reference
// prefix `GL-` (the `GL_POSTING` VoucherSeries). Set `?includeEngine=1`
// to opt back in for debugging / admin views.
export async function GET(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const includeDeletedParam = searchParams.get("includeDeleted") === "1";
    const canSeeDeleted = user!.permissions.includes(PERMISSIONS.ADMIN_BYPASS) || user!.permissions.includes(PERMISSIONS.FINANCE_JOURNAL_DELETE);
    const includeDeleted = includeDeletedParam && canSeeDeleted;
    const includeEngine = searchParams.get("includeEngine") === "1";

    try {
        const entries = await prisma.journalEntry.findMany({
            where: {
                ...(status ? { status: status as "DRAFT" | "POSTED" | "CANCELLED" } : {}),
                ...(includeDeleted ? {} : { deletedAt: null }),
                ...(from || to ? {
                    date: {
                        ...(from ? { gte: new Date(from) } : {}),
                        ...(to ? { lte: new Date(to) } : {}),
                    },
                } : {}),
                ...(includeEngine ? {} : { NOT: { reference: { startsWith: "GL-" } } }),
            },
            orderBy: [{ date: "desc" }, { createdAt: "desc" }],
            include: {
                createdBy: { select: { id: true, name: true } },
                _count: { select: { lines: true } },
                lines: { select: { type: true, amount: true } },
            },
        });

        const result = entries.map((e) => {
            const totalDebit = e.lines
                .filter((l) => l.type === "DEBIT")
                .reduce((s, l) => s + Number(l.amount), 0);
            return { ...e, lines: undefined, totalDebit };
        });

        return NextResponse.json(result);
    } catch (e) {
        return handleApiError(e, "Failed to fetch journal entries");
    }
}

// POST /api/accountancy/journal-entries — DEPRECATED.
//
// Removed in the GL engine refactor. The old behaviour was to write a
// `JournalEntry` row directly with no parent `Voucher`, which left the
// document hanging outside the primary-voucher lifecycle (no draft/post
// workflow, no edit history, no Day Book identity beyond a raw JE reference).
// All user-entered journals now go through `POST /api/accountancy/journal-
// vouchers` — that route creates a `Voucher` row (type=JOURNAL, prefix `JV-`)
// as the primary document and the GL engine creates the matching posting
// behind it. Returns 410 Gone with a redirect hint instead of writing a
// row, so any forgotten caller surfaces in logs.
export function POST() {
    return NextResponse.json(
        {
            error: "Endpoint deprecated. Use POST /api/accountancy/journal-vouchers instead — it creates a primary Voucher (type=JOURNAL, prefix JV-) with the GL posting attached.",
            redirect: "/api/accountancy/journal-vouchers",
        },
        { status: 410 },
    );
}
