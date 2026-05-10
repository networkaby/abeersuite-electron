import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { selectPrimaryPhone, selectPrimaryEmail } from "@/shared/lib/prisma/fragments";

// GET /api/pos/person-snapshot/[id]
// "We know you" panel for the POS — aggregates everything in one call so the UI
// can render quickly without N round-trips.
//
// Returns:
//   person         — id, name, primaryPhone, primaryEmail, gstin
//   account        — current ledger balance + opening balance
//   turnover       — lifetime invoice total + last-12-month total
//   discountPct    — TODO (no schema field yet) — placeholder tier from turnover
//   loyaltyPoints  — TODO (no schema field yet) — placeholder = ⌊totalInvoiced / 100⌋
//   lastVisitAt    — most recent of (latest invoice issueDate, latest ticket createdAt)
//   recentTickets  — last 3 tickets w/ status label
//   warrantiesEnding — TODO (no warranty-end-date field) — surfaced as warning copy

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const id = Number((await params).id);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    try {
        const person = await prisma.person.findUnique({
            where: { id },
            select: {
                id: true, name: true, gstin: true,
                phones: selectPrimaryPhone,
                emails: selectPrimaryEmail,
                account: { select: { id: true, balance: true, openingBalance: true } },
            },
        });
        if (!person) return NextResponse.json({ error: "Person not found" }, { status: 404 });

        const accountId = person.account?.id;

        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

        const [lifetimeAgg, ytdAgg, latestInvoice, latestTicket, recentTickets] = await Promise.all([
            accountId
                ? prisma.invoice.aggregate({
                    where: { accountId, deletedAt: null, status: { not: "VOID" } },
                    _sum: { totalAmount: true },
                    _count: { _all: true },
                })
                : Promise.resolve(null),
            accountId
                ? prisma.invoice.aggregate({
                    where: { accountId, deletedAt: null, status: { not: "VOID" }, issueDate: { gte: oneYearAgo } },
                    _sum: { totalAmount: true },
                })
                : Promise.resolve(null),
            accountId
                ? prisma.invoice.findFirst({
                    where: { accountId, deletedAt: null, status: { not: "VOID" } },
                    orderBy: { issueDate: "desc" },
                    select: { issueDate: true, number: true, totalAmount: true },
                })
                : Promise.resolve(null),
            accountId
                ? prisma.ticket.findFirst({
                    where: { billingAccountId: accountId },
                    orderBy: { createdAt: "desc" },
                    select: { id: true, createdAt: true },
                })
                : Promise.resolve(null),
            accountId
                ? prisma.ticket.findMany({
                    where: { billingAccountId: accountId },
                    orderBy: { createdAt: "desc" },
                    take: 3,
                    select: {
                        id: true,
                        createdAt: true,
                        ticketStatus: { select: { label: true, color: true } },
                    },
                })
                : Promise.resolve([] as Array<{ id: number; createdAt: Date; ticketStatus: { label: string; color: string } | null }>),
        ]);

        const lifetimeTotal = Number(lifetimeAgg?._sum.totalAmount ?? 0);
        const ytdTotal = Number(ytdAgg?._sum.totalAmount ?? 0);
        const invoiceCount = lifetimeAgg?._count._all ?? 0;

        const discountPct = lifetimeTotal >= 200000 ? 8 : lifetimeTotal >= 50000 ? 5 : lifetimeTotal >= 10000 ? 2 : 0;
        const loyaltyPoints = Math.floor(lifetimeTotal / 100);

        const lastVisitAt = (() => {
            const a = latestInvoice?.issueDate ?? null;
            const b = latestTicket?.createdAt ?? null;
            if (!a) return b;
            if (!b) return a;
            return a > b ? a : b;
        })();

        return NextResponse.json({
            person: {
                id: person.id,
                name: person.name,
                phone: person.phones[0]?.phone ?? null,
                email: person.emails[0]?.email ?? null,
                gstin: person.gstin,
            },
            account: person.account
                ? {
                    id: person.account.id,
                    balance: Number(person.account.balance),
                    openingBalance: person.account.openingBalance ? Number(person.account.openingBalance) : null,
                }
                : null,
            turnover: {
                lifetime: lifetimeTotal,
                last12Months: ytdTotal,
                invoiceCount,
            },
            discountPct,
            loyaltyPoints,
            lastVisitAt,
            recentTickets: recentTickets.map((t) => ({
                id: t.id,
                createdAt: t.createdAt,
                statusLabel: t.ticketStatus?.label ?? "—",
                statusColor: t.ticketStatus?.color ?? "",
            })),
            warrantiesEnding: [] as Array<{ productName: string; endsAt: string }>,
        });
    } catch (e) {
        return handleApiError(e, "Snapshot failed");
    }
}
