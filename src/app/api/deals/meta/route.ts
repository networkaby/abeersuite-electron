import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { getDealsPipeline } from "@/modules/deals/lib/dealsPipeline";

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    const pipeline = await getDealsPipeline(prisma);
    if (!pipeline) {
        return NextResponse.json(
            { error: "Deals pipeline not found. Run database seed." },
            { status: 503 }
        );
    }

    return NextResponse.json({
        pipelineId: pipeline.id,
        pipelineLabel: pipeline.label,
        statuses: pipeline.statuses.map((s) => ({
            id: s.id,
            label: s.label,
            color: s.color,
            order: s.order,
            isTerminal: s.isTerminal,
            isEntryPoint: s.isEntryPoint,
        })),
    });
}
