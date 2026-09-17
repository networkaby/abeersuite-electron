import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { loadSettlements } from "@/modules/accountancy/lib/billLink";

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
            // Posting wall-clock, not row-insert time — see the vouchers route.
            orderBy: [
                { date: "desc" },
                { sourceCreatedAt: { sort: "desc", nulls: "last" } },
                { createdAt: "desc" },
            ],
            include: {
                _count: { select: { lines: true } },
                // `accountId` is for the bill-wise chip — a journal with a party
                // leg links like anything else (see billLink.ts). The lines are
                // stripped from the response below, so nothing extra is sent.
                lines: { select: { type: true, amount: true, accountId: true } },
            },
        });

        // createdBy is a scalar id on the spine — enrich names in one lookup.
        const creatorIds = [...new Set(entries.map((e) => e.createdById))];
        const creators = await prisma.user.findMany({
            where:  { id: { in: creatorIds } },
            select: { id: true, name: true },
        });
        const creatorById = new Map(creators.map((u) => [u.id, u]));

        // Bill-wise settlement. A journal that touches a party ledger has a side
        // like any other voucher, so it links with no special case — which is
        // what lets a re-class journal be matched off against a bill here.
        const partyMovement = new Map<number, number>();
        for (const e of entries) {
            if (e.partyAccountId == null) continue;
            let movement = 0;
            for (const l of e.lines) {
                if (l.accountId !== e.partyAccountId) continue;
                movement += l.type === "DEBIT" ? Number(l.amount) : -Number(l.amount);
            }
            partyMovement.set(e.id, movement);
        }
        const settlements = await loadSettlements(
            prisma,
            entries.map((e) => ({
                universalVoucherId: e.id,
                partyAccountId:     e.partyAccountId,
                kind:               e.type,
                status:             e.status,
            })),
            partyMovement,
        );

        const result = entries.map((e) => {
            const totalDebit = e.lines
                .filter((l) => l.type === "DEBIT")
                .reduce((s, l) => s + Number(l.amount), 0);
            return {
                ...e,
                createdBy: creatorById.get(e.createdById) ?? null,
                lines: undefined,
                totalDebit,
                settlement:     settlements[e.id]?.state ?? null,
                settlementOpen: settlements[e.id]?.open  ?? 0,
                canLink:        settlements[e.id]?.canLink ?? false,
            };
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
