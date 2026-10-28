import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { deleteSpamFiles } from "@/modules/message/lib/customerMessages";

// /api/messages/spam-files — one-time clean-up of files kept before Mark Spam
// started deleting them (new marks delete on their own, see setNumberSpam).
//
// POST { apply?: true } — without `apply` a dry run: counts the spam numbers
// and files that would go. With `apply: true` deletes them from R2 for good.

const schema = z.object({ apply: z.literal(true).optional() });

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.MESSAGES_REPLY);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, schema);
        if (error) return error;
        const rows = await prisma.message.groupBy({
            by: ["phone"],
            where: { spam: true, direction: "IN", mediaKey: { not: null }, phone: { not: null } },
            _count: { _all: true },
        });
        const files = rows.reduce((n, r) => n + r._count._all, 0);
        if (!data.apply) return NextResponse.json({ dryRun: true, numbers: rows.length, files });
        let deleted = 0;
        for (const r of rows) deleted += await deleteSpamFiles(r.phone!);
        return NextResponse.json({ dryRun: false, numbers: rows.length, files, deleted });
    } catch (e) {
        return handleApiError(e, "Failed to clean up spam files");
    }
}
