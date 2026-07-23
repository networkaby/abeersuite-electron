import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { hasModuleNavAccess, hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { getHelpPipeline } from "@/modules/help/lib/helpPipeline";
import { HelpWorkspace } from "@/modules/help/components";

export default async function HelpDeskPage() {
    const session = await auth();
    const sessionUser = session?.user as { id?: string; permissions?: string[] } | undefined;
    const permissions = sessionUser?.permissions ?? [];
    if (!hasModuleNavAccess(permissions, "help")) {
        redirect("/office/work-flow-inbox");
    }
    const canManage = hasModuleNavAccess(permissions, "help");
    const canDelete = permissions.includes("admin:bypass") || hasPermissionWithScope(permissions, "help:delete");
    const currentUserId = Number(sessionUser?.id ?? 0);

    const pipeline = await getHelpPipeline(prisma);
    if (!pipeline) {
        return (
            <div className="px-6 py-5">
                <h1 className="text-xl font-semibold">Help Desk</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    Help Desk pipeline missing — run <code className="text-foreground">pnpm seed:apply-help-pipeline</code>.
                </p>
            </div>
        );
    }

    const [positionRows, myPositions] = await Promise.all([
        prisma.position.findMany({
            orderBy: { title: "asc" },
            select: {
                id: true,
                title: true,
                branch: { select: { name: true } },
                department: { select: { name: true } },
            },
        }),
        currentUserId
            ? prisma.userPosition.findMany({ where: { userId: currentUserId }, select: { positionId: true } })
            : Promise.resolve([]),
    ]);

    const stages = pipeline.statuses.map((s) => ({
        id: s.id,
        label: s.label,
        color: s.color,
        order: s.order,
        isTerminal: s.isTerminal,
    }));
    const positions = positionRows.map((p) => ({
        id: p.id,
        title: p.title,
        branchName: p.branch?.name ?? null,
        departmentName: p.department?.name ?? null,
    }));
    const myPositionIds = myPositions.map((p) => p.positionId);

    return (
        <div className="h-full px-6 py-5">
            <HelpWorkspace
                stages={stages}
                positions={positions}
                myPositionIds={myPositionIds}
                canManage={canManage}
                canDelete={canDelete}
            />
        </div>
    );
}
