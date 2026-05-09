import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { parseRange } from "@/modules/accountancy/lib/period";
import { resolveSourceBatch } from "@/modules/accountancy/lib/refResolver";

// Surfaced kinds in the Day Book — the union of inventory-voucher origins
// (Sale/Purchase/Estimate), invoices, GL voucher types, and stand-alone JE.
type Kind = "All" | "Sale" | "Purchase" | "Estimate" | "Invoice"
    | "Contra" | "Payment" | "Receipt" | "Credit Note" | "Debit Note"
    | "Journal";
const KINDS: Kind[] = ["All", "Sale", "Purchase", "Estimate", "Invoice",
    "Contra", "Payment", "Receipt", "Credit Note", "Debit Note", "Journal"];

// GET /api/finance/reports/day-book?from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&limit=50&search=...&kind=Sale
export async function GET(req: Request) {
    const { response } = await requirePermission("accountancy:view:org");
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const { from, to } = parseRange(searchParams);
    const search = searchParams.get("search")?.trim() ?? "";
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 50)));
    const kindParam = (searchParams.get("kind") ?? "All") as Kind;
    const kind: Kind = (KINDS as string[]).includes(kindParam) ? kindParam : "All";

    // Translate the kind filter into a `where.id` constraint by reverse-joining
    // the source tables. "Journal" is the negation — any JE not linked to a
    // voucher / invoice. We pre-compute the id sets in parallel so the main
    // findMany still uses a single round trip.
    const baseWhere = {
        status: "POSTED" as const,
        date: { gte: from, lte: to },
    };
    let kindIdsFilter: { id: { in: number[] } } | { id: { notIn: number[] } } | undefined;
    if (kind !== "All") {
        if (kind === "Sale" || kind === "Purchase" || kind === "Estimate") {
            const types =
                kind === "Sale"     ? ["SALE", "ISSUE", "ADJUSTMENT"] as const :
                kind === "Purchase" ? ["PURCHASE", "RECEIPT"]         as const :
                                      ["ESTIMATE"]                    as const;
            const rows = await prisma.invVoucher.findMany({
                where: { type: { in: [...types] }, journalEntryId: { not: null } },
                select: { journalEntryId: true },
            });
            kindIdsFilter = { id: { in: rows.map((r) => r.journalEntryId!).filter(Boolean) } };
        } else if (kind === "Invoice") {
            // Invoices don't have a journalEntryId column — link via reference prefix.
            const rows = await prisma.journalEntry.findMany({
                where: { ...baseWhere, reference: { startsWith: "INV-" } },
                select: { id: true },
            });
            kindIdsFilter = { id: { in: rows.map((r) => r.id) } };
        } else if (kind === "Journal") {
            // Stand-alone JEs: not linked to any source. Compute the union of
            // JE ids that ARE linked, then exclude.
            const [invs, vchs] = await Promise.all([
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
            // Plus invoices via reference prefix
            const invJEs = await prisma.journalEntry.findMany({
                where: { ...baseWhere, reference: { startsWith: "INV-" } },
                select: { id: true },
            });
            for (const r of invJEs) linkedSet.add(r.id);
            kindIdsFilter = { id: { notIn: [...linkedSet] } };
        } else {
            // GL voucher types: CONTRA / PAYMENT / RECEIPT / CREDIT_NOTE / DEBIT_NOTE
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
            kindIdsFilter = { id: { in: rows.map((r) => r.journalEntryId!).filter(Boolean) } };
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
            prisma.journalEntry.findMany({
                where,
                orderBy: [{ date: "desc" }, { id: "desc" }],
                skip: (page - 1) * limit,
                take: limit,
                select: {
                    id: true, reference: true, description: true, date: true,
                    lines: { select: { type: true, amount: true } },
                },
            }),
            prisma.journalEntry.count({ where }),
        ]);

        const jeIds = entries.map((e) => e.id);
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
        const VOUCHER_KIND_LABEL: Record<string, "Contra" | "Payment" | "Receipt" | "Credit Note" | "Debit Note"> = {
            CONTRA:      "Contra",
            PAYMENT:     "Payment",
            RECEIPT:     "Receipt",
            CREDIT_NOTE: "Credit Note",
            DEBIT_NOTE:  "Debit Note",
        };

        const rows = entries.map((e) => {
            let dr = 0, cr = 0;
            for (const l of e.lines) {
                const amt = Number(l.amount);
                if (l.type === "DEBIT") dr += amt;
                else                    cr += amt;
            }
            const source = sourceMap.get(e.id) ?? null;
            const gl     = glMap.get(e.id);
            const kind: Kind =
                source?.kind === "sale"     ? "Sale"
              : source?.kind === "purchase" ? "Purchase"
              : source?.kind === "estimate" ? "Estimate"
              : source?.kind === "invoice"  ? "Invoice"
              : gl                          ? VOUCHER_KIND_LABEL[gl.type] ?? "Journal"
              :                               "Journal";
            return {
                id: e.id,
                date: e.date,
                reference: e.reference,
                description: e.description,
                kind,
                debit: dr,
                credit: cr,
                // Prefer the InvVoucher/Invoice source link; fall back to the
                // GL voucher detail page so users can drill in either way.
                source: source ?? (gl ? {
                    kind: "voucher" as const,
                    id: gl.id, reference: gl.reference,
                    url: `/office/accountancy/voucher/${gl.id}`,
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
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to load day book" }, { status: 500 });
    }
}
