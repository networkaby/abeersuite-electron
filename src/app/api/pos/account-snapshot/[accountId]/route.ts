import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-guard";

// GET /api/pos/account-snapshot/[accountId]
// Polymorphic POS "we know you" panel — works for either a Person account
// (B2C / individual customer) or a Company account (B2B). Account is the
// shared abstraction so this single endpoint covers both.
//
// Returns:
//   party          — { kind: "person" | "company", id, name, phone, email, gstin }
//   account        — current ledger balance + opening balance
//   turnover       — lifetime + last-12-month invoice totals
//   discountPct    — placeholder tier from lifetime turnover
//   loyaltyPoints  — placeholder = ⌊totalInvoiced / 100⌋
//   lastVisitAt    — most recent of (latest invoice issueDate, latest ticket createdAt)
//   recentTickets  — last 3 tickets (matched via Ticket.billingAccountId)
//   warrantiesEnding — TODO; placeholder

export async function GET(_: Request, { params }: { params: Promise<{ accountId: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const accountId = Number((await params).accountId);
    if (!Number.isFinite(accountId)) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    try {
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: {
                id: true,
                balance: true,
                openingBalance: true,
                person: {
                    select: {
                        id: true,
                        name: true,
                        gstin: true,
                        phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 },
                        emails: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 },
                    },
                },
                company: {
                    select: {
                        id: true,
                        name: true,
                        gstin: true,
                        phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 },
                        emails: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 },
                    },
                },
            },
        });
        if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

        let party: { kind: "person" | "company"; id: number; name: string; phone: string | null; email: string | null; gstin: string | null } | null = null;
        if (account.person) {
            const p = account.person;
            party = {
                kind: "person",
                id: p.id,
                name: p.name,
                phone: p.phones[0]?.phone ?? null,
                email: p.emails[0]?.email ?? null,
                gstin: p.gstin,
            };
        } else if (account.company) {
            const c = account.company;
            party = {
                kind: "company",
                id: c.id,
                name: c.name,
                phone: c.phones[0]?.phone ?? null,
                email: c.emails[0]?.email ?? null,
                gstin: c.gstin,
            };
        }
        if (!party) return NextResponse.json({ error: "Account is not linked to a person or company" }, { status: 400 });

        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

        const [lifetimeAgg, ytdAgg, latestInvoice, latestTicket, recentTickets] = await Promise.all([
            prisma.invoice.aggregate({
                where: { accountId, deletedAt: null, status: { not: "VOID" } },
                _sum: { totalAmount: true },
                _count: { _all: true },
            }),
            prisma.invoice.aggregate({
                where: { accountId, deletedAt: null, status: { not: "VOID" }, issueDate: { gte: oneYearAgo } },
                _sum: { totalAmount: true },
            }),
            prisma.invoice.findFirst({
                where: { accountId, deletedAt: null, status: { not: "VOID" } },
                orderBy: { issueDate: "desc" },
                select: { issueDate: true, number: true, totalAmount: true },
            }),
            prisma.ticket.findFirst({
                where: { billingAccountId: accountId },
                orderBy: { createdAt: "desc" },
                select: { id: true, createdAt: true },
            }),
            prisma.ticket.findMany({
                where: { billingAccountId: accountId },
                orderBy: { createdAt: "desc" },
                take: 3,
                select: {
                    id: true,
                    createdAt: true,
                    ticketStatus: { select: { label: true, color: true } },
                },
            }),
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
            party,
            account: {
                id: account.id,
                balance: Number(account.balance),
                openingBalance: account.openingBalance ? Number(account.openingBalance) : null,
            },
            turnover: { lifetime: lifetimeTotal, last12Months: ytdTotal, invoiceCount },
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
    } catch (err) {
        console.error("[pos account snapshot]", err);
        return NextResponse.json({ error: "Snapshot failed" }, { status: 500 });
    }
}
