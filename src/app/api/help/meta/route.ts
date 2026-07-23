import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { getHelpPipeline } from "@/modules/help/lib/helpPipeline";

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    const pipeline = await getHelpPipeline(prisma);
    if (!pipeline) {
        return NextResponse.json({ error: "Help Desk pipeline not found. Run database seed." }, { status: 503 });
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
