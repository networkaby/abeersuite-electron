import { auth } from "@/auth";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { crudFlags } from "@/shared/lib/auth/permissionScope";
import { TaskBoard } from "@/modules/administration/components";
import { ADMIN_TASKS_PIPELINE_ID as ADMIN_PIPELINE_ID } from "@/modules/administration/lib/adminPipeline";

export default async function AdministrationPage() {
    const session = await auth();
    const sessionUser = session?.user as
        | { id?: string; permissions?: string[] }
        | undefined;
    const permissions = sessionUser?.permissions ?? [];
    // The layout already gated "may you open this board". These say what you may
    // DO on it — the sidebar tick alone must not delete tasks.
    const { canCreate, canEdit, canDelete } = crudFlags(permissions, "tasks");

    // Seats and "which are mine" are no longer read here — the board takes them
    // from the browser's cached copy (usePositionPicker), leaving this page with
    // the one query that is genuinely per-board.
    const stages = await prisma.ticketStatus.findMany({
        where: { pipelineId: ADMIN_PIPELINE_ID },
        orderBy: { order: "asc" },
        select: { id: true, label: true, color: true, order: true, isTerminal: true },
    });

    return (
        <div className="h-full px-6 py-5">
            <TaskBoard
                stages={stages}
                canCreate={canCreate}
                canEdit={canEdit}
                canDelete={canDelete}
            />
        </div>
    );
}
