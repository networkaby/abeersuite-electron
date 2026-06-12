import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { passesWorkGate } from "@/modules/repairing/lib/workGate";
import { handleApiError } from "@/shared/lib/api";

// GET /api/workers/next?statusId=S3&fromWorkerId=SS10
// GET /api/workers/next?statusId=S3&entryOnly=true  (no current worker)
//
// Returns the next allowed workers for a ticket given its current main status
// and current worker (or entry points when there is no worker yet).
// Only returns workers the calling user's role is permitted to set.
export async function GET(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;

    try {
        const { searchParams } = new URL(req.url);
        const statusId = searchParams.get("statusId");
        const fromWorkerId = searchParams.get("fromWorkerId");
        const entryOnly = searchParams.get("entryOnly") === "true";
        const isWarranty = searchParams.get("isWarranty") === "true";

        if (!statusId) {
            return NextResponse.json({ error: "statusId required" }, { status: 400 });
        }

        // No current worker → the only "next" is the status's hand-picked start
        // worker (TicketStatus.startWorkerId), if any. Still subject to the
        // work-gate + warranty filters below.
        const fromId = entryOnly || !fromWorkerId ? null : fromWorkerId;

        let candidates: Array<{
            id: string; label: string; statusId: string | null;
            warrantyScope: string | null; work: { permissionId: string | null; label: string; color: string } | null;
        }>;

        const subSelect = { id: true, label: true, statusId: true, warrantyScope: true, work: { select: { permissionId: true, label: true, color: true } } } as const;

        if (fromId === null) {
            const status = await prisma.ticketStatus.findUnique({
                where: { id: statusId },
                select: { startWorker: { select: subSelect } },
            });
            candidates = status?.startWorker ? [status.startWorker] : [];
        } else {
            // Forward transitions leaving the current worker. Back navigation is
            // history-based on the client, so this route is forward-only.
            const transitions = await prisma.workerTransition.findMany({
                where: { fromWorkerId: fromId },
                include: { to: { select: subSelect } },
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

        return NextResponse.json(result.map((ss) => ({
            id: ss.id,
            label: ss.label,
            work: ss.work ? { label: ss.work.label, color: ss.work.color } : null,
        })));
    } catch (e) {
        return handleApiError(e, "Failed to fetch next workers");
    }
}
