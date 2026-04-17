import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

// GET /api/sub-statuses/next?statusId=S3&fromSubStatusId=SS10
// GET /api/sub-statuses/next?statusId=S3&entryOnly=true  (no current sub-status)
//
// Returns the next allowed sub-statuses for a ticket given its current main status
// and current sub-status (or entry points when there is no sub-status yet).
export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const statusId = searchParams.get("statusId");
        const fromSubStatusId = searchParams.get("fromSubStatusId"); // null string or actual ID
        const entryOnly = searchParams.get("entryOnly") === "true";

        if (!statusId) {
            return NextResponse.json({ error: "statusId required" }, { status: 400 });
        }

        // Find transitions where fromSubStatusId matches (or is null for entry points)
        const transitions = await prisma.subStatusTransition.findMany({
            where: { fromSubStatusId: entryOnly || !fromSubStatusId ? null : fromSubStatusId },
            include: { to: true },
            orderBy: { id: "asc" },
        });

        // Filter: only sub-statuses applicable to this main status
        const result = transitions
            .map((t) => t.to)
            .filter((ss) => ss.applicableStatusIds.includes(statusId));

        return NextResponse.json(result);
    } catch {
        return NextResponse.json({ error: "Failed to fetch next sub-statuses" }, { status: 500 });
    }
}
