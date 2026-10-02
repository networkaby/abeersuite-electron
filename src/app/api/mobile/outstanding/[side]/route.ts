import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { handleApiError } from "@/shared/lib/api";
import { businessToday } from "@/shared/lib/format/formatDate";
import { getOutstandings } from "@/modules/accountancy/lib/outstandings";
import { booksUnchangedSince } from "@/modules/mobile/booksUnchanged";

// Same aggregation as the office Receivables / Payables reports.
export const maxDuration = 60;

const SIDES = {
    receivables: { group: ACCOUNT_GROUPS.SUNDRY_DEBTORS, permission: PERMISSIONS.MOBILE_RECEIVABLES_VIEW },
    payables: { group: ACCOUNT_GROUPS.SUNDRY_CREDITORS, permission: PERMISSIONS.MOBILE_PAYABLES_VIEW },
} as const;

// GET /api/mobile/outstanding/receivables | /api/mobile/outstanding/payables
//
// Who owes us / whom we owe, for the phone: the office report's engine
// (`getOutstandings`), sent as the party list only — the flat bill list is the big
// half of that report and a phone opens one party's bills on demand
// (/api/mobile/parties/[accountId]). Each side checks its own tick.
//
// `?since=<computedAt of the copy the phone holds>`: when nothing in the books has
// moved since (booksUnchangedSince), the answer is `{ unchanged: true }` —
// the open-bills scan and the payload are both skipped.
export async function GET(req: Request, { params }: { params: Promise<{ side: string }> }) {
    const side = SIDES[(await params).side as keyof typeof SIDES];
    if (!side) return NextResponse.json({ error: "Unknown list" }, { status: 404 });

    const { response } = await requirePermission(side.permission);
    if (response) return response;

    try {
        // Captured BEFORE the read, so a voucher written mid-request is still
        // "since" on the next ask.
        const now = new Date();
        if (await booksUnchangedSince(new URL(req.url).searchParams.get("since"), now)) {
            return NextResponse.json({ unchanged: true, computedAt: now.toISOString() });
        }

        const asOf = businessToday();
        asOf.setHours(23, 59, 59, 999);
        const report = await getOutstandings(side.group, asOf);

        // Oldest open bill per party — the one to chase first.
        const oldest = new Map<number, number>();
        for (const b of report.bills) oldest.set(b.accountId, Math.max(oldest.get(b.accountId) ?? 0, b.daysOverdue));

        // Primary phone per party, in two reads for the whole list.
        const personIds = report.parties.flatMap((p) => (p.personId != null ? [p.personId] : []));
        const companyIds = report.parties.flatMap((p) => (p.companyId != null ? [p.companyId] : []));
        const phones = await prisma.phone.findMany({
            where: { OR: [{ personId: { in: personIds } }, { companyId: { in: companyIds } }] },
            select: { personId: true, companyId: true, phone: true },
            orderBy: [{ isPrimary: "desc" }, { id: "asc" }],
        });
        const personPhone = new Map<number, string>();
        const companyPhone = new Map<number, string>();
        for (const ph of phones) {
            if (ph.personId != null && !personPhone.has(ph.personId)) personPhone.set(ph.personId, ph.phone);
            if (ph.companyId != null && !companyPhone.has(ph.companyId)) companyPhone.set(ph.companyId, ph.phone);
        }

        return NextResponse.json({
            computedAt: now.toISOString(),
            asOf: report.asOf,
            total: report.totalOutstanding,
            buckets: report.buckets,
            billCount: report.bills.length,
            parties: report.parties.map((p) => ({
                accountId: p.accountId,
                name: p.accountName,
                searchKey: p.searchKey,
                phone: (p.personId != null ? personPhone.get(p.personId) : undefined)
                    ?? (p.companyId != null ? companyPhone.get(p.companyId) : undefined)
                    ?? null,
                total: p.totalOutstanding,
                buckets: p.buckets,
                billCount: p.billCount,
                oldestDays: oldest.get(p.accountId) ?? 0,
            })),
        });
    } catch (e) {
        return handleApiError(e, "Could not load the list");
    }
}
