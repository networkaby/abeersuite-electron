import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";

// GET /api/sub-statuses/next?statusId=S3&fromSubStatusId=SS10
// GET /api/sub-statuses/next?statusId=S3&entryOnly=true  (no current sub-status)
//
// Returns the next allowed sub-statuses for a ticket given its current main status
// and current sub-status (or entry points when there is no sub-status yet).
// Only returns sub-statuses the calling user's role is permitted to set.
export async function GET(req: Request) {
    const { session, response } = await requireAuth();
    if (response) return response;

    try {
        const { searchParams } = new URL(req.url);
        const statusId = searchParams.get("statusId");
        const fromSubStatusId = searchParams.get("fromSubStatusId");
        const entryOnly = searchParams.get("entryOnly") === "true";
        const userRole = (session.user as { role?: string }).role ?? "";

        if (!statusId) {
            return NextResponse.json({ error: "statusId required" }, { status: 400 });
        }

        const transitions = await prisma.subStatusTransition.findMany({
            where: { fromSubStatusId: entryOnly || !fromSubStatusId ? null : fromSubStatusId },
            include: { to: true },
            orderBy: { id: "asc" },
        });

        const seen = new Set<string>();
        const result = transitions
            .map((t) => t.to)
            .filter((ss) => {
                if (seen.has(ss.id)) return false;
                seen.add(ss.id);
                if (!ss.applicableStatusIds.includes(statusId)) return false;
                // Admin (R1) can set any sub-status regardless of allowedRoles
                if (userRole !== "R1" && ss.allowedRoles.length > 0 && !ss.allowedRoles.includes(userRole)) return false;
                return true;
            });

        return NextResponse.json(result);
    } catch {
        return NextResponse.json({ error: "Failed to fetch next sub-statuses" }, { status: 500 });
    }
}
