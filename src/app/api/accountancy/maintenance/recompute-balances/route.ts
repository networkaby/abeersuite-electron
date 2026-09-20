import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { defaultNormalBalanceForGroupType } from "@/modules/accountancy/lib/groupNature";
import { ledgerStatusFilterUv } from "@/modules/accountancy/lib/aggregateLedger";
import { handleApiError } from "@/shared/lib/api";

// POST /api/accountancy/maintenance/recompute-balances
// Recomputes Account.balance from the JournalLine source of truth and
// writes back any drift. Account.balance is a running cache maintained by
// post helpers; if any helper drops a delta, the cache drifts.
//
// What still depends on it, and therefore what this repair is for: the ledgers
// list and the finance top bar (`closingFromCache`) — the two surfaces that want
// EVERY account at once, where summing the GL would be a full-ledger scan.
// Nothing that decides anything reads it any more: the credit gate, the POS
// customer panel, the party lists, the till figures and the party-delete guard
// all sum their own accounts' lines (`closingForAccounts`). So drift here is now
// a display matter, not a money matter. Dry-run with `?dryRun=1`.
export async function POST(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";

    try {
        const accounts = await prisma.account.findMany({
            select: {
                id: true, name: true, balance: true,
                normalBalance: true, group: { select: { type: true } },
            },
        });
        const nbMap = new Map<number, "DEBIT" | "CREDIT">();
        for (const a of accounts) {
            if (a.normalBalance) { nbMap.set(a.id, a.normalBalance); continue; }
            const g = a.group?.type;
            if (g) nbMap.set(a.id, defaultNormalBalanceForGroupType(g));
        }

        const sums = await prisma.voucherGlLine.groupBy({
            by: ["accountId", "type"],
            _sum: { amount: true },
            where: { universalVoucher: { ...ledgerStatusFilterUv() } },
        });

        const computed = new Map<number, number>();
        for (const r of sums) {
            const nb = nbMap.get(r.accountId);
            if (!nb) continue;
            const amt = toNumber(r._sum.amount ?? 0);
            computed.set(r.accountId, (computed.get(r.accountId) ?? 0) + balanceDelta(nb, r.type, amt));
        }

        const drift: { id: number; name: string; cached: number; computed: number; delta: number }[] = [];
        for (const a of accounts) {
            const cached = toNumber(a.balance);
            const comp = computed.get(a.id) ?? 0;
            const delta = comp - cached;
            if (Math.abs(delta) > 0.005) {
                drift.push({ id: a.id, name: a.name, cached, computed: comp, delta });
            }
        }

        if (!dryRun && drift.length > 0) {
            await prisma.$transaction(
                drift.map((d) =>
                    prisma.account.update({ where: { id: d.id }, data: { balance: d.computed } }),
                ),
            );
        }

        return NextResponse.json({
            checked: accounts.length,
            withActivity: computed.size,
            driftCount: drift.length,
            drift: drift.slice(0, 50),
            applied: !dryRun && drift.length > 0,
        });
    } catch (e) {
        return handleApiError(e, "Failed to recompute balances");
    }
}
