import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { getCrmPipeline } from "@/lib/crm-pipeline";

export async function GET() {
    const { response } = await requirePermission("crm:view");
    if (response) return response;

    const pipeline = await getCrmPipeline(prisma);
    if (!pipeline) {
        return NextResponse.json(
            { error: "CRM pipeline not found. Run database seed." },
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
