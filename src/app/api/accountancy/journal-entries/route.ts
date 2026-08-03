import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";

// GET /api/accountancy/journal-entries
//
// Reads the spine (UniversalVoucher) — the single GL representation since the
// JournalEntry drop (G5). By default this endpoint shows only **user journal
// vouchers** (spine `type = JOURNAL`); the engine postings behind Sale/
// Purchase/Contra/Payment/Receipt already surface in the Day Book via their
// primary InvVoucher / Voucher rows, so re-listing every spine row here would
// duplicate every transaction. Set `?includeEngine=1` to list all spine rows
// for debugging / admin views.
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const includeEngine = searchParams.get("includeEngine") === "1";

    try {
        const entries = await prisma.universalVoucher.findMany({
            where: {
                ...(status ? { status: status as "DRAFT" | "POSTED" | "CANCELLED" } : {}),
                // Always-true guard — nothing writes `deletedAt` (soft-delete removed 2026-08-01).
                deletedAt: null,
                ...(from || to ? {
                    date: {
                        ...(from ? { gte: new Date(from) } : {}),
                        ...(to ? { lte: new Date(to) } : {}),
                    },
                } : {}),
                ...(includeEngine ? {} : { type: "JOURNAL" }),
            },
            orderBy: [{ date: "desc" }, { createdAt: "desc" }],
            include: {
                _count: { select: { lines: true } },
                lines: { select: { type: true, amount: true } },
            },
        });

        // createdBy is a scalar id on the spine — enrich names in one lookup.
        const creatorIds = [...new Set(entries.map((e) => e.createdById))];
        const creators = await prisma.user.findMany({
            where:  { id: { in: creatorIds } },
            select: { id: true, name: true },
        });
        const creatorById = new Map(creators.map((u) => [u.id, u]));

        const result = entries.map((e) => {
            const totalDebit = e.lines
                .filter((l) => l.type === "DEBIT")
                .reduce((s, l) => s + Number(l.amount), 0);
            return { ...e, createdBy: creatorById.get(e.createdById) ?? null, lines: undefined, totalDebit };
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
