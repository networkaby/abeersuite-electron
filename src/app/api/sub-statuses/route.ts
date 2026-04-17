import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

// GET /api/sub-statuses?statusId=S3
// Returns sub-statuses applicable to a given main status (or all if no filter)
export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const statusId = searchParams.get("statusId");

        const all = await prisma.ticketSubStatus.findMany({
            orderBy: { order: "asc" },
            include: { triggerStatus: { select: { id: true, label: true } } },
        });

        const result = statusId
            ? all.filter((ss) => ss.applicableStatusIds.includes(statusId))
            : all;

        return NextResponse.json(result);
    } catch {
        return NextResponse.json({ error: "Failed to fetch sub-statuses" }, { status: 500 });
    }
}
