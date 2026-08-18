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
    // Seats and "which are mine" come from the browser's cached copy
    // (usePositionPicker), so they are absent from this page's reads.
    const [groups, categories, warrantyTerms] = await Promise.all([
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
    ]);

    return (
        <div className="h-full">
            <ReconnectWorkspace
                groups={groups}
                categories={categories}
                warrantyTerms={warrantyTerms}
            />
        </div>
    );
}
