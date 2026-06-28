import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError, parseIdParam } from "@/shared/lib/api";
import { selectPrimaryPhone, selectPrimaryEmail } from "@/shared/lib/prisma/fragments";

// GET /api/pos/person-snapshot/[id]
// "We know you" panel for the POS — aggregates everything in one call so
// the UI can render quickly without N round-trips.
//
// Returns:
//   person         — id, name, primaryPhone, primaryEmail, gstin
//   account        — current ledger balance + opening balance
//   turnover       — lifetime InvVoucher (SALE+POS) total + last-12-month total
//   discountPct    — tier from lifetime turnover
//   loyaltyPoints  — placeholder = ⌊lifetime / 100⌋
//   lastVisitAt    — most recent of (latest sale voucher date, latest ticket createdAt)
//   recentTickets  — last 3 tickets w/ status label
//   warrantiesEnding — TODO (no warranty-end-date field)
//
// Migrated from prisma.invoice to prisma.invVoucher (SALE + POS only) on
// 2026-05-24 as part of the Invoice → InvVoucher consolidation (Layer 3d).

const SALE_TYPES = ["SALE", "POS"] as const;

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id, error } = await parseIdParam(params);
    if (error) return error;

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

        const accountId = person.account?.id ?? null;

        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

        const baseWhere = accountId
            ? { accountId, type: { in: [...SALE_TYPES] }, status: "POSTED" as const, deletedAt: null }
            : null;

        const [lifetimeAgg, ytdAgg, latestVoucher, latestTicket, recentTickets] = await Promise.all([
            baseWhere
                ? prisma.invVoucher.aggregate({
                    where: baseWhere,
                    _sum: { totalAmount: true },
                    _count: { _all: true },
                })
                : Promise.resolve(null),
            baseWhere
                ? prisma.invVoucher.aggregate({
                    where: { ...baseWhere, date: { gte: oneYearAgo } },
                    _sum: { totalAmount: true },
                })
                : Promise.resolve(null),
            baseWhere
                ? prisma.invVoucher.findFirst({
                    where: baseWhere,
                    orderBy: { date: "desc" },
                    select: { date: true, totalAmount: true, universalVoucher: { select: { friendlyRef: true } } },
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
            const a = latestVoucher?.date ?? null;
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
