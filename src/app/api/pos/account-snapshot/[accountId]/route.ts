import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { selectPrimaryPhone, selectPrimaryEmail } from "@/shared/lib/prisma/fragments";
import { getLedgerOutstanding } from "@/modules/accountancy/lib/outstandings";
import { ratesFromConfig, liveBalance } from "@/modules/loyalty/lib";
import { resolveTierTitles, type TierPeriodInput } from "@/shared/lib/pricing";
import { resolveEffectiveCreditLimit } from "@/shared/lib/accountancy/creditLimit";

// GET /api/pos/account-snapshot/[accountId]
// Polymorphic POS "we know you" panel — works for either a Person account
// (B2C / individual customer) or a Company account (B2B). Account is the
// shared abstraction so this single endpoint covers both.
//
// Returns:
//   party          — { kind: "person" | "company", id, name, phone, email, gstin }
//   account        — current ledger balance + opening balance
//   turnover       — lifetime + last-12-month InvVoucher (SALE+POS) totals
//   tierTitles     — every title held, one per CustomerTierPeriod whose bracket of
//                    spend clears one of that period's levels
//   discountPct    — the SUM of those titles' percentages (periods apply independently),
//                    capped by the global discount guard and a hard 100; driven by
//                    bracketed spend, NOT lifetime
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

        // Each period ("Best of the month", "Best of the quarter") carries its own levels
        // and its own BRACKET of history, so a customer can hold several titles at once.
        // Spend is counted per bracket — NOT lifetime — so a customer who stops buying
        // falls out of the recent ones. Admin-set at
        // /office/customer-retention/customer-tiers. Levels arrive minSpend desc so the
        // first one cleared is the highest.
        const tierPeriods = await prisma.customerTierPeriod.findMany({
            where: { enabled: true },
            orderBy: [{ sortOrder: "asc" }, { fromDay: "asc" }],
            include: { levels: { where: { enabled: true }, orderBy: { minSpend: "desc" } } },
        });

        // 5D-4/5D-8/5D-10/5D-11: party + status + deletedAt + date + type all live on the spine.
        const baseWhere: Prisma.VoucherDetailWhereInput = {
            universalVoucher: { partyAccountId: accountId, status: "POSTED", deletedAt: null, type: { in: [...SALE_TYPES] } },
        };

        const [lifetimeAgg, ytdAgg, periodAggs, latestVoucher, latestTicket, recentTickets, ledgerOutstanding, loyaltyConfig, couponConfig] = await Promise.all([
            prisma.voucherDetail.aggregate({
                where: baseWhere,
                _sum: { totalAmount: true },
                _count: { _all: true },
            }),
            prisma.voucherDetail.aggregate({
                where: { universalVoucher: { partyAccountId: accountId, status: "POSTED", deletedAt: null, date: { gte: oneYearAgo }, type: { in: [...SALE_TYPES] } } },
                _sum: { totalAmount: true },
            }),
            // Spend inside each period's bracket — this is what decides the titles. One
            // aggregate per period; there are only a handful of periods.
            //
            // The bracket holds sales aged `fromDay <= age < toDay`. Older edge (toDay) is
            // exclusive and newer edge (fromDay) inclusive, so tiled brackets (0-30, 30-90)
            // hand a sale to exactly one period — no gap at the seam, no double count.
            // fromDay 0 has no upper bound, so a sale made today still counts.
            Promise.all(tierPeriods.map((p) => {
                const notBefore = new Date();
                notBefore.setDate(notBefore.getDate() - p.toDay);
                const notAfter = new Date();
                notAfter.setDate(notAfter.getDate() - p.fromDay);
                return prisma.voucherDetail.aggregate({
                    where: {
                        universalVoucher: {
                            partyAccountId: accountId, status: "POSTED", deletedAt: null,
                            type: { in: [...SALE_TYPES] },
                            date: p.fromDay === 0 ? { gt: notBefore } : { gt: notBefore, lte: notAfter },
                        },
                    },
                    _sum: { totalAmount: true },
                });
            })),
            prisma.voucherDetail.findFirst({
                where: baseWhere,
                orderBy: { universalVoucher: { date: "desc" } },   // 5D-10
                select: { totalAmount: true, universalVoucher: { select: { voucherNo: true, date: true } } },
            }),
            prisma.ticket.findFirst({
                where: { accountId },
                orderBy: { createdAt: "desc" },
                select: { id: true, createdAt: true },
            }),
            prisma.ticket.findMany({
                where: { accountId },
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
            // Real persisted loyalty balance + the rates the POS UI needs to
            // compute the ₹ value of a redemption live.
            prisma.loyaltyConfig.findUnique({ where: { id: 1 } }),
            // The global discount guard — caps the stacked tier % (see below).
            prisma.couponConfig.findUnique({ where: { id: 1 }, select: { maxTotalDiscountPct: true } }),
        ]);

        const lifetimeTotal = Number(lifetimeAgg?._sum.totalAmount ?? 0);
        const ytdTotal = Number(ytdAgg?._sum.totalAmount ?? 0);
        const invoiceCount = lifetimeAgg?._count._all ?? 0;

        // Periods as the resolver wants them: Decimals flattened to numbers, posted bracket
        // spend attached. The bill on the counter is NOT here — it only exists in the POS,
        // so a "consider current sale" period scores its history alone at this point. The
        // POS re-resolves these against the live cart through the same resolveTierTitles.
        const tierPeriodInputs: TierPeriodInput[] = tierPeriods.map((p, i) => ({
            id:               p.id,
            name:             p.name,
            currentSaleScope: p.currentSaleScope,
            currentSaleOnly:  p.currentSaleOnly,
            fromDay:          p.fromDay,
            toDay:            p.toDay,
            spend:            Number(periodAggs[i]?._sum.totalAmount ?? 0),
            levels:           p.levels.map((l) => ({
                name:        l.name,
                minSpend:    Number(l.minSpend),
                discountPct: Number(l.discountPct),
            })),
        }));

        // Global guard (CouponConfig.maxTotalDiscountPct — the "Discount guard", editable
        // from both Spend Tiers and Coupons).
        const tierCapPct = couponConfig?.maxTotalDiscountPct != null ? Number(couponConfig.maxTotalDiscountPct) : null;
        // At rest: no bill, so this is the history-only view. The POS overrides it live.
        const tier = resolveTierTitles({
            periods: tierPeriodInputs,
            currentSaleValue: 0,
            isNewCustomer: invoiceCount === 0,
            capPct: tierCapPct,
        });
        const discountPct = tier.discountPct;
        // Live, dynamic balance — Σ in-window lots under the current expiry window
        // (was a derived ⌊lifetime/100⌋ placeholder). `loyaltyRates` carries the full
        // rate set so the POS UI can enforce the redeem floors / show the ₹ value.
        const loyaltyRates = loyaltyConfig ? ratesFromConfig(loyaltyConfig) : null;
        const loyaltyPoints = loyaltyRates ? await liveBalance(prisma, accountId, loyaltyRates) : 0;

        // Customer-facing level name is free-form (admin-defined) and belongs to the
        // badge title; empty when the customer has earned no title at all.
        const customerLevel = tier.badgeLevelName;

        // Effective limit = max(manual, auto) — mirrors checkCreditLimit so the
        // POS "available credit" reflects any auto limit granted by the config.
        //   0    = no credit facility (must pay in full)
        //   > 0  = hard cap; enforced at sale APIs and the POS checkout dialog
        const manualLimit = account.creditLimit !== null ? Number(account.creditLimit) : 0;
        const { effective: creditLimit } = await resolveEffectiveCreditLimit(prisma, accountId, manualLimit);
        const balance    = Number(account.balance);    // ledger balance (positive = customer owes)
        const balanceDue = Math.max(0, balance);
        const overdueDue = ledgerOutstanding?.bills
            .filter((b) => b.daysOverdue > 0)
            .reduce((s, b) => s + b.outstanding, 0) ?? 0;
        const availableCredit: number = Math.max(0, creditLimit - balanceDue);

        const lastVisitAt = (() => {
            const a = latestVoucher?.universalVoucher?.date ?? null;
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
            // The raw material, so the POS can re-resolve against the live cart — a
            // CURRENT_SALE period scores 0 until there is a bill to score.
            tierPeriods: tierPeriodInputs,
            tierCapPct,
            // History-only view (no bill). The POS recomputes all of this from
            // `tierPeriods` as items are scanned; other callers can use it as-is.
            tierTitles:    tier.titles,
            badgePeriodId: tier.badgePeriodId,
            rawTierPct:    tier.rawPct,
            cappedByGuard: tier.cappedByGuard,
            loyaltyPoints,
            loyaltyRates,
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
