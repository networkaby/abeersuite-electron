import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { selectPrimaryPhone, selectPrimaryEmail } from "@/shared/lib/prisma/fragments";
import { getLedgerOutstanding } from "@/modules/accountancy/lib/outstandings";
import { ratesFromConfig, liveBalance } from "@/modules/loyalty/lib";
import { resolveTierForAccount, TIER_SPEND_VOUCHER_TYPES } from "@/shared/lib/pricing";
import { resolveEffectiveCreditLimit } from "@/shared/lib/accountancy/creditLimit";
import { closingForAccounts } from "@/modules/accountancy/lib/aggregateLedger";
import { latestRating, parseQualityLog } from "@/modules/customer/lib/customerQuality";
import { loadPartyPricing } from "@/modules/pricing-strategy/lib/groupPricingServer";
import { getWalkInAccountId } from "@/shared/lib/parties/offlinePersonCollision";
import { ACCOUNT_LEDGERS } from "@/shared/lib/constants/accounting";

// GET /api/pos/account-snapshot/[accountId]   (or /walk-in for the cash sale)
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

// One customer, every channel — online invoices count as spend too
// (shared with the tier resolver so brackets and turnover agree).
const SALE_TYPES = TIER_SPEND_VOUCHER_TYPES;

export async function GET(_: Request, { params }: { params: Promise<{ accountId: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const raw = (await params).accountId;

    try {
        // "walk-in" = the seeded Walk-in Cash Customer ledger — asked for only
        // by checkout when the cashier entered no customer. Nothing else here
        // knows about it.
        if (raw === "walk-in") return NextResponse.json(walkInSnapshot(await getWalkInAccountId(prisma)));
        const accountId = Number(raw);
        if (!Number.isFinite(accountId)) {
            return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        }
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: {
                id: true,
                creditLimit: true,
                // `openingBalance` is shown as its own line on the panel. The
                // BALANCE below is summed from the GL instead of read from the
                // cached column — this panel is what the cashier looks at before
                // letting goods go on credit, so it must match `checkCreditLimit`,
                // which now sums the same lines.
                openingBalance: true,
                person: {
                    select: {
                        id: true,
                        name: true,
                        gstin: true,
                        address: true,
                        qualityLog: true,
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
                        qualityLog: true,
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

        // Customer Quality — staff rating/comments timeline.
        const partyRow = (account.person ?? account.company)!;
        const qualityLog = parseQualityLog(partyRow.qualityLog);

        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

        // 5D-4/5D-8/5D-10/5D-11: party + status + date + type all live on the spine.
        const baseWhere: Prisma.VoucherDetailWhereInput = {
            universalVoucher: { partyAccountId: accountId, status: "POSTED", type: { in: [...SALE_TYPES] } },
        };

        const [lifetimeAgg, ytdAgg, tierCtx, latestVoucher, latestTicket, recentTickets, ledgerOutstanding, loyaltyConfig, partyPricing] = await Promise.all([
            prisma.voucherDetail.aggregate({
                where: baseWhere,
                _sum: { totalAmount: true },
                _count: { _all: true },
            }),
            prisma.voucherDetail.aggregate({
                where: { universalVoucher: { partyAccountId: accountId, status: "POSTED", date: { gte: oneYearAgo }, type: { in: [...SALE_TYPES] } } },
                _sum: { totalAmount: true },
            }),
            // Periods + bracket spend + guard + at-rest resolution (currentSaleValue 0)
            // — the shared server tier resolver (also used by shop checkout).
            resolveTierForAccount(prisma, accountId),
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
            // Which benefits this party may get + its customer group's price
            // rules. The no-discount flag (Customer Quality) and the group's
            // ticks both land here: a switched-off benefit is stripped from the
            // response below, so the POS previews the bill the server will post.
            // Neither the flag nor the group is ever named — POS staff see no reason.
            loadPartyPricing(prisma, accountId),
        ]);
        const { benefits } = partyPricing;

        const lifetimeTotal = Number(lifetimeAgg?._sum.totalAmount ?? 0);
        const ytdTotal = Number(ytdAgg?._sum.totalAmount ?? 0);
        const invoiceCount = lifetimeAgg?._count._all ?? 0;

        // At rest: no bill, so this is the history-only view. The POS overrides it
        // live by re-running resolveTierTitles against `tierPeriods` below.
        const { tierPeriodInputs, tierCapPct, tier } = tierCtx;
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
        // Ledger balance (positive = customer owes), summed from this account's
        // own GL lines plus its master opening — the same read the sale's credit
        // gate performs, so the headroom shown here is the headroom the server
        // will actually grant. No date ceiling, matching that gate.
        const balance    = (await closingForAccounts(null, [accountId])).get(accountId) ?? 0;
        const balanceDue = Math.max(0, balance);
        const overdueDue = ledgerOutstanding?.bills
            .filter((b) => b.daysOverdue > 0)
            .reduce((s, b) => s + b.outstanding, 0) ?? 0;
        // Signed balance, not `balanceDue` — a customer sitting on an advance really
        // does have that much extra headroom, and `checkCreditLimit` grants it
        // (`balance + additionalDebit > limit`). Clamping here would show less
        // credit than the server will actually allow.
        const availableCredit: number = Math.max(0, creditLimit - balance);

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
                openingBalance: account.openingBalance != null ? Number(account.openingBalance) : null,
            },
            turnover: { lifetime: lifetimeTotal, last12Months: ytdTotal, invoiceCount },
            discountPct: benefits.tier ? discountPct : 0,
            // The raw material, so the POS can re-resolve against the live cart — a
            // CURRENT_SALE period scores 0 until there is a bill to score.
            // Tier switched off → empty periods, so the live re-resolve yields 0 too.
            tierPeriods: benefits.tier ? tierPeriodInputs : [],
            tierCapPct,
            // History-only view (no bill). The POS recomputes all of this from
            // `tierPeriods` as items are scanned; other callers can use it as-is.
            tierTitles:    benefits.tier ? tier.titles : [],
            rawTierPct:    benefits.tier ? tier.rawPct : 0,
            cappedByGuard: benefits.tier ? tier.cappedByGuard : false,
            loyaltyPoints: benefits.loyalty ? loyaltyPoints : 0,
            loyaltyRates:  benefits.loyalty ? loyaltyRates : null,
            customerLevel: benefits.tier ? customerLevel : "",
            // Customer-group price rules (MRP / print price / profit share /
            // revenue discount), walked down the product-group tree — the POS
            // picks each line's starting price and the silent rebate from it.
            groupPricing: partyPricing.pricing,
            creditLimit,
            balanceDue,
            balanceOverdue: overdueDue,
            availableCredit,
            // Customer Quality — latest rating + the full staff timeline (the POS
            // panel shows the stars and recent comments, and can append entries).
            rating: latestRating(qualityLog),
            qualityLog,
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

// The cash sale: no ledger history worth showing (it pools every walk-in), no
// tier / points / group price, no credit — the sale route refuses credit on it
// anyway. `party.id` 0 names nobody; `isWalkIn` is what screens check.
function walkInSnapshot(accountId: number) {
    return {
        party: { kind: "person" as const, id: 0, name: ACCOUNT_LEDGERS.WALK_IN, phone: null, email: null, gstin: null, address: null },
        isWalkIn: true,
        account: { id: accountId, balance: 0, openingBalance: null },
        turnover: { lifetime: 0, last12Months: 0, invoiceCount: 0 },
        discountPct: 0, tierPeriods: [], tierCapPct: null, tierTitles: [], rawTierPct: 0, cappedByGuard: false,
        loyaltyPoints: 0, loyaltyRates: null, customerLevel: "", groupPricing: null,
        creditLimit: 0, balanceDue: 0, balanceOverdue: 0, availableCredit: 0,
        rating: null, qualityLog: [], favouriteCategory: null, personalizedOffers: [],
        lastVisitAt: null, recentTickets: [], warrantiesEnding: [],
    };
}
