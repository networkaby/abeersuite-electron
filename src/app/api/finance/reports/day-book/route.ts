import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { parseRange } from "@/modules/accountancy/lib/period";
import { resolveSourceBatch } from "@/modules/accountancy/lib/refResolver";

// GET /api/finance/reports/day-book?from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&limit=50&search=...
export async function GET(req: Request) {
    const { response } = await requirePermission("accountancy:view:org");
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const { from, to } = parseRange(searchParams);
    const search = searchParams.get("search")?.trim() ?? "";
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 50)));

    const where = {
        status: "POSTED" as const,
        date: { gte: from, lte: to },
        ...(search ? {
            OR: [
                { reference:   { contains: search, mode: "insensitive" as const } },
                { description: { contains: search, mode: "insensitive" as const } },
            ],
        } : {}),
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

        const sourceMap = await resolveSourceBatch(entries.map((e) => e.id));

        const rows = entries.map((e) => {
            let dr = 0, cr = 0;
            for (const l of e.lines) {
                const amt = Number(l.amount);
                if (l.type === "DEBIT") dr += amt;
                else                    cr += amt;
            }
            const source = sourceMap.get(e.id) ?? null;
            const kind: "Sale" | "Purchase" | "Estimate" | "Invoice" | "Journal" =
                source?.kind === "sale"     ? "Sale"
              : source?.kind === "purchase" ? "Purchase"
              : source?.kind === "estimate" ? "Estimate"
              : source?.kind === "invoice"  ? "Invoice"
              : "Journal";
            return {
                id: e.id,
                date: e.date,
                reference: e.reference,
                description: e.description,
                kind,
                debit: dr,
                credit: cr,
                source,
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
