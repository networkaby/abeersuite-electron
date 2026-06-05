import { auth } from "@/auth";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { TaskBoard } from "@/modules/administration/components";

/** Administration work board rides the seeded internal-management pipeline. */
const ADMIN_PIPELINE_ID = "P4";

export default async function AdministrationPage() {
    const session = await auth();
    const sessionUser = session?.user as
        | { id?: string; permissions?: string[] }
        | undefined;
    const permissions = sessionUser?.permissions ?? [];
    const canManage =
        permissions.includes(PERMISSIONS.ADMIN_BYPASS) ||
        permissions.includes(PERMISSIONS.ADMINISTRATION_TASKS_MANAGE);
    const currentUserId = Number(sessionUser?.id ?? 0);

    const [stages, users] = await Promise.all([
        prisma.ticketStatus.findMany({
            where: { pipelineId: ADMIN_PIPELINE_ID },
            orderBy: { order: "asc" },
            select: { id: true, label: true, color: true, order: true, isTerminal: true },
        }),
        prisma.user.findMany({
            orderBy: { name: "asc" },
            select: { id: true, name: true, avatarUrl: true, role: true },
        }),
    ]);

    return (
        <div className="h-full px-6 py-5">
            <TaskBoard
                stages={stages}
                users={users}
                currentUserId={currentUserId}
                canManage={canManage}
            />
        </div>
    );
}
