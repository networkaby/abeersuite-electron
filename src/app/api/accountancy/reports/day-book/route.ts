import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { parseRange } from "@/modules/accountancy/lib/period";
import { ledgerStatusFilterUv } from "@/modules/accountancy/lib/aggregateLedger";
import { resolveSourceBatch } from "@/modules/accountancy/lib/journalEntrySource";
import { parsePagination } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// Heavy aggregation: unbounded voucher pre-filter scan + paginated JE join.
// Give Vercel headroom past the default 10s function limit so large datasets
// don't 504.
export const maxDuration = 60;

// Surfaced kinds in the Day Book — the union of inventory-voucher origins
// (Sale/POS/Purchase/Estimate/Sale Return/Purchase Return), GL voucher
// types, and stand-alone JEs. POS is split out from Sale (post-2026-05-24)
// so cashiers and managers can tell counter sales apart from office
// sales at a glance.
type Kind = "All" | "Sale" | "POS" | "Purchase" | "Estimate" | "Sale Return" | "Purchase Return"
    | "Contra" | "Payment" | "Receipt" | "Credit Note" | "Debit Note"
    | "Journal";
const KINDS: Kind[] = ["All", "Sale", "POS", "Purchase", "Estimate", "Sale Return", "Purchase Return",
    "Contra", "Payment", "Receipt", "Credit Note", "Debit Note", "Journal"];

