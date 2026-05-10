import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, isAdmin } from "@/shared/lib/auth/authGuard";

// GET /api/sub-statuses/next?statusId=S3&fromSubStatusId=SS10
// GET /api/sub-statuses/next?statusId=S3&entryOnly=true  (no current sub-status)
//
// Returns the next allowed sub-statuses for a ticket given its current main status
// and current sub-status (or entry points when there is no sub-status yet).
// Only returns sub-statuses the calling user's role is permitted to set.
export async function GET(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;

    try {
        const { searchParams } = new URL(req.url);
        const statusId = searchParams.get("statusId");
        const fromSubStatusId = searchParams.get("fromSubStatusId");
        const entryOnly = searchParams.get("entryOnly") === "true";
        const isWarranty = searchParams.get("isWarranty") === "true";

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
                if (!isAdmin(user) && ss.allowedRoles.length > 0 && !ss.allowedRoles.some((role) => user.roles.includes(role))) return false;
                const scope = ss.warrantyScope ?? "any";
                if (scope !== "any") {
                    if (scope === "warranty_only" && !isWarranty) return false;
                    if (scope === "non_warranty_only" && isWarranty) return false;
                }
                return true;
            });

        return NextResponse.json(result);
    } catch {
        return NextResponse.json({ error: "Failed to fetch next sub-statuses" }, { status: 500 });
    }
}
