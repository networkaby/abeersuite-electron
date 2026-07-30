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
    const currentUserId = Number(sessionUser?.id ?? 0);

    const [stages, positionRows, myPositions] = await Promise.all([
        prisma.ticketStatus.findMany({
            where: { pipelineId: ADMIN_PIPELINE_ID },
            orderBy: { order: "asc" },
            select: { id: true, label: true, color: true, order: true, isTerminal: true },
        }),
        // Seats a task can be assigned to.
        prisma.position.findMany({
            orderBy: { title: "asc" },
            select: {
                id: true,
                title: true,
                branch: { select: { name: true } },
                department: { select: { name: true } },
            },
        }),
        // Positions the current user holds → drives the "My tasks" filter.
        currentUserId
            ? prisma.userPosition.findMany({
                where: { userId: currentUserId },
                select: { positionId: true },
            })
            : Promise.resolve([]),
    ]);

    const positions = positionRows.map((p) => ({
        id: p.id,
        title: p.title,
        branchName: p.branch?.name ?? null,
        departmentName: p.department?.name ?? null,
    }));
    const myPositionIds = myPositions.map((p) => p.positionId);

    return (
        <div className="h-full px-6 py-5">
            <TaskBoard
                stages={stages}
                positions={positions}
                myPositionIds={myPositionIds}
                canCreate={canCreate}
                canEdit={canEdit}
                canDelete={canDelete}
            />
        </div>
    );
}
