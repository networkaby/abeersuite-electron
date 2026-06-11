import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { passesWorkGate } from "@/modules/repairing/lib/workGate";
import { handleApiError } from "@/shared/lib/api";

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

        // No current sub-status → the only "next" is the status's hand-picked start
        // sub-status (TicketStatus.startSubStatusId), if any. Still subject to the
        // work-gate + warranty filters below.
        const fromId = entryOnly || !fromSubStatusId ? null : fromSubStatusId;

        let candidates: Array<{
            id: string; label: string; statusId: string | null;
            warrantyScope: string | null; work: { permissionId: string | null } | null;
        }>;

        if (fromId === null) {
            const status = await prisma.ticketStatus.findUnique({
                where: { id: statusId },
                select: { startSubStatus: { select: { id: true, label: true, statusId: true, warrantyScope: true, work: { select: { permissionId: true } } } } },
            });
            candidates = status?.startSubStatus ? [status.startSubStatus] : [];
        } else {
            // Forward transitions leaving the current sub-status. Back navigation is
            // history-based on the client, so this route is forward-only.
            const transitions = await prisma.subStatusTransition.findMany({
                where: { fromSubStatusId: fromId },
                include: { to: { select: { id: true, label: true, statusId: true, warrantyScope: true, work: { select: { permissionId: true } } } } },
                orderBy: { to: { order: "asc" } },
            });
            candidates = transitions.map((t) => t.to);
        }

        const seen = new Set<string>();
        const result = candidates.filter((ss) => {
            if (seen.has(ss.id)) return false;
            seen.add(ss.id);
            if (ss.statusId !== statusId) return false;
            if (!passesWorkGate(user, ss.work)) return false;
            const scope = ss.warrantyScope ?? "any";
            if (scope !== "any") {
                if (scope === "warranty_only" && !isWarranty) return false;
                if (scope === "non_warranty_only" && isWarranty) return false;
            }
            return true;
        });

        return NextResponse.json(result.map((ss) => ({ id: ss.id, label: ss.label })));
    } catch (e) {
        return handleApiError(e, "Failed to fetch next sub-statuses");
    }
}
