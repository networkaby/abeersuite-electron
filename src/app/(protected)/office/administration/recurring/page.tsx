import { auth } from "@/auth";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { hasModuleNavAccess } from "@/shared/lib/auth/permissionScope";
import { RecurringTaskList } from "@/modules/administration/components";

export default async function RecurringTasksPage() {
    const session = await auth();
    const sessionUser = session?.user as { permissions?: string[] } | undefined;
    const canManage = hasModuleNavAccess(sessionUser?.permissions ?? [], "administration");

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
            <RecurringTaskList positions={positions} canManage={canManage} />
        </div>
    );
}
