import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { hasModuleNavAccess } from "@/shared/lib/auth/permissionScope";
import ContactsWorkspace from "@/modules/customer/components/ContactsWorkspace";

export default async function ContactsPage() {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const isAdmin = permissions.includes(PERMISSIONS.ADMIN_BYPASS);
    const canView = hasModuleNavAccess(permissions, "customers");
    if (!canView) redirect("/office/work-flow-inbox");
    const canEdit =
        isAdmin ||
        permissions.includes(PERMISSIONS.CUSTOMERS_EDIT);

    const positionRows = await prisma.position.findMany({
        orderBy: { title: "asc" },
        select: { id: true, title: true, branch: { select: { name: true } } },
    });
    const positions = positionRows.map((p) => ({ id: p.id, title: p.title, branchName: p.branch?.name ?? null }));

    return (
        <div className="h-full px-6 py-5">
            <ContactsWorkspace positions={positions} canEdit={canEdit} />
        </div>
    );
}
