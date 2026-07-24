import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { hasModuleNavAccess } from "@/shared/lib/auth/permissionScope";
import { ReconnectWorkspace } from "@/modules/crm/components";

// /office/crm/reconnect — the customer-centric re-engagement workbench.
export default async function ReconnectPage() {
    const session = await auth();
    const sessionUser = session?.user as { id?: string; permissions?: string[] } | undefined;
    const permissions = sessionUser?.permissions ?? [];
    if (!hasModuleNavAccess(permissions, "crm")) {
        redirect("/office/work-flow-inbox");
    }
    const currentUserId = Number(sessionUser?.id ?? 0);

    const [positionRows, groups, categories, warrantyTerms, myPositions] = await Promise.all([
        prisma.position.findMany({
            orderBy: { title: "asc" },
            select: { id: true, title: true, branch: { select: { name: true } } },
        }),
        prisma.customerGroup.findMany({
            where: { isActive: true },
            orderBy: { name: "asc" },
            select: { id: true, name: true },
        }),
        prisma.invCategory.findMany({
            orderBy: { name: "asc" },
            select: { id: true, name: true },
        }),
        // Only fixed-duration terms are usable for "warranty ending" (0/null = lifetime).
        prisma.invWarrantyTerm.findMany({
            where: { isActive: true, durationDays: { gt: 0 } },
            orderBy: { durationDays: "asc" },
            select: { id: true, name: true, durationDays: true },
        }),
        currentUserId
            ? prisma.userPosition.findMany({ where: { userId: currentUserId }, select: { positionId: true } })
            : Promise.resolve([]),
    ]);

    const positions = positionRows.map((p) => ({ id: p.id, title: p.title, branchName: p.branch?.name ?? null }));
    const myPositionIds = myPositions.map((p) => p.positionId);

    return (
        <div className="h-full">
            <ReconnectWorkspace
                positions={positions}
                groups={groups}
                categories={categories}
                warrantyTerms={warrantyTerms}
                myPositionIds={myPositionIds}
            />
        </div>
    );
}
