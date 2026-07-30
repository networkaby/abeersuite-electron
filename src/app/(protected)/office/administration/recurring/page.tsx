import { auth } from "@/auth";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { crudFlags } from "@/shared/lib/auth/permissionScope";
import { RecurringTaskList } from "@/modules/administration/components";

export default async function RecurringTasksPage() {
    const session = await auth();
    const sessionUser = session?.user as { permissions?: string[] } | undefined;
    // Recurring definitions share the tasks:* rungs — one recurring row is just a
    // task that keeps coming back, so it does not need its own permission family.
    const { canCreate, canEdit, canDelete } = crudFlags(sessionUser?.permissions ?? [], "tasks");

    // Seats a recurring task can be assigned to (same shape the board uses).
    const positionRows = await prisma.position.findMany({
        orderBy: { title: "asc" },
        select: {
            id: true,
            title: true,
            branch: { select: { name: true } },
            department: { select: { name: true } },
        },
    });

    const positions = positionRows.map((p) => ({
        id: p.id,
        title: p.title,
        branchName: p.branch?.name ?? null,
        departmentName: p.department?.name ?? null,
    }));

    return (
        <div className="h-full px-6 py-5">
            <RecurringTaskList
                positions={positions}
                canCreate={canCreate}
                canEdit={canEdit}
                canDelete={canDelete}
            />
        </div>
    );
}
