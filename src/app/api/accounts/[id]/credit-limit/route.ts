import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import {
    loadCreditLimitConfig,
    windowSalesTotal,
    computeAutoCreditLimit,
} from "@/shared/lib/accountancy/creditLimit";

// GET /api/accounts/[id]/credit-limit
// The credit-limit breakup for ONE party ledger, for the Contacts profile card.
//
// The manual figure already rides along with the profile detail; what the card
// cannot know on its own is the AUTO limit, which is sized from this customer's
// own recent sales by the CreditLimitConfig singleton. Same brain as POS and the
// sale-time guard — `creditLimit.ts` — just the two numbers instead of the whole
// POS panel, so opening a profile does not pay for tiers, loyalty and tickets.
//
//   effective = max(manual, auto)  ← the limit actually enforced
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const accountId = Number((await params).id);
    if (!Number.isFinite(accountId)) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    try {
        const account = await prisma.account.findUnique({
            where:  { id: accountId },
            select: { id: true, creditLimit: true },
        });
        if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

        const cfg    = await loadCreditLimitConfig(prisma);
        const manual = Math.max(0, account.creditLimit !== null ? Number(account.creditLimit) : 0);

        // Skip the sales aggregate entirely when auto is off — nothing to size from.
        const salesInWindow = cfg.autoEnabled ? await windowSalesTotal(prisma, accountId, cfg.windowDays) : 0;
        const auto          = computeAutoCreditLimit(salesInWindow, cfg);

        return NextResponse.json({
            manual,
            auto,
            effective: Math.max(manual, auto),
            salesInWindow,
            autoEnabled: cfg.autoEnabled,
            windowDays:  cfg.windowDays,
            pctOfSales:  cfg.pctOfSales,
        });
    } catch (e) {
        return handleApiError(e, "Failed to load credit limit");
    }
}
