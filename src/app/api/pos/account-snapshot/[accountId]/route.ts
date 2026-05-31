import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { selectPrimaryPhone, selectPrimaryEmail } from "@/shared/lib/prisma/fragments";
import { getLedgerOutstanding } from "@/modules/accountancy/lib/outstandings";

// GET /api/pos/account-snapshot/[accountId]
// Polymorphic POS "we know you" panel — works for either a Person account
// (B2C / individual customer) or a Company account (B2B). Account is the
// shared abstraction so this single endpoint covers both.
//
// Returns:
//   party          — { kind: "person" | "company", id, name, phone, email, gstin }
//   account        — current ledger balance + opening balance
//   turnover       — lifetime + last-12-month InvVoucher (SALE+POS) totals
//   discountPct    — tier from lifetime turnover (Bronze/Silver/Gold/Platinum)
//   loyaltyPoints  — placeholder = ⌊lifetime / 100⌋
//   lastVisitAt    — most recent of (latest sale voucher date, latest ticket createdAt)
//   recentTickets  — last 3 tickets (matched via Ticket.billingAccountId)
//   warrantiesEnding — TODO; placeholder
//
// Overdue calculation uses outstandings.ts (the canonical receivables
// engine) so InvVoucher allocations are netted correctly. Migrated from
// prisma.invoice/payment to prisma.invVoucher on 2026-05-24 as part of
// the Invoice → InvVoucher consolidation (Layer 3d).

const SALE_TYPES = ["SALE", "POS"] as const;

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
                creditLimit: true,
                person: {
                    select: {
                        id: true,
                        name: true,
                        gstin: true,
                        address: true,
                        phones: selectPrimaryPhone,
                        emails: selectPrimaryEmail,
                    },
                },
                company: {
                    select: {
                        id: true,
                        name: true,
                        gstin: true,
                        address: true,
                        phones: selectPrimaryPhone,
                        emails: selectPrimaryEmail,
                    },
                },
            },
        });
        if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

        let party: { kind: "person" | "company"; id: number; name: string; phone: string | null; email: string | null; gstin: string | null; address: string | null } | null = null;
        if (account.person) {
            const p = account.person;
            party = {
                kind: "person",
                id: p.id,
                name: p.name,
                phone: p.phones[0]?.phone ?? null,
                email: p.emails[0]?.email ?? null,
                gstin: p.gstin,
                address: p.address,
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
                address: c.address,
            };
        }
        if (!party) return NextResponse.json({ error: "Account is not linked to a person or company" }, { status: 400 });

        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

        const baseWhere = {
            accountId,
            type:      { in: [...SALE_TYPES] },
            status:    "POSTED" as const,
            deletedAt: null,
        };

        const [lifetimeAgg, ytdAgg, latestVoucher, latestTicket, recentTickets, ledgerOutstanding] = await Promise.all([
            prisma.invVoucher.aggregate({
                where: baseWhere,
                _sum: { totalAmount: true },
                _count: { _all: true },
            }),
            prisma.invVoucher.aggregate({
                where: { ...baseWhere, date: { gte: oneYearAgo } },
                _sum: { totalAmount: true },
            }),
            prisma.invVoucher.findFirst({
                where: baseWhere,
                orderBy: { date: "desc" },
                select: { date: true, reference: true, totalAmount: true },
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
            // Receivables-engine-backed overdue: respects VoucherAllocation
            // netting (POS cash receipts, partial settlements, etc.).
            getLedgerOutstanding(accountId),
        ]);

        const lifetimeTotal = Number(lifetimeAgg?._sum.totalAmount ?? 0);
        const ytdTotal = Number(ytdAgg?._sum.totalAmount ?? 0);
        const invoiceCount = lifetimeAgg?._count._all ?? 0;

        const discountPct = lifetimeTotal >= 200000 ? 8 : lifetimeTotal >= 50000 ? 5 : lifetimeTotal >= 10000 ? 2 : 0;
        const loyaltyPoints = Math.floor(lifetimeTotal / 100);

        const customerLevel = lifetimeTotal >= 200000 ? "Platinum"
                              : lifetimeTotal >= 50000  ? "Gold"
                              : lifetimeTotal >= 10000  ? "Silver"
                                                        : "Bronze";

        // Deny-by-default (matches checkCreditLimit): NULL is treated as 0.
        //   0    = no credit facility (must pay in full)
        //   > 0  = hard cap; enforced at sale APIs and the POS checkout dialog
        const creditLimit: number = account.creditLimit !== null
            ? Number(account.creditLimit)
            : 0;
        const balance    = Number(account.balance);    // ledger balance (positive = customer owes)
        const balanceDue = Math.max(0, balance);
        const overdueDue = ledgerOutstanding?.bills
            .filter((b) => b.daysOverdue > 0)
            .reduce((s, b) => s + b.outstanding, 0) ?? 0;
        const availableCredit: number = Math.max(0, creditLimit - balanceDue);

        const lastVisitAt = (() => {
            const a = latestVoucher?.date ?? null;
            const b = latestTicket?.createdAt ?? null;
            if (!a) return b;
            if (!b) return a;
            return a > b ? a : b;
        })();

        return NextResponse.json({
            party,
            account: {
                id: account.id,
                balance,
                openingBalance: account.openingBalance ? Number(account.openingBalance) : null,
            },
            turnover: { lifetime: lifetimeTotal, last12Months: ytdTotal, invoiceCount },
            discountPct,
            loyaltyPoints,
            customerLevel,
            creditLimit,
            balanceDue,
            balanceOverdue: overdueDue,
            availableCredit,
            // Placeholders — surface as soft "—" in UI; wire to real data later.
            rating: null,
            favouriteCategory: null,
            personalizedOffers: [] as Array<{ id: string; label: string; tag: string }>,
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
