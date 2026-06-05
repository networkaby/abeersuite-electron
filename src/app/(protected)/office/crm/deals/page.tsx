import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { getDealsPipeline } from "@/modules/deals/lib/dealsPipeline";
import { DealsWorkspace } from "@/modules/deals/components";

export default async function DealsPage() {
    const session = await auth();
    const sessionUser = session?.user as { id?: string; permissions?: string[] } | undefined;
    const permissions = sessionUser?.permissions ?? [];
    if (!permissions.includes(PERMISSIONS.ADMIN_BYPASS) && !permissions.includes(PERMISSIONS.DEALS_VIEW)) {
        redirect("/office/core/assignments");
    }
    const canManage =
        permissions.includes(PERMISSIONS.ADMIN_BYPASS) || permissions.includes(PERMISSIONS.DEALS_MANAGE);
    const currentUserId = Number(sessionUser?.id ?? 0);

    const pipeline = await getDealsPipeline(prisma);
    if (!pipeline) {
        return (
            <div className="px-6 py-5">
                <h1 className="text-xl font-semibold">Deals</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    Deals pipeline missing — run <code className="text-foreground">pnpm prisma db seed</code>.
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
            <DealsWorkspace
                stages={stages}
                positions={positions}
                myPositionIds={myPositionIds}
                canManage={canManage}
            />
        </div>
    );
}