// GET /api/accountancy/reports/day-book?from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&limit=50&search=...&kind=Sale
export async function GET(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const { from, to } = parseRange(searchParams);
    const search = searchParams.get("search")?.trim() ?? "";
    const { take: limit, page } = parsePagination(searchParams);
    const kindParam = (searchParams.get("kind") ?? "All") as Kind;
    const kind: Kind = (KINDS as string[]).includes(kindParam) ? kindParam : "All";

    // Translate the kind filter into a `where.id` constraint by reverse-joining
    // the source tables. "Journal" is the negation — any JE not linked to a
    // voucher / invoice. We pre-compute the id sets in parallel so the main
    // findMany still uses a single round trip.
    // Single ledger-inclusion gate (POSTED, not soft-deleted), shared with every
    // report via `ledgerStatusFilterUv`, on the universal-voucher spine.
    const baseWhere = {
        ...ledgerStatusFilterUv(),
        date: { gte: from, lte: to },
    };
    // Kind filters reverse-join the source tables by their legacy `journalEntryId`;
    // the spine matches via `sourceJournalEntryId` (the JE id it mirrors).
    let kindIdsFilter:
        | { sourceJournalEntryId: { in: number[] } }
        | { sourceJournalEntryId: { notIn: number[] } }
        | undefined;
    if (kind !== "All") {
        if (kind === "Sale" || kind === "POS" || kind === "Purchase" || kind === "Estimate" || kind === "Sale Return" || kind === "Purchase Return") {
            // Each Day Book kind maps to exactly one InvVoucher.type value.
            // Sale and POS are split so the counter flow is distinguishable
            // from the office sale flow even though both post the same
            // AR/Revenue JE shape.
            const types =
                kind === "Sale"            ? (["SALE"] as const) :
                kind === "POS"             ? (["POS"] as const) :
                kind === "Purchase"        ? (["PURCHASE"] as const) :
                kind === "Estimate"        ? (["ESTIMATE"] as const) :
                kind === "Sale Return"     ? (["SALE_RETURN"] as const) :
                                             (["PURCHASE_RETURN"] as const);
            const rows = await prisma.invVoucher.findMany({
                where: { type: { in: [...types] }, journalEntryId: { not: null } },
                select: { journalEntryId: true },
            });
            kindIdsFilter = { sourceJournalEntryId: { in: rows.map((r) => r.journalEntryId!).filter(Boolean) } };
        } else if (kind === "Journal") {
            // "Journal" covers two things:
            //   1. JEs linked to a Voucher of type=JOURNAL (the dialog's path).
            //   2. Stand-alone JEs not linked to any source (legacy / direct posts).
            const [journalVchs, invs, vchs] = await Promise.all([
                prisma.voucher.findMany({
                    where: { type: "JOURNAL", journalEntryId: { not: null } },
                    select: { journalEntryId: true },
                }),
                prisma.invVoucher.findMany({
                    where: { journalEntryId: { not: null } },
                    select: { journalEntryId: true },
                }),
                prisma.voucher.findMany({
                    where: { journalEntryId: { not: null } },
                    select: { journalEntryId: true },
                }),
            ]);
            const linkedSet = new Set<number>();
            for (const r of invs) if (r.journalEntryId != null) linkedSet.add(r.journalEntryId);
            for (const r of vchs) if (r.journalEntryId != null) linkedSet.add(r.journalEntryId);
            const journalIds = new Set<number>();
            for (const r of journalVchs) if (r.journalEntryId != null) journalIds.add(r.journalEntryId);
            // We want JEs that are EITHER unlinked OR linked to a JOURNAL voucher.
            // Equivalent: exclude JEs linked to any non-JOURNAL source.
            const linkedNonJournal = [...linkedSet].filter((id) => !journalIds.has(id));
            kindIdsFilter = { sourceJournalEntryId: { notIn: linkedNonJournal } };
        } else {
            // GL voucher types: CONTRA / PAYMENT / RECEIPT / CREDIT_NOTE / DEBIT_NOTE.
            // (JOURNAL is handled by the dedicated branch above.)
            const dbType =
                kind === "Contra"      ? "CONTRA"      :
                kind === "Payment"     ? "PAYMENT"     :
                kind === "Receipt"     ? "RECEIPT"     :
                kind === "Credit Note" ? "CREDIT_NOTE" :
                /* Debit Note */         "DEBIT_NOTE";
            const rows = await prisma.voucher.findMany({
                where: { type: dbType, journalEntryId: { not: null } },
                select: { journalEntryId: true },
            });
            kindIdsFilter = { sourceJournalEntryId: { in: rows.map((r) => r.journalEntryId!).filter(Boolean) } };
        }
    }

    const where = {
        ...baseWhere,
        ...(search ? {
            OR: [
                { reference:   { contains: search, mode: "insensitive" as const } },
                { description: { contains: search, mode: "insensitive" as const } },
            ],
        } : {}),
        ...(kindIdsFilter ?? {}),
    };

    try {
        const [entries, total] = await Promise.all([
            prisma.universalVoucher.findMany({
                where,
                orderBy: [{ date: "desc" }, { id: "desc" }],
                skip: (page - 1) * limit,
                take: limit,
                select: {
                    id: true, reference: true, description: true, date: true, sourceJournalEntryId: true,
                    // Stable line order — first line is the principal "By" account
                    // shown in the row's single Amount column. VoucherGlLine is
                    // id-only (no account relation); account fields are resolved
                    // via the lookup map below.
                    lines: {
                        orderBy: { id: "asc" },
                        select: { type: true, amount: true, description: true, accountId: true },
                    },
                },
            }),
            prisma.universalVoucher.count({ where }),
        ]);

        // Account name/code by id — VoucherGlLine carries a scalar accountId.
        const accountIds = [...new Set(entries.flatMap((e) => e.lines.map((l) => l.accountId)))];
        const accountRows = accountIds.length
            ? await prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true, code: true } })
            : [];
        const accById = new Map(accountRows.map((a) => [a.id, a]));

        // Source/label lookups key off the legacy JE id the spine mirrors.
        const jeIds = entries.map((e) => e.sourceJournalEntryId).filter((x): x is number => x != null);
        const [sourceMap, glVouchers] = await Promise.all([
            resolveSourceBatch(jeIds),
            // Also look up GL Voucher rows so we can label rows as
            // Contra / Payment / Receipt / Credit Note / Debit Note instead
            // of the generic "Journal".
            prisma.voucher.findMany({
                where: { journalEntryId: { in: jeIds } },
                select: { journalEntryId: true, type: true, id: true, reference: true },
            }),
        ]);
        const glMap = new Map<number, { type: string; id: number; reference: string }>();
        for (const v of glVouchers) {
            if (v.journalEntryId == null) continue;
            glMap.set(v.journalEntryId, { type: v.type, id: v.id, reference: v.reference });
        }
        const VOUCHER_KIND_LABEL: Record<string, "Contra" | "Payment" | "Receipt" | "Credit Note" | "Debit Note" | "Journal"> = {
            CONTRA:      "Contra",
            PAYMENT:     "Payment",
            RECEIPT:     "Receipt",
            CREDIT_NOTE: "Credit Note",
            DEBIT_NOTE:  "Debit Note",
            JOURNAL:     "Journal",
        };
        // Per-type drilldown URL — each voucher kind has its own list page.
        // JOURNAL has no dedicated list page (entry is via dialog); fall back
        // to the legacy journal-entries detail.
        const VOUCHER_URL_SEG: Record<string, string> = {
            CONTRA:      "contras",
            PAYMENT:     "payments",
            RECEIPT:     "receipts",
            CREDIT_NOTE: "credit-notes",
            DEBIT_NOTE:  "debit-notes",
            JOURNAL:     "journal-entries",
        };

        const rows = entries.map((e) => {
            let dr = 0, cr = 0;
            for (const l of e.lines) {
                const amt = Number(l.amount);
                if (l.type === "DEBIT") dr += amt;
                else                    cr += amt;
            }
            const srcJeId = e.sourceJournalEntryId;
            const source  = srcJeId != null ? (sourceMap.get(srcJeId) ?? null) : null;
            const gl      = srcJeId != null ? glMap.get(srcJeId) : undefined;
            const kind: Kind =
                source?.kind === "sale"            ? "Sale"
              : source?.kind === "pos"             ? "POS"
              : source?.kind === "purchase"        ? "Purchase"
              : source?.kind === "estimate"        ? "Estimate"
              : source?.kind === "sale-return"     ? "Sale Return"
              : source?.kind === "purchase-return" ? "Purchase Return"
              : gl                                 ? VOUCHER_KIND_LABEL[gl.type] ?? "Journal"
              :                                      "Journal";
            // Principal account = first line in stable order. Tally-style display:
            // single Amount column with Dr/Cr suffix matching this side.
            const first = e.lines[0];
            const firstAcc = first ? accById.get(first.accountId) : undefined;
            const principal = first ? {
                accountId:   first.accountId,
                accountName: firstAcc?.name ?? "",
                side:        first.type,
                amount:      Number(first.amount),
            } : null;
            return {
                id: e.sourceJournalEntryId ?? e.id,
                date: e.date,
                reference: e.reference,
                description: e.description,
                kind,
                debit: dr,
                credit: cr,
                principal,
                // Compact line list for the right-click expand view.
                lines: e.lines.map((l) => {
                    const a = accById.get(l.accountId);
                    return {
                        accountId:   l.accountId,
                        accountName: a?.name ?? "",
                        accountCode: a?.code ?? "",
                        side:        l.type,
                        amount:      Number(l.amount),
                        description: l.description,
                    };
                }),
                // Prefer the InvVoucher/Invoice source link; fall back to the
                // per-type GL voucher detail page (contras / payments / etc.).
                source: source ?? (gl ? {
                    kind: "voucher" as const,
                    id: gl.id, reference: gl.reference,
                    url: `/office/accountancy/${VOUCHER_URL_SEG[gl.type] ?? "journal-entries"}/${gl.id}`,
                } : null),
            };
        });

        return NextResponse.json({
            from: from.toISOString(),
            to:   to.toISOString(),
            rows,
            total,
            page,
            limit,
        });
    } catch (e) {
        return handleApiError(e, "Failed to load day book");
    }
}
