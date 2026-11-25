import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { z } from "zod";
import { parseQualityLog, type QualityLogEntry } from "@/modules/customer/lib/customerQuality";

// POST /api/customer-quality — append one rating or comment entry to a
// customer's quality timeline (Person/Company.qualityLog). Called from the
// Customer Quality tab (source "office") and the POS customer panel (source
// "pos", with the counter name). Internal-only staff knowledge — never exposed
// to the customer. Append-only: entries are never edited or removed.

const bodySchema = z.object({
    personId:  z.number().int().positive().optional(),
    companyId: z.number().int().positive().optional(),
    type:      z.enum(["rating", "comment"]),
    stars:     z.number().int().min(1).max(5).optional(),
    text:      z.string().trim().min(1).max(1000).optional(),
    source:    z.enum(["pos", "office"]).default("office"),
    counterNo: z.string().trim().max(60).optional(),
}).refine((b) => (b.personId != null) !== (b.companyId != null), {
    message: "Send exactly one of personId / companyId",
}).refine((b) => (b.type === "rating" ? b.stars != null : !!b.text), {
    message: "rating needs stars (1–5); comment needs text",
});

export async function POST(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, bodySchema);
        if (error) return error;

        // Denormalise the author into the entry so the timeline renders without joins.
        const author = await prisma.user.findUnique({
            where:  { id: user.id },
            select: { name: true, avatarUrl: true },
        });
        if (!author) return NextResponse.json({ error: "Unknown user" }, { status: 401 });

        const entry: QualityLogEntry = {
            type:            data.type,
            ...(data.type === "rating" ? { stars: data.stars } : { text: data.text }),
            authorId:        user.id,
            authorName:      author.name,
            authorAvatarUrl: author.avatarUrl,
            at:              new Date().toISOString(),
            source:          data.source,
            ...(data.source === "pos" && data.counterNo ? { counterNo: data.counterNo } : {}),
        };

        // The whole list is written back, so lock the row and read it in the same
        // transaction — else a note added meanwhile is lost.
        const { personId, companyId } = data;
        const log = await prisma.$transaction(async (tx) => {
            if (personId != null) {
                await tx.$queryRaw`SELECT id FROM "Person" WHERE id = ${personId} FOR UPDATE`;
                const row = await tx.person.findUnique({ where: { id: personId }, select: { qualityLog: true } });
                if (!row) return null;
                const next = [...parseQualityLog(row.qualityLog), entry];
                await tx.person.update({ where: { id: personId }, data: { qualityLog: next } });
                return next;
            }
            await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${companyId!} FOR UPDATE`;
            const row = await tx.company.findUnique({ where: { id: companyId! }, select: { qualityLog: true } });
            if (!row) return null;
            const next = [...parseQualityLog(row.qualityLog), entry];
            await tx.company.update({ where: { id: companyId! }, data: { qualityLog: next } });
            return next;
        });
        if (!log) return NextResponse.json({ error: personId != null ? "Person not found" : "Company not found" }, { status: 404 });
        return NextResponse.json({ qualityLog: log }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to add the entry");
    }
}
